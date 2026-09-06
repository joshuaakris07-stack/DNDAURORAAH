"""Supabase-backed user storage. Drop-in replacement for ``user_storage``."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

USERS_TABLE = "aurora_users"
_TIMEOUT = httpx.Timeout(15.0, connect=10.0)


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


def _strip(row: dict) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "password_hash": row.get("password_hash", ""),
        "name": row.get("name", ""),
        "role": row.get("role", "user"),
        "created_at": row.get("created_at"),
    }


# ─────────────────────────── Public API ─────────────────────────────


def find_by_username(username: str) -> Optional[dict]:
    username = (username or "").lower()
    params = {"select": "*", "username": f"eq.{username}", "limit": "1"}
    with _client() as c:
        r = c.get(_rest(USERS_TABLE), headers=_headers(), params=params)
    r.raise_for_status()
    rows = r.json()
    return _strip(rows[0]) if rows else None


def find_by_id(uid: str) -> Optional[dict]:
    params = {"select": "*", "id": f"eq.{uid}", "limit": "1"}
    with _client() as c:
        r = c.get(_rest(USERS_TABLE), headers=_headers(), params=params)
    r.raise_for_status()
    rows = r.json()
    return _strip(rows[0]) if rows else None


def list_users() -> list[dict]:
    params = {"select": "*", "order": "created_at.asc"}
    with _client() as c:
        r = c.get(_rest(USERS_TABLE), headers=_headers(), params=params)
    r.raise_for_status()
    return [_strip(row) for row in r.json()]


def create_user(username: str, password_hash: str, name: str, role: str = "user") -> dict:
    username = (username or "").lower()
    body = {
        "id": uuid.uuid4().hex,
        "username": username,
        "password_hash": password_hash,
        "name": (name or "").strip(),
        "role": role,
    }
    with _client() as c:
        r = c.post(
            _rest(USERS_TABLE),
            headers=_headers("return=representation"),
            json=body,
        )
    if r.status_code == 409:
        raise ValueError("Username already taken")
    # PostgREST returns 23505 unique-violation embedded in body
    if r.status_code >= 400:
        try:
            payload = r.json()
            if isinstance(payload, dict) and payload.get("code") == "23505":
                raise ValueError("Username already taken")
        except ValueError:
            raise
        except Exception:
            pass
        r.raise_for_status()
    return _strip(r.json()[0])


def update_user(uid: str, updates: dict) -> Optional[dict]:
    body = {k: v for k, v in updates.items() if k in {"name", "role", "password_hash"}}
    if not body:
        return find_by_id(uid)
    params = {"id": f"eq.{uid}"}
    with _client() as c:
        r = c.patch(
            _rest(USERS_TABLE),
            headers=_headers("return=representation"),
            params=params,
            json=body,
        )
    if r.status_code == 404:
        return None
    r.raise_for_status()
    rows = r.json()
    return _strip(rows[0]) if rows else None


def ensure_admin(username: str, password_hash: str, name: str = "Admin") -> dict:
    """Create the admin user if missing, or refresh its password hash."""
    username = (username or "").lower()
    existing = find_by_username(username)
    if existing:
        if existing.get("password_hash") != password_hash:
            updated = update_user(existing["id"], {"password_hash": password_hash})
            return updated or existing
        return existing
    # Use upsert on username so the call is idempotent even under a race.
    body = {
        "id": uuid.uuid4().hex,
        "username": username,
        "password_hash": password_hash,
        "name": name,
        "role": "admin",
    }
    with _client() as c:
        r = c.post(
            _rest(USERS_TABLE),
            headers={
                **_headers("return=representation,resolution=merge-duplicates"),
                "Prefer": "return=representation,resolution=merge-duplicates",
            },
            params={"on_conflict": "username"},
            json=body,
        )
    r.raise_for_status()
    return _strip(r.json()[0])
