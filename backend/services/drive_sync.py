"""Manual Google Drive sync for Gabada backups.

This module provides the safe path described in CHANGELOG v0.2.6+:
the user signs in to Google with an OAuth client they create in the
Google Cloud Console (Desktop app type), Gabada uploads zipped backup
bundles to a folder named "Gabada" in that account's Drive, and other
machines signed in to the *same* Google account can list/download/restore
those snapshots.

Concurrency model: this is **not** real-time sync. Snapshots are uploaded
on demand. Two people editing simultaneously is unsafe by design — the
restore flow loudly overwrites the local DB, and the push flow uploads
the current DB as a new timestamped snapshot. The Drive folder keeps a
rolling history so a bad push can be undone by restoring an earlier
snapshot.

Scope used: ``drive.file`` — Gabada can only see/touch files it created.
This means you cannot share snapshots across different Google accounts
through this scope; multi-user requires the same Google login on every
machine (which is exactly what the user asked for).
"""
from __future__ import annotations

import json
import logging
import secrets
import threading
import time
import urllib.parse
import webbrowser
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Optional

import httpx

from app_paths import data_dir

logger = logging.getLogger(__name__)

OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"
DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"]
APP_FOLDER_NAME = "Gabada"
TOKEN_FILE = "drive-tokens.json"
CREDENTIALS_FILE = "drive-credentials.json"
LAST_PUSH_FILE = "drive-last-push.json"
SNAPSHOT_PREFIX = "gabada-backup-"
MAX_SNAPSHOTS = 30


# ── OAuth client credentials ─────────────────────────────────────────────────


@dataclass
class DriveCredentials:
    client_id: str
    client_secret: str


def _credentials_path() -> Path:
    return data_dir() / CREDENTIALS_FILE


def load_credentials() -> Optional[DriveCredentials]:
    path = _credentials_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Drive: credentials file unreadable: %s", exc)
        return None
    cid = data.get("client_id")
    csec = data.get("client_secret")
    if not cid or not csec:
        return None
    return DriveCredentials(client_id=cid, client_secret=csec)


def save_credentials(creds: DriveCredentials) -> None:
    path = _credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(creds), indent=2), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def clear_credentials() -> None:
    path = _credentials_path()
    if path.exists():
        try:
            path.unlink()
        except OSError as exc:
            logger.warning("Drive: could not remove credentials file: %s", exc)


# ── Last-push metadata (for status display) ──────────────────────────────────


def _last_push_path() -> Path:
    return data_dir() / LAST_PUSH_FILE


def load_last_push() -> Optional[dict[str, Any]]:
    path = _last_push_path()
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_last_push(name: str, snapshot_id: str) -> None:
    path = _last_push_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "name": name,
                "snapshot_id": snapshot_id,
                "at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def auth_in_progress() -> bool:
    with _auth_lock:
        return _pending is not None


# ── State ────────────────────────────────────────────────────────────────────


@dataclass
class DriveTokens:
    access_token: str
    refresh_token: Optional[str]
    expires_at: float  # epoch seconds
    scope: Optional[str] = None
    account_email: Optional[str] = None

    def is_expiring(self, slack: int = 60) -> bool:
        return time.time() + slack >= self.expires_at


def _tokens_path() -> Path:
    return data_dir() / TOKEN_FILE


def load_tokens() -> Optional[DriveTokens]:
    path = _tokens_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Drive: tokens file unreadable: %s", exc)
        return None
    try:
        return DriveTokens(**data)
    except TypeError:
        logger.warning("Drive: tokens file has unexpected shape")
        return None


def save_tokens(tokens: DriveTokens) -> None:
    path = _tokens_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(tokens), indent=2), encoding="utf-8")
    try:
        # Best-effort tighten permissions on POSIX. On Windows the user
        # profile already restricts access.
        path.chmod(0o600)
    except OSError:
        pass


def clear_tokens() -> None:
    path = _tokens_path()
    if path.exists():
        try:
            path.unlink()
        except OSError as exc:
            logger.warning("Drive: could not remove tokens file: %s", exc)


