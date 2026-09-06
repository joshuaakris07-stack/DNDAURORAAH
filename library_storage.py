"""Google Drive storage for Aurora character JSONs.

Uses a single owner Google account (developer's). Each app user gets a
subfolder inside ``GOOGLE_DRIVE_FOLDER_ID`` named after their username.
Character JSONs are stored as files inside that subfolder; metadata
(name / class / level) lives in the file's ``appProperties``.

THREAD-SAFETY: googleapiclient's Resource + httplib2.Http are NOT
thread-safe. Every public function acquires a single process-wide lock
around all Drive I/O. This serializes Drive calls but eliminates TLS
record corruption when run via ``fastapi.concurrency.run_in_threadpool``.
"""

from __future__ import annotations

import io
import json
import logging
import os
import threading
from typing import Optional

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaInMemoryUpload, MediaIoBaseDownload

logger = logging.getLogger(__name__)

FOLDER_MIME = "application/vnd.google-apps.folder"
JSON_MIME = "application/json"

_drive_lock = threading.RLock()
_service = None
_creds: Optional[Credentials] = None


def _build_credentials() -> Credentials:
    return Credentials(
        token=None,
        refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        scopes=["https://www.googleapis.com/auth/drive"],
    )


def _get_service():
    """Caller must hold ``_drive_lock``."""
    global _service, _creds
    if _service is None:
        _creds = _build_credentials()
        _creds.refresh(GoogleRequest())
        _service = build("drive", "v3", credentials=_creds, cache_discovery=False)
    elif _creds and _creds.expired:
        _creds.refresh(GoogleRequest())
    return _service


def _root_folder_id() -> str:
    return os.environ["GOOGLE_DRIVE_FOLDER_ID"]


def _esc(s: str) -> str:
    """Escape single quotes for Drive query strings."""
    return s.replace("\\", "\\\\").replace("'", "\\'")


def _get_or_create_user_folder_locked(username: str) -> str:
    """Caller must hold ``_drive_lock``."""
    svc = _get_service()
    parent = _root_folder_id()
    folder_name = username
    q = (
        f"name='{_esc(folder_name)}' and mimeType='{FOLDER_MIME}' "
        f"and '{parent}' in parents and trashed=false"
    )
    res = svc.files().list(q=q, fields="files(id,name)", pageSize=1).execute()
    files = res.get("files", [])
    if files:
        return files[0]["id"]
    meta = {
        "name": folder_name,
        "mimeType": FOLDER_MIME,
        "parents": [parent],
    }
    created = svc.files().create(body=meta, fields="id").execute()
    return created["id"]


def _file_to_character(f: dict) -> dict:
    props = f.get("appProperties") or {}
    return {
        "id": f["id"],
        "name": props.get("name") or f.get("name", "Unnamed").removesuffix(".json"),
        "char_class": props.get("char_class", ""),
        "level": int(props.get("level", "1") or 1),
        "portrait_url": props.get("portrait_url", "") or "",
        "updated_at": f.get("modifiedTime", ""),
        "created_at": f.get("createdTime", ""),
    }


def _safe_filename(name: str) -> str:
    safe = "".join(c for c in name if c.isalnum() or c in "-_. ").strip() or "character"
    if not safe.lower().endswith(".json"):
        safe = f"{safe}.json"
    return safe[:120]


# Google Drive appProperties cap each value at 124 UTF-8 bytes. We only stash
# short URLs there for codex thumbnails; large data: URLs are kept inside the
# character JSON (data.meta.portraitUrl) and skipped here.
_PORTRAIT_APPPROP_MAX = 120


def _derive_short_portrait_url(data: dict) -> str:
    try:
        url = (data.get("meta") or {}).get("portraitUrl") or ""
    except AttributeError:
        return ""
    if not isinstance(url, str):
        return ""
    if url.startswith("data:") or len(url.encode("utf-8")) > _PORTRAIT_APPPROP_MAX:
        return ""
    return url


def list_characters(username: str) -> list[dict]:
    with _drive_lock:
        svc = _get_service()
        folder_id = _get_or_create_user_folder_locked(username)
        q = (
            f"'{folder_id}' in parents and trashed=false "
            f"and mimeType='{JSON_MIME}'"
        )
        items: list[dict] = []
        page_token = None
        while True:
            res = svc.files().list(
                q=q,
                fields=(
                    "nextPageToken,"
                    "files(id,name,mimeType,createdTime,modifiedTime,appProperties)"
                ),
                pageSize=100,
                pageToken=page_token,
                orderBy="modifiedTime desc",
            ).execute()
            for f in res.get("files", []):
                items.append(_file_to_character(f))
            page_token = res.get("nextPageToken")
            if not page_token:
                break
        return items


