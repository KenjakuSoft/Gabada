"""SeleniumBase-backed stealth Chrome fallback for bot-challenge sites.

When the shared headless Chromium hits a Cloudflare / DataDome / Turnstile
challenge that does not auto-clear, ``engine._scrape_url_once`` retries the
scrape once through this module. SeleniumBase launches a stealth-patched
Chrome via CDP and Playwright attaches to it via ``connect_over_cdp(...)``
which bypasses most automated-browser fingerprinting.

The ``seleniumbase`` dependency is optional. If the import fails the
fallback is a no-op and the caller falls back to the standard challenge
result. The same applies if the host has no system Chrome / Chromium that
SeleniumBase can launch.
"""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from playwright.async_api import Page, Playwright

from app_paths import resolve_storage_state_path
from database.models import ScrapeConfig

logger = logging.getLogger(__name__)


def is_available() -> bool:
    """True iff seleniumbase can be imported in this environment."""
    try:
        import seleniumbase  # noqa: F401
        return True
    except Exception:
        return False


async def _stop_driver(driver: Any) -> None:
    """Best-effort shutdown across SeleniumBase versions.

    cdp_driver instances expose different teardown methods depending on
    the SeleniumBase release. Try the most common in order and stop at
    the first one that works.
    """
    for method_name in ("stop_async", "stop", "quit", "disconnect"):
        method = getattr(driver, method_name, None)
        if not callable(method):
            continue
        try:
            result = method()
            if asyncio.iscoroutine(result):
                await result
            return
        except Exception as exc:
            logger.warning("Stealth driver %s() failed: %s", method_name, exc)
    logger.warning(
        "Could not find a stop method on stealth driver %s",
        type(driver).__name__,
    )


def _storage_state_cookies(config: ScrapeConfig) -> list:
    """Pull the cookies array out of a saved storage_state JSON file.

    A CDP-attached Playwright context can not load ``storage_state``
    directly, so we lift just the cookies. Usually enough for a
    logged-in scrape on stores where dealer prices live behind auth.
    """
    if not config.storage_state_path:
        return []
    try:
        path = resolve_storage_state_path(config.storage_state_path)
    except Exception:
        return []
    if not path or not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.debug("Could not read storage_state %s: %s", path, exc)
        return []
    cookies = data.get("cookies") if isinstance(data, dict) else None
    return cookies if isinstance(cookies, list) else []


@asynccontextmanager
async def stealth_navigate(
    playwright: Playwright,
    url: str,
    config: ScrapeConfig,
    *,
    headless: bool = False,
    settle_seconds: float = 8.0,
) -> AsyncIterator[Optional[Page]]:
    """Yield a Playwright Page that is already at ``url`` inside a stealth Chrome.

    The flow that actually beats Cloudflare:

    1. SeleniumBase launches a stealth-patched Chrome.
    2. SeleniumBase navigates to ``url`` so its own anti-bot warmup runs
       (this is the step that gets past the CF interstitial).
    3. We sleep briefly to let any redirect / challenge resolve.
    4. Playwright attaches to the running browser via CDP and we yield the
       existing tab — no further navigation.

    Yields ``None`` if seleniumbase is not installed or stealth setup
    failed. Caller must handle the None case.

    ``headless`` defaults to False because UC mode's stealth degrades in
    headless Chrome — Cloudflare specifically fingerprints headless. A
    visible window flashes for a few seconds per blocked site, which is
    acceptable for a desktop app.
    """
    try:
        from seleniumbase import cdp_driver
    except Exception as exc:
        logger.info(
            "Stealth retry unavailable: seleniumbase not installed (%s). "
            "Run `pip install seleniumbase` to enable the bot-challenge bypass.",
            exc,
        )
        yield None
        return

    driver = None
    browser = None
    page: Optional[Page] = None

    try:
        try:
            driver = await cdp_driver.start_async(headless=headless)
        except TypeError:
            # Older SeleniumBase releases may not accept headless kw.
            driver = await cdp_driver.start_async()

        # Navigate via SeleniumBase BEFORE attaching Playwright so the
        # anti-bot warmup actually runs. Doing it from a Playwright page
        # after attach skips that warmup and CF blocks again.
        try:
            await driver.get(url)
        except Exception as exc:
            logger.warning("Stealth: driver.get(%s) failed: %s", url, exc)

        # Brief settle so any JS challenge / redirect can resolve.
        await asyncio.sleep(max(0.0, settle_seconds))

        endpoint_url = driver.get_endpoint_url()
        browser = await playwright.chromium.connect_over_cdp(endpoint_url)

        contexts = browser.contexts
        context = contexts[0] if contexts else await browser.new_context()

        cookies = list(config.cookies or []) + _storage_state_cookies(config)
        if cookies:
            try:
                await context.add_cookies(cookies)
            except Exception as exc:
                logger.warning("Stealth: failed to add cookies: %s", exc)
        if config.headers:
            try:
                await context.set_extra_http_headers(config.headers)
            except Exception as exc:
                logger.warning("Stealth: failed to set headers: %s", exc)

        # Re-use the tab SeleniumBase already navigated. Opening a new
        # tab here would lose the cleared CF cookies for the URL.
        page = context.pages[0] if context.pages else await context.new_page()
    except Exception as exc:
        logger.error("Stealth browser setup failed: %s", exc)
        page = None

    try:
        yield page
    finally:
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass
        if driver is not None:
            await _stop_driver(driver)
