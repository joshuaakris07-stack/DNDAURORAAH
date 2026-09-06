from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional, Annotated
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, BeforeValidator
import re

import supabase_storage as drive_storage
import supabase_user_storage as user_storage
import library_storage

# ============== App ==============
app = FastAPI(title="Aurora Character Sheet API")
api_router = APIRouter(prefix="/api")

# ============== Auth helpers ==============
JWT_ALGORITHM = "HS256"


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, username: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60 * 24),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=86400, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


# ============== Username validation ==============
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_\-.]{3,32}$")


def _normalize_username(v: str) -> str:
    if not isinstance(v, str):
        raise ValueError("username must be a string")
    v = v.strip().lower()
    if not USERNAME_RE.match(v):
        raise ValueError("username must be 3-32 chars, letters/numbers/_/-/. only")
    return v


Username = Annotated[str, BeforeValidator(_normalize_username)]


# ============== Models ==============
class UserPublic(BaseModel):
    id: str
    username: str
    name: str
    role: str = "user"
    created_at: Optional[str] = None


class RegisterIn(BaseModel):
    username: Username
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=80)


class LoginIn(BaseModel):
    username: Username
    password: str


class CharacterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    char_class: Optional[str] = ""
    level: Optional[int] = 1
    data: dict


class PortraitIn(BaseModel):
    portrait_url: str = Field(default="", max_length=200_000)


