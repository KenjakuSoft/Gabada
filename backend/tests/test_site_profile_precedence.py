from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import product_service  # noqa: E402
from database.models import ScrapeConfig, ScrapeSelectors  # noqa: E402
from scraper import site_profiles  # noqa: E402


def test_site_profile_overrides_stale_platform_default_selector(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profiles_path = tmp_path / "sites.toml"
    profiles_path.write_text(
        '\n'.join(
            [
                '["example.com"]',
                'platform = "woocommerce"',
                'selectors = { price = ".saved-profile-price" }',
                "",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(site_profiles, "SITES_TOML_PATH", str(profiles_path))
    monkeypatch.setattr(site_profiles, "_cache", {})
    monkeypatch.setattr(site_profiles, "_cache_mtime", 0.0)

    config = ScrapeConfig(
        platform="woocommerce",
        selectors=ScrapeSelectors(
            price=site_profiles.PLATFORM_SELECTORS["woocommerce"]["price"],
        ),
    )

    merged = site_profiles.apply_profile("https://example.com/products/widget", config)

    assert merged.selectors.price == ".saved-profile-price"


def test_site_profile_preserves_true_per_link_selector(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profiles_path = tmp_path / "sites.toml"
    profiles_path.write_text(
        '\n'.join(
            [
                '["example.com"]',
                'platform = "woocommerce"',
                'selectors = { price = ".saved-profile-price" }',
                "",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(site_profiles, "SITES_TOML_PATH", str(profiles_path))
    monkeypatch.setattr(site_profiles, "_cache", {})
    monkeypatch.setattr(site_profiles, "_cache_mtime", 0.0)

    config = ScrapeConfig(
        platform="woocommerce",
        selectors=ScrapeSelectors(price=".per-link-price"),
    )

    merged = site_profiles.apply_profile("https://example.com/products/widget", config)

    assert merged.selectors.price == ".per-link-price"


def test_shipped_redacted-store_profile_pins_single_product_price() -> None:
    """The bundled redacted-store profile must scope to the single-product
    ``p.price`` block, not the JetWooBuilder related-products carousel
    (``span.price``) that the generic Woo default bleeds into."""
    profile = site_profiles.find_profile(
        "https://redacted-store/product/some-game-playstation-5/"
    )
    assert profile is not None
    assert profile.hostname == "redacted-store"
    assert profile.selectors.get("price", "").startswith("p.price")
    assert profile.selectors.get("discounted_price") == (
        "p.price ins .woocommerce-Price-amount"
    )
    # display:none on the native price means a visibility-gated wait_for hangs.
    assert profile.wait_for == "h1"


def test_auto_detect_config_keeps_saved_site_profile_selectors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_probe(url: str, config: ScrapeConfig) -> SimpleNamespace:
        return SimpleNamespace(platform="woocommerce")

    monkeypatch.setattr(product_service, "probe_url", fake_probe)
    monkeypatch.setattr(
        product_service,
        "apply_site_profile",
        lambda url, config: ScrapeConfig(
            platform="woocommerce",
            selectors=ScrapeSelectors(price=".saved-profile-price"),
        ),
    )

    detected = asyncio.run(
        product_service.auto_detect_config(
            "https://example.com/products/widget",
            ScrapeConfig(),
        )
    )

    assert detected.platform == "woocommerce"
    assert detected.selectors.price == ".saved-profile-price"
    assert detected.selectors.discounted_price == (
        site_profiles.PLATFORM_SELECTORS["woocommerce"]["discounted_price"]
    )
