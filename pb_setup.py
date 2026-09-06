"""One-time migration: Supabase -> PocketBase.

Reads the existing Supabase data (aurora_users / aurora_characters /
aurora_magic_items / aurora_spells) and recreates it in PocketBase using the
superuser token (which bypasses collection API rules).

- Users get a shared TEMP password (MIGRATION_TEMP_PASSWORD) — they reset later.
- Character portraits that are embedded data:URIs (incl. asset:// dedup tokens)
  are uploaded to the new `portrait` file field; the full `data` blob is kept
  as-is (the frontend hydrates dedup tokens on load).
- Idempotent: existing PB records (by username / owner+name / library name) are
  skipped, so re-running won't duplicate.
"""
import os
import re
import json
import base64
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")

PB = os.environ["POCKETBASE_URL"].rstrip("/")
TEMP_PW = os.environ["MIGRATION_TEMP_PASSWORD"]
SB = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SECRET_KEY"]

c = httpx.Client(timeout=60.0)


def pb_auth():
    r = c.post(f"{PB}/api/collections/_superusers/auth-with-password",
               json={"identity": os.environ["POCKETBASE_SUPERUSER_EMAIL"],
                     "password": os.environ["POCKETBASE_SUPERUSER_PASSWORD"]})
    r.raise_for_status()
    c.headers["Authorization"] = f"Bearer {r.json()['token']}"


def sb_get(table, params=None):
    p = {"select": "*"}
    if params:
        p.update(params)
    r = httpx.get(f"{SB}/rest/v1/{table}",
                  headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"},
                  params=p, timeout=60.0)
    if r.status_code == 404:
        print(f"  (Supabase table {table} not found — skipping)")
        return []
    r.raise_for_status()
    return r.json()


def pb_all(collection):
    out, page = [], 1
    while True:
        r = c.get(f"{PB}/api/collections/{collection}/records",
                  params={"perPage": 200, "page": page})
        r.raise_for_status()
        j = r.json()
        out.extend(j["items"])
        if page >= j["totalPages"]:
            break
        page += 1
    return out


def portrait_datauri(data):
    meta = (data or {}).get("meta") or {}
    pu = meta.get("portraitUrl")
    if not isinstance(pu, str):
        return None
    if pu.startswith("data:"):
        return pu
    if pu.startswith("asset://"):
        return (data.get("__assets") or {}).get(pu)
    return None


def datauri_to_file(uri):
    m = re.match(r"data:([^;]+);base64,(.*)", uri, re.DOTALL)
    if not m:
        return None
    mime, b64 = m.group(1), m.group(2)
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
           "image/gif": "gif"}.get(mime, "png")
    return (f"portrait.{ext}", raw, mime)


def main():
    pb_auth()
    print("Authenticated. Loading Supabase + existing PB data…")

    sb_users = sb_get("aurora_users")
    sb_chars = sb_get("aurora_characters")
    sb_items = sb_get("aurora_magic_items")
    sb_spells = sb_get("aurora_spells")
    print(f"Supabase: {len(sb_users)} users, {len(sb_chars)} chars, "
          f"{len(sb_items)} items, {len(sb_spells)} spells")

    pb_users = {u["username"]: u["id"] for u in pb_all("users")}
    pb_chars = {(ch["owner"], ch["name"]) for ch in pb_all("characters")}
    pb_item_names = {i["name"].lower() for i in pb_all("magic_items")}
    pb_spell_names = {s["name"].lower() for s in pb_all("spells")}

    # ---- users ----
    for u in sb_users:
        uname = (u.get("username") or "").lower()
        if not uname or uname in pb_users:
            continue
        body = {
            "username": uname,
            "email": f"{uname}@aurora.local",
            "emailVisibility": False,
            "password": TEMP_PW,
            "passwordConfirm": TEMP_PW,
            "name": u.get("name") or uname,
            "role": "admin" if u.get("role") == "admin" else "user",
        }
        r = c.post(f"{PB}/api/collections/users/records", json=body)
        if r.status_code >= 400:
            print(f"  ! user {uname} failed {r.status_code}: {r.text[:200]}")
            continue
        pb_users[uname] = r.json()["id"]
        print(f"  + user {uname} ({body['role']})")

    # ---- characters ----
    for ch in sb_chars:
        uname = (ch.get("username") or "").lower()
        owner = pb_users.get(uname)
        name = ch.get("name") or "Unnamed"
        if not owner:
            print(f"  ! skip char '{name}' — no PB owner for '{uname}'")
            continue
        if (owner, name) in pb_chars:
            continue
        data = ch.get("data") or {}
        form = {
            "owner": owner,
            "name": name,
            "char_class": ch.get("char_class") or "",
            "level": str(int(ch.get("level") or 1)),
            "data": json.dumps(data),
        }
        files = None
        uri = portrait_datauri(data)
        if uri:
            f = datauri_to_file(uri)
            if f:
                files = {"portrait": f}
        if files:
            r = c.post(f"{PB}/api/collections/characters/records", data=form, files=files)
        else:
            r = c.post(f"{PB}/api/collections/characters/records", json=form)
        if r.status_code >= 400:
            print(f"  ! char '{name}' ({uname}) failed {r.status_code}: {r.text[:200]}")
            continue
        pb_chars.add((owner, name))
        print(f"  + char {name} <- {uname}{' [portrait]' if files else ''}")

    # ---- magic items ----
    for it in sb_items:
        if (it.get("name") or "").lower() in pb_item_names:
            continue
        body = {k: it.get(k) for k in
                ["name", "rarity", "item_type", "attunement", "charges", "description", "created_by"]
                if it.get(k) is not None}
        body["name"] = it.get("name") or "Unnamed"
        r = c.post(f"{PB}/api/collections/magic_items/records", json=body)
        if r.status_code < 400:
            pb_item_names.add(body["name"].lower())
            print(f"  + magic item {body['name']}")
        else:
            print(f"  ! item {body['name']} failed {r.status_code}: {r.text[:150]}")

    # ---- spells ----
    for sp in sb_spells:
        if (sp.get("name") or "").lower() in pb_spell_names:
            continue
        body = {k: sp.get(k) for k in
                ["name", "level", "school", "casting_time", "range_text",
                 "components", "duration", "description", "higher_levels", "created_by"]
                if sp.get(k) is not None}
        body["name"] = sp.get("name") or "Unnamed"
        r = c.post(f"{PB}/api/collections/spells/records", json=body)
        if r.status_code < 400:
            pb_spell_names.add(body["name"].lower())
            print(f"  + spell {body['name']}")
        else:
            print(f"  ! spell {body['name']} failed {r.status_code}: {r.text[:150]}")

    print("Migration complete.")


if __name__ == "__main__":
    main()