# ============== Auth dep ==============
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await run_in_threadpool(user_storage.find_by_id, payload["sub"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def user_public(user_doc: dict) -> dict:
    return {
        "id": user_doc["id"],
        "username": user_doc["username"],
        "name": user_doc.get("name", ""),
        "role": user_doc.get("role", "user"),
        "created_at": user_doc.get("created_at"),
    }


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _http_error_to_exc(e: Exception) -> HTTPException:
    status = getattr(getattr(e, "response", None), "status_code", None) \
             or getattr(getattr(e, "resp", None), "status", None)
    logging.getLogger(__name__).exception("Storage backend call failed")
    return HTTPException(status_code=502, detail=f"Storage error ({status}): {str(e)[:200]}")


# ============== Auth endpoints ==============
@api_router.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    try:
        new_user = await run_in_threadpool(
            user_storage.create_user,
            body.username,
            hash_password(body.password),
            body.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise _http_error_to_exc(e)
    access = create_access_token(new_user["id"], new_user["username"])
    refresh = create_refresh_token(new_user["id"])
    set_auth_cookies(response, access, refresh)
    return {"user": user_public(new_user), "access_token": access}


@api_router.post("/auth/login")
async def login(body: LoginIn, response: Response):
    try:
        user = await run_in_threadpool(user_storage.find_by_username, body.username)
    except Exception as e:
        raise _http_error_to_exc(e)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    access = create_access_token(user["id"], user["username"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"user": user_public(user), "access_token": access}


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user_public(user)


# ============== Character endpoints (Google Drive backed) ==============
@api_router.get("/characters")
async def list_characters(user: dict = Depends(get_current_user)):
    try:
        items = await run_in_threadpool(drive_storage.list_characters, user["username"])
    except Exception as e:
        raise _http_error_to_exc(e)
    return items


@api_router.post("/characters")
async def create_character(body: CharacterIn, user: dict = Depends(get_current_user)):
    try:
        out = await run_in_threadpool(
            drive_storage.create_character,
            user["username"],
            body.name.strip(),
            (body.char_class or "").strip(),
            int(body.level or 1),
            body.data,
        )
    except Exception as e:
        raise _http_error_to_exc(e)
    return out


@api_router.get("/characters/{char_id}")
async def get_character(char_id: str, user: dict = Depends(get_current_user)):
    try:
        out = await run_in_threadpool(drive_storage.get_character, user["username"], char_id)
    except Exception as e:
        raise _http_error_to_exc(e)
    if out is None:
        raise HTTPException(status_code=404, detail="Character not found")
    return out


@api_router.put("/characters/{char_id}")
async def update_character(char_id: str, body: CharacterIn, user: dict = Depends(get_current_user)):
    try:
        out = await run_in_threadpool(
            drive_storage.update_character,
            user["username"],
            char_id,
            body.name.strip(),
            (body.char_class or "").strip(),
            int(body.level or 1),
            body.data,
        )
    except Exception as e:
        raise _http_error_to_exc(e)
    if out is None:
        raise HTTPException(status_code=404, detail="Character not found")
    return out


@api_router.delete("/characters/{char_id}")
async def delete_character(char_id: str, user: dict = Depends(get_current_user)):
    try:
        ok = await run_in_threadpool(drive_storage.delete_character, user["username"], char_id)
    except Exception as e:
        raise _http_error_to_exc(e)
    if not ok:
        raise HTTPException(status_code=404, detail="Character not found")
    return {"ok": True}


@api_router.put("/characters/{char_id}/portrait")
async def update_character_portrait(
    char_id: str,
    body: PortraitIn,
    user: dict = Depends(get_current_user),
):
    try:
        out = await run_in_threadpool(
            drive_storage.update_portrait,
            user["username"],
            char_id,
            (body.portrait_url or "").strip(),
        )
    except Exception as e:
        raise _http_error_to_exc(e)
    if out is None:
        raise HTTPException(status_code=404, detail="Character not found")
    return out


@api_router.get("/")
async def root():
    return {"message": "Aurora Character Sheet API"}


# ============== Admin endpoints ==============
@api_router.get("/admin/users")
async def admin_list_users(_admin: dict = Depends(require_admin)):
    """Return all users plus a character count per user (Drive lookup)."""
    try:
        users = await run_in_threadpool(user_storage.list_users)
    except Exception as e:
        raise _http_error_to_exc(e)
    items = []
    for u in users:
        username = u.get("username")
        if not username:
            continue
        try:
            chars = await run_in_threadpool(drive_storage.list_characters, username)
            char_count = len(chars)
        except Exception:
            char_count = -1
        items.append({
            "id": u["id"],
            "username": username,
            "name": u.get("name", ""),
            "role": u.get("role", "user"),
            "character_count": char_count,
            "created_at": u.get("created_at", ""),
        })
    return items


@api_router.get("/admin/users/{username}/characters")
async def admin_list_user_characters(username: str, _admin: dict = Depends(require_admin)):
    if not USERNAME_RE.match(username.lower()):
        raise HTTPException(status_code=400, detail="Invalid username")
    user = await run_in_threadpool(user_storage.find_by_username, username.lower())
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        items = await run_in_threadpool(drive_storage.list_characters, username.lower())
    except Exception as e:
        raise _http_error_to_exc(e)
    return items


@api_router.get("/admin/users/{username}/characters/{char_id}")
async def admin_get_user_character(username: str, char_id: str, _admin: dict = Depends(require_admin)):
    if not USERNAME_RE.match(username.lower()):
        raise HTTPException(status_code=400, detail="Invalid username")
    try:
        out = await run_in_threadpool(drive_storage.get_character, username.lower(), char_id)
    except Exception as e:
        raise _http_error_to_exc(e)
    if out is None:
        raise HTTPException(status_code=404, detail="Character not found")
    return out


@api_router.put("/admin/users/{username}/characters/{char_id}")
async def admin_update_user_character(
    username: str,
    char_id: str,
    body: CharacterIn,
    _admin: dict = Depends(require_admin),
):
    """Admin edit of another user's character."""
    if not USERNAME_RE.match(username.lower()):
        raise HTTPException(status_code=400, detail="Invalid username")
    try:
        out = await run_in_threadpool(
            drive_storage.update_character,
            username.lower(),
            char_id,
            body.name.strip(),
            (body.char_class or "").strip(),
            int(body.level or 1),
            body.data,
        )
    except Exception as e:
        raise _http_error_to_exc(e)
    if out is None:
        raise HTTPException(status_code=404, detail="Character not found")
    return out


# ============== Library endpoints (Magic Items + Spells) ==============
# GET is open to any authenticated user (so players can browse and
# pull entries into their characters). All mutations require admin.

class MagicItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    rarity: str = Field(default="Common", max_length=40)
    item_type: str = Field(default="Wondrous", max_length=40)
    attunement: bool = False
    charges: str = Field(default="", max_length=80)
    description: str = Field(default="", max_length=4000)


class SpellIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    level: int = Field(default=0, ge=0, le=9)
    school: str = Field(default="Evocation", max_length=40)
    casting_time: str = Field(default="1 Action", max_length=80)
    range_text: str = Field(default="Self", max_length=80)
    components: str = Field(default="V, S", max_length=120)
    duration: str = Field(default="Instantaneous", max_length=80)
    description: str = Field(default="", max_length=4000)
    higher_levels: str = Field(default="", max_length=2000)


@api_router.get("/library/magic-items")
async def list_magic_items(_user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(library_storage.list_magic_items)
    except Exception as e:
        raise _http_error_to_exc(e)


@api_router.post("/library/magic-items")
async def create_magic_item(body: MagicItemIn, admin: dict = Depends(require_admin)):
    payload = body.model_dump()
    payload["created_by"] = admin.get("username", "")
    try:
        return await run_in_threadpool(library_storage.create_magic_item, payload)
    except Exception as e:
        raise _http_error_to_exc(e)


@api_router.put("/library/magic-items/{item_id}")
async def update_magic_item(item_id: str, body: MagicItemIn, _admin: dict = Depends(require_admin)):
    try:
        out = await run_in_threadpool(library_storage.update_magic_item, item_id, body.model_dump())
    except Exception as e:
        raise _http_error_to_exc(e)
    if not out:
        raise HTTPException(status_code=404, detail="Magic item not found")
    return out


@api_router.delete("/library/magic-items/{item_id}")
async def delete_magic_item(item_id: str, _admin: dict = Depends(require_admin)):
    try:
        await run_in_threadpool(library_storage.delete_magic_item, item_id)
    except Exception as e:
        raise _http_error_to_exc(e)
    return {"ok": True}


@api_router.get("/library/spells")
async def list_spells(_user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(library_storage.list_spells)
    except Exception as e:
        raise _http_error_to_exc(e)


@api_router.post("/library/spells")
async def create_spell(body: SpellIn, admin: dict = Depends(require_admin)):
    payload = body.model_dump()
    payload["created_by"] = admin.get("username", "")
    try:
        return await run_in_threadpool(library_storage.create_spell, payload)
    except Exception as e:
        raise _http_error_to_exc(e)


@api_router.put("/library/spells/{spell_id}")
async def update_spell(spell_id: str, body: SpellIn, _admin: dict = Depends(require_admin)):
    try:
        out = await run_in_threadpool(library_storage.update_spell, spell_id, body.model_dump())
    except Exception as e:
        raise _http_error_to_exc(e)
    if not out:
        raise HTTPException(status_code=404, detail="Spell not found")
    return out


@api_router.delete("/library/spells/{spell_id}")
async def delete_spell(spell_id: str, _admin: dict = Depends(require_admin)):
    try:
        await run_in_threadpool(library_storage.delete_spell, spell_id)
    except Exception as e:
        raise _http_error_to_exc(e)
    return {"ok": True}


# ============== App setup ==============
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=os.environ.get('CORS_ORIGIN_REGEX', '.*'),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def on_startup():
    """Seed the initial admin user on the Drive-backed user store."""
    admin_username = os.environ.get("ADMIN_USERNAME", "admin").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    try:
        await run_in_threadpool(
            user_storage.ensure_admin,
            admin_username,
            hash_password(admin_password),
            "Admin",
        )
        logger.info(f"Admin ready: {admin_username}")
    except Exception:
        logger.exception("Failed to seed admin user (Drive unreachable?). Continuing.")
