from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from app_paths import configure_runtime_environment, logs_dir
from main import app


HOST = "127.0.0.1"
PORT_RANGE = range(8000, 8011)
LOG_PATH = logs_dir() / "gabada.log"
NO_BROWSER_ENV = "GABADA_NO_BROWSER"
LOGGER = logging.getLogger("gabada.launcher")


def _health_url(port: int) -> str:
    return f"http://{HOST}:{port}/health"


def _app_url(port: int) -> str:
    return f"http://{HOST}:{port}/"


def _check_gabada(port: int) -> bool:
    try:
        with urllib.request.urlopen(_health_url(port), timeout=1.5) as response:
            body = response.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, TimeoutError, OSError):
        return False
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return False
    return payload.get("status") == "ok"


def _is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((HOST, port))
        except OSError:
            return False
    return True


def _discover_port() -> tuple[int, bool]:
    for port in PORT_RANGE:
        if _is_port_free(port):
            return port, False
        if _check_gabada(port):
            return port, True
    raise RuntimeError("No free localhost port found in 8000-8010")


def _configure_logging() -> None:
    log_dir = Path(LOG_PATH).parent
    log_dir.mkdir(parents=True, exist_ok=True)
    root_logger = logging.getLogger()
    if not any(
        isinstance(handler, logging.FileHandler)
        and Path(getattr(handler, "baseFilename", "")) == LOG_PATH
        for handler in root_logger.handlers
    ):
        handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
        handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        )
        root_logger.addHandler(handler)
    if root_logger.level > logging.INFO:
        root_logger.setLevel(logging.INFO)


def _should_open_browser() -> bool:
    return os.environ.get(NO_BROWSER_ENV, "").strip().lower() not in {"1", "true", "yes"}


def _open_browser_when_ready(port: int) -> None:
    if not _should_open_browser():
        return
    for _ in range(60):
        if _check_gabada(port):
            webbrowser.open(_app_url(port))
            return
        time.sleep(0.5)


def main() -> int:
    try:
        configure_runtime_environment()
        _configure_logging()
        LOGGER.info("Desktop launcher starting")

        port, already_running = _discover_port()
        LOGGER.info("Port decision: %s (already_running=%s)", port, already_running)
        if already_running:
            if _should_open_browser():
                webbrowser.open(_app_url(port))
            return 0

        threading.Thread(target=_open_browser_when_ready, args=(port,), daemon=True).start()
        LOGGER.info("Starting uvicorn on http://%s:%s", HOST, port)
        config = uvicorn.Config(
            app=app,
            host=HOST,
            port=port,
            log_level="info",
            reload=False,
        )
        server = uvicorn.Server(config)
        app.state.request_shutdown = lambda: setattr(server, "should_exit", True)
        try:
            success = asyncio.run(server.serve())
        except KeyboardInterrupt:
            LOGGER.info("Shutdown requested by user")
            return 0
        finally:
            app.state.request_shutdown = None
        LOGGER.info("Uvicorn exited with success=%s", success)
        return 0 if success is not False else 2
    except KeyboardInterrupt:
        LOGGER.info("Shutdown requested by user")
        return 0
    except Exception:
        LOGGER.exception("Desktop launcher failed")
        return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        LOGGER.info("Shutdown requested by user")
        raise SystemExit(0)