# ── Auth flow (loopback HTTP server) ─────────────────────────────────────────


@dataclass
class _PendingAuth:
    state: str
    redirect_uri: str
    started_at: float
    code: Optional[str] = None
    error: Optional[str] = None


_auth_lock = threading.Lock()
_pending: Optional[_PendingAuth] = None
_loopback_server: Optional[HTTPServer] = None
_loopback_thread: Optional[threading.Thread] = None


class _LoopbackHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Silence the default stderr logging — route through our logger instead.
        logger.debug("Loopback: %s", format % args)

    def do_GET(self) -> None:  # noqa: N802 — http.server signature
        global _pending
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/oauth2callback":
            self.send_response(404)
            self.end_headers()
            return

        params = urllib.parse.parse_qs(parsed.query)
        code = (params.get("code") or [None])[0]
        state = (params.get("state") or [None])[0]
        error = (params.get("error") or [None])[0]

        with _auth_lock:
            if _pending is None:
                self._reply("No pending sign-in. Close this tab and try again from Gabada.")
                return
            if state != _pending.state:
                _pending.error = "state mismatch"
                self._reply("Sign-in state mismatch. Close this tab and try again.")
                return
            if error:
                _pending.error = error
                self._reply(f"Google reported: {error}. You can close this tab.")
                return
            if not code:
                _pending.error = "no code"
                self._reply("Google did not return an authorization code.")
                return
            _pending.code = code

        self._reply("Signed in. You can close this tab and return to Gabada.")

    def _reply(self, message: str) -> None:
        body = (
            "<!doctype html><html><head><meta charset='utf-8'>"
            "<title>Gabada — Drive sign-in</title>"
            "<style>body{font-family:system-ui,sans-serif;display:flex;"
            "align-items:center;justify-content:center;min-height:100vh;"
            "margin:0;background:#0b0d10;color:#e7eaf0}"
            ".card{padding:2rem 2.5rem;border-radius:14px;background:#161a20;"
            "border:1px solid #2a2f38;max-width:440px;text-align:center}"
            "h1{margin:0 0 .5rem;font-size:1.1rem}p{margin:0;opacity:.8}"
            "</style></head><body><div class='card'><h1>Gabada</h1>"
            f"<p>{message}</p></div></body></html>"
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body.encode("utf-8"))))
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))


def _stop_loopback() -> None:
    global _loopback_server, _loopback_thread
    if _loopback_server is not None:
        try:
            _loopback_server.shutdown()
            _loopback_server.server_close()
        except Exception as exc:  # pragma: no cover — defensive
            logger.debug("Drive: loopback shutdown error: %s", exc)
    _loopback_server = None
    _loopback_thread = None


def _start_loopback() -> int:
    """Start the loopback callback server on 127.0.0.1:<random free port>.

    Returns the bound port. Caller is responsible for calling _stop_loopback()
    once auth completes (or on timeout).
    """
    global _loopback_server, _loopback_thread
    _stop_loopback()
    server = HTTPServer(("127.0.0.1", 0), _LoopbackHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="drive-oauth-loopback")
    thread.start()
    _loopback_server = server
    _loopback_thread = thread
    return port


def begin_auth(client_id: str) -> str:
    """Start the loopback OAuth flow. Returns the auth URL the user should open.

    The browser is also opened automatically when possible.
    """
    global _pending
    if not client_id:
        raise ValueError("Google OAuth client_id is required")

    port = _start_loopback()
    redirect_uri = f"http://127.0.0.1:{port}/oauth2callback"
    state = secrets.token_urlsafe(24)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "include_granted_scopes": "true",
    }
    url = OAUTH_AUTH_URL + "?" + urllib.parse.urlencode(params)
    with _auth_lock:
        _pending = _PendingAuth(state=state, redirect_uri=redirect_uri, started_at=time.time())
    try:
        webbrowser.open(url, new=1, autoraise=True)
    except Exception as exc:  # pragma: no cover — best-effort
        logger.info("Drive: could not auto-open browser (%s); user will open the URL manually.", exc)
    return url


