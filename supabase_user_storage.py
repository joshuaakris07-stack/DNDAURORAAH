"""Supabase-backed character storage.

Drop-in replacement for ``drive_storage`` — same public API, just talks
to Supabase PostgREST instead of Google Drive. Service-role key bypasses
RLS, so every call is run as the backend.

All HTTP calls are synchronous (httpx.Client) because the FastAPI
endpoints wrap them with ``fastapi.concurrency.run_in_threadpool``.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

CHARACTERS_TABLE = "aurora_characters"
_TIMEOUT = httpx.Timeout(15.0, connect=10.0)

# Columns for a lightweight write-response (everything except the huge
# `data` jsonb). Echoing `data` back on every save balloons the response
# to several MB and breaks serverless payload limits (Netlify/Lambda 6MB).
_SUMMARY_COLS = "id,name,char_class,level,portrait_url,created_at,updated_at"


def _base_url() -> str:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[: -len("/rest/v1")]
    return url


def _headers(prefer: str = "") -> dict:
    key = os.environ["SUPABASE_SECRET_KEY"]
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def _rest(path: str) -> str:
    return f"{_base_url()}/rest/v1/{path.lstrip('/')}"


def _client() -> httpx.Client:
    return httpx.Client(timeout=_TIMEOUT)


def _to_character_summary(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row.get("name") or "Unnamed",
        "char_class": row.get("char_class") or "",
        "level": int(row.get("level") or 1),
        "portrait_url": row.get("portrait_url") or "",
        "updated_at": row.get("updated_at") or "",
        "created_at": row.get("created_at") or "",
    }


# ─────────────────────────── Public API ─────────────────────────────


def list_characters(username: str) -> list[dict]:
    username = (username or "").lower()
    params = {
        "select": "id,name,char_class,level,portrait_url,created_at,updated_at",
        "username": f"eq.{username}",
        "order": "updated_at.desc",
    }
    with _client() as c:
        r = c.get(_rest(CHARACTERS_TABLE), headers=_headers(), params=params)
    r.raise_for_status()
    return [_to_character_summary(row) for row in r.json()]


def create_character(username: str, name: str, char_class: str, level: int, data: dict) -> dict:
    username = (username or "").lower()
    portrait_url = ""
    try:
        meta = (data.get("meta") or {}) if isinstance(data, dict) else {}
        pu = meta.get("portraitUrl")
        if isinstance(pu, str) and not pu.startswith("data:") and not pu.startswith("asset://"):
            portrait_url = pu
    except AttributeError:
        pass
    body = {
        "username": username,
        "name": name,
        "char_class": char_class or "",
        "level": int(level or 1),
        "portrait_url": portrait_url,
        "data": data or {},
    }
    with _client() as c:
        r = c.post(
            _rest(CHARACTERS_TABLE),
            headers=_headers("return=representation"),
            params={"select": _SUMMARY_COLS},
            json=body,
        )
    r.raise_for_status()
    row = r.json()[0]
    out = _to_character_summary(row)
    return out


def get_character(username: str, char_id: str) -> Optional[dict]:
    username = (username or "").lower()
    params = {
        "select": "id,name,char_class,level,portrait_url,created_at,updated_at,data",
        "id": f"eq.{char_id}",
        "username": f"eq.{username}",
        "limit": "1",
    }
    with _client() as c:
        r = c.get(_rest(CHARACTERS_TABLE), headers=_headers(), params=params)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    row = rows[0]
    out = _to_character_summary(row)
    out["data"] = row.get("data") or {}
    return out


def update_character(username: str, char_id: str, name: str, char_class: str, level: int, data: dict) -> Optional[dict]:
    username = (username or "").lower()
    portrait_url = ""
    try:
        meta = (data.get("meta") or {}) if isinstance(data, dict) else {}
        pu = meta.get("portraitUrl")
        if isinstance(pu, str) and not pu.startswith("data:") and not pu.startswith("asset://"):
            portrait_url = pu
    except AttributeError:
        pass
    body = {
        "name": name,
        "char_class": char_class or "",
        "level": int(level or 1),
        "portrait_url": portrait_url,
        "data": data or {},
    }
    params = {"id": f"eq.{char_id}", "username": f"eq.{username}", "select": _SUMMARY_COLS}
    with _client() as c:
        r = c.patch(
            _rest(CHARACTERS_TABLE),
            headers=_headers("return=representation"),
            params=params,
            json=body,
        )
    if r.status_code == 404:
        return None
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    row = rows[0]
    out = _to_character_summary(row)
    return out


def update_portrait(username: str, char_id: str, portrait_url: str) -> Optional[dict]:
    """Update only the portrait. Mirrors data.meta.portraitUrl into the
    JSON payload AND the dedicated column so the codex grid can render
    the thumbnail without fetching the full sheet."""
    username = (username or "").lower()
    # Fetch the current character so we can patch data.meta.portraitUrl
    current = get_character(username, char_id)
    if current is None:
        return None
    data = current.get("data") or {}
    if not isinstance(data, dict):
        data = {}
    meta = data.setdefault("meta", {})
    if isinstance(meta, dict):
        if portrait_url:
            meta["portraitUrl"] = portrait_url
        else:
            meta.pop("portraitUrl", None)
    body = {
        "portrait_url": portrait_url if portrait_url and not portrait_url.startswith("data:") else "",
        "data": data,
    }
    params = {"id": f"eq.{char_id}", "username": f"eq.{username}"}
    with _client() as c:
        r = c.patch(
            _rest(CHARACTERS_TABLE),
            headers=_headers("return=representation"),
            params=params,
            json=body,
        )
    if r.status_code == 404:
        return None
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    return _to_character_summary(rows[0])


def delete_character(username: str, char_id: str) -> bool:
    username = (username or "").lower()
    params = {"id": f"eq.{char_id}", "username": f"eq.{username}"}
    with _client() as c:
        r = c.delete(
            _rest(CHARACTERS_TABLE),
            headers=_headers("return=representation"),
            params=params,
        )
    if r.status_code == 404:
        return False
    r.raise_for_status()
    rows = r.json()
    return bool(rows)