def create_character(username: str, name: str, char_class: str, level: int, data: dict) -> dict:
    with _drive_lock:
        svc = _get_service()
        folder_id = _get_or_create_user_folder_locked(username)
        content = json.dumps(data, ensure_ascii=False).encode("utf-8")
        media = MediaInMemoryUpload(content, mimetype=JSON_MIME, resumable=False)
        app_props = {
            "name": name,
            "char_class": char_class or "",
            "level": str(level),
            "app": "aurora-codex",
        }
        short_portrait = _derive_short_portrait_url(data)
        if short_portrait:
            app_props["portrait_url"] = short_portrait
        meta = {
            "name": _safe_filename(name),
            "parents": [folder_id],
            "mimeType": JSON_MIME,
            "appProperties": app_props,
        }
        f = svc.files().create(
            body=meta,
            media_body=media,
            fields="id,name,createdTime,modifiedTime,appProperties",
        ).execute()
        out = _file_to_character(f)
        out["data"] = data
        return out


def get_character(username: str, file_id: str) -> Optional[dict]:
    with _drive_lock:
        svc = _get_service()
        folder_id = _get_or_create_user_folder_locked(username)
        try:
            f = svc.files().get(
                fileId=file_id,
                fields="id,name,parents,createdTime,modifiedTime,appProperties",
            ).execute()
        except HttpError as e:
            if e.resp.status in (404, 400):
                return None
            raise
        if folder_id not in (f.get("parents") or []):
            return None  # not owned by this user
        request = svc.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _status, done = downloader.next_chunk()
        raw = buf.getvalue().decode("utf-8", errors="replace") or "{}"
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {"_raw": raw}
        out = _file_to_character(f)
        out["data"] = data
        return out


def update_character(username: str, file_id: str, name: str, char_class: str, level: int, data: dict) -> Optional[dict]:
    with _drive_lock:
        svc = _get_service()
        folder_id = _get_or_create_user_folder_locked(username)
        try:
            existing = svc.files().get(fileId=file_id, fields="id,parents").execute()
        except HttpError as e:
            if e.resp.status in (404, 400):
                return None
            raise
        if folder_id not in (existing.get("parents") or []):
            return None
        content = json.dumps(data, ensure_ascii=False).encode("utf-8")
        media = MediaInMemoryUpload(content, mimetype=JSON_MIME, resumable=False)
        app_props = {
            "name": name,
            "char_class": char_class or "",
            "level": str(level),
            "app": "aurora-codex",
        }
        short_portrait = _derive_short_portrait_url(data)
        # Always send the field (null clears any stale value when the user
        # removed/changed the portrait inside the sheet).
        app_props["portrait_url"] = short_portrait if short_portrait else None
        meta = {
            "name": _safe_filename(name),
            "appProperties": app_props,
        }
        f = svc.files().update(
            fileId=file_id,
            body=meta,
            media_body=media,
            fields="id,name,createdTime,modifiedTime,appProperties",
        ).execute()
        out = _file_to_character(f)
        out["data"] = data
        return out


def update_portrait(username: str, file_id: str, portrait_url: str) -> Optional[dict]:
    """Update only the portrait. Saves to data.meta.portraitUrl + appProperties
    (the latter only when the URL is short enough to fit). Used by the codex
    so users can set a character avatar without re-saving the full sheet."""
    with _drive_lock:
        svc = _get_service()
        folder_id = _get_or_create_user_folder_locked(username)
        try:
            f0 = svc.files().get(
                fileId=file_id,
                fields="id,parents,appProperties",
            ).execute()
        except HttpError as e:
            if e.resp.status in (404, 400):
                return None
            raise
        if folder_id not in (f0.get("parents") or []):
            return None
        # Pull current JSON so we can update data.meta.portraitUrl
        request = svc.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _status, done = downloader.next_chunk()
        try:
            data = json.loads(buf.getvalue().decode("utf-8", errors="replace") or "{}")
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        meta_dict = data.setdefault("meta", {})
        if isinstance(meta_dict, dict):
            if portrait_url:
                meta_dict["portraitUrl"] = portrait_url
            else:
                meta_dict.pop("portraitUrl", None)
        content = json.dumps(data, ensure_ascii=False).encode("utf-8")
        media = MediaInMemoryUpload(content, mimetype=JSON_MIME, resumable=False)
        # Preserve existing appProperties, only overwriting portrait_url
        app_props = dict(f0.get("appProperties") or {})
        if portrait_url and not portrait_url.startswith("data:") \
                and len(portrait_url.encode("utf-8")) <= _PORTRAIT_APPPROP_MAX:
            app_props["portrait_url"] = portrait_url
        else:
            app_props["portrait_url"] = None  # clear / skip large dataURL
        body = {"appProperties": app_props}
        f = svc.files().update(
            fileId=file_id,
            body=body,
            media_body=media,
            fields="id,name,createdTime,modifiedTime,appProperties",
        ).execute()
        return _file_to_character(f)


def delete_character(username: str, file_id: str) -> bool:
    with _drive_lock:
        svc = _get_service()
        folder_id = _get_or_create_user_folder_locked(username)
        try:
            existing = svc.files().get(fileId=file_id, fields="id,parents").execute()
        except HttpError as e:
            if e.resp.status in (404, 400):
                return False
            raise
        if folder_id not in (existing.get("parents") or []):
            return False
        svc.files().delete(fileId=file_id).execute()
        return True