def cancel_auth() -> None:
    """Abort an in-flight sign-in (best-effort)."""
    global _pending
    with _auth_lock:
        _pending = None
    _stop_loopback()


async def poll_auth(client_id: str, client_secret: str, *, timeout_seconds: int = 240) -> Optional[DriveTokens]:
    """Poll the loopback handler for a captured code and exchange for tokens.

    Returns the persisted tokens on success, ``None`` if the user has not yet
    completed the flow (caller should poll again), or raises if the flow failed
    or timed out.
    """
    global _pending
    with _auth_lock:
        pending = _pending
    if pending is None:
        raise RuntimeError("No sign-in is in progress. Click Sign in first.")

    if time.time() - pending.started_at > timeout_seconds:
        cancel_auth()
        raise RuntimeError("Sign-in timed out. Try again.")

    if pending.error:
        msg = pending.error
        cancel_auth()
        raise RuntimeError(f"Sign-in failed: {msg}")

    if not pending.code:
        return None

    code = pending.code
    redirect_uri = pending.redirect_uri
    cancel_auth()

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            OAUTH_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Token exchange failed: HTTP {resp.status_code} {resp.text[:200]}")
        payload = resp.json()
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token")
        expires_in = int(payload.get("expires_in") or 0)
        scope = payload.get("scope")
        if not access_token:
            raise RuntimeError("Token response missing access_token")

        # Identify the signed-in account so we can show it in the UI.
        email = await _userinfo_email(client, access_token)

    tokens = DriveTokens(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=time.time() + max(60, expires_in - 30),
        scope=scope,
        account_email=email,
    )
    save_tokens(tokens)
    return tokens


async def _userinfo_email(client: httpx.AsyncClient, access_token: str) -> Optional[str]:
    try:
        resp = await client.get(
            USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data.get("email")
    except httpx.HTTPError:
        return None


# ── Token refresh ────────────────────────────────────────────────────────────


async def refresh_if_needed(client_id: str, client_secret: str) -> DriveTokens:
    tokens = load_tokens()
    if tokens is None:
        raise RuntimeError("Not signed in to Google Drive.")
    if not tokens.is_expiring():
        return tokens
    if not tokens.refresh_token:
        clear_tokens()
        raise RuntimeError("Drive session expired and no refresh token is available. Sign in again.")

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            OAUTH_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": tokens.refresh_token,
                "grant_type": "refresh_token",
            },
        )
        if resp.status_code != 200:
            clear_tokens()
            raise RuntimeError(
                f"Token refresh failed: HTTP {resp.status_code}. Sign in again."
            )
        payload = resp.json()
        access_token = payload.get("access_token")
        expires_in = int(payload.get("expires_in") or 0)
        if not access_token:
            raise RuntimeError("Refresh response missing access_token")

    tokens = DriveTokens(
        access_token=access_token,
        refresh_token=tokens.refresh_token,
        expires_at=time.time() + max(60, expires_in - 30),
        scope=tokens.scope,
        account_email=tokens.account_email,
    )
    save_tokens(tokens)
    return tokens


async def revoke(client_id: str, client_secret: str) -> None:
    tokens = load_tokens()
    if tokens is None:
        return
    target = tokens.refresh_token or tokens.access_token
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(OAUTH_REVOKE_URL, params={"token": target})
    except httpx.HTTPError as exc:
        logger.info("Drive: token revoke failed (%s); clearing local tokens anyway.", exc)
    clear_tokens()


# ── Drive API helpers ────────────────────────────────────────────────────────


async def _request(
    method: str,
    url: str,
    *,
    access_token: str,
    client: httpx.AsyncClient,
    **kwargs: Any,
) -> httpx.Response:
    headers = kwargs.pop("headers", {}) or {}
    headers.setdefault("Authorization", f"Bearer {access_token}")
    resp = await client.request(method, url, headers=headers, **kwargs)
    if resp.status_code >= 400:
        raise RuntimeError(
            f"Drive API {method} {url} failed: HTTP {resp.status_code} {resp.text[:300]}"
        )
    return resp


async def _ensure_app_folder(access_token: str, client: httpx.AsyncClient) -> str:
    """Find or create the ``Gabada`` folder in the user's Drive.

    With ``drive.file`` scope we can only see folders the app created, so the
    first push creates the folder; subsequent pushes find it by name.
    """
    query = (
        "name = '" + APP_FOLDER_NAME.replace("'", "\\'") + "'"
        " and mimeType = 'application/vnd.google-apps.folder'"
        " and trashed = false"
    )
    resp = await _request(
        "GET",
        f"{DRIVE_API_BASE}/files",
        access_token=access_token,
        client=client,
        params={
            "q": query,
            "fields": "files(id,name)",
            "spaces": "drive",
            "pageSize": 10,
        },
    )
    files = resp.json().get("files") or []
    if files:
        return files[0]["id"]

    create = await _request(
        "POST",
        f"{DRIVE_API_BASE}/files",
        access_token=access_token,
        client=client,
        json={
            "name": APP_FOLDER_NAME,
            "mimeType": "application/vnd.google-apps.folder",
        },
        params={"fields": "id"},
    )
    return create.json()["id"]


async def list_snapshots(access_token: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        folder_id = await _ensure_app_folder(access_token, client)
        query = (
            f"'{folder_id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
        )
        resp = await _request(
            "GET",
            f"{DRIVE_API_BASE}/files",
            access_token=access_token,
            client=client,
            params={
                "q": query,
                "fields": "files(id,name,size,createdTime,modifiedTime)",
                "spaces": "drive",
                "orderBy": "createdTime desc",
                "pageSize": 100,
            },
        )
        return resp.json().get("files") or []


async def upload_snapshot(access_token: str, zip_path: Path, name: str) -> dict[str, Any]:
    """Multipart upload of ``zip_path`` to the Gabada folder under ``name``.

    Returns the created file's metadata.
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        folder_id = await _ensure_app_folder(access_token, client)
        metadata = {"name": name, "parents": [folder_id]}
        # Use multipart upload (one HTTP request, simpler than resumable).
        boundary = "gabada-" + secrets.token_hex(8)
        body = (
            f"--{boundary}\r\n"
            "Content-Type: application/json; charset=UTF-8\r\n\r\n"
            + json.dumps(metadata)
            + f"\r\n--{boundary}\r\n"
            "Content-Type: application/zip\r\n\r\n"
        ).encode("utf-8")
        body += zip_path.read_bytes()
        body += f"\r\n--{boundary}--\r\n".encode("utf-8")
        resp = await _request(
            "POST",
            f"{DRIVE_UPLOAD_BASE}/files",
            access_token=access_token,
            client=client,
            params={"uploadType": "multipart", "fields": "id,name,size,createdTime,modifiedTime"},
            content=body,
            headers={"Content-Type": f"multipart/related; boundary={boundary}"},
        )
        return resp.json()


async def download_snapshot(access_token: str, file_id: str, dest_path: Path) -> None:
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await _request(
            "GET",
            f"{DRIVE_API_BASE}/files/{file_id}",
            access_token=access_token,
            client=client,
            params={"alt": "media"},
        )
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(resp.content)


async def delete_snapshot(access_token: str, file_id: str) -> None:
    async with httpx.AsyncClient(timeout=30.0) as client:
        await _request(
            "DELETE",
            f"{DRIVE_API_BASE}/files/{file_id}",
            access_token=access_token,
            client=client,
        )


async def prune_old_snapshots(
    access_token: str,
    *,
    keep: int = MAX_SNAPSHOTS,
) -> int:
    """Delete snapshots older than the most recent ``keep``. Returns count deleted."""
    items = await list_snapshots(access_token)
    # list_snapshots is already sorted createdTime desc — drop the head.
    extras = items[keep:]
    deleted = 0
    for item in extras:
        try:
            await delete_snapshot(access_token, item["id"])
            deleted += 1
        except RuntimeError as exc:
            logger.warning("Drive: failed to prune %s: %s", item.get("name"), exc)
    return deleted


def make_snapshot_filename(stamp: Optional[str] = None) -> str:
    if stamp is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{SNAPSHOT_PREFIX}{stamp}.zip"
