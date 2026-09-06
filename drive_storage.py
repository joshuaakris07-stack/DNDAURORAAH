"""End-to-end backend tests for Aurora Character Sheet API.

Covers: root health, auth (register/login/me/wrong-pass), characters CRUD on
Google Drive, portrait endpoint, admin endpoints, and cross-user isolation.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://drive-auth-simple.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "admin"
ADMIN_PASS = "admin123"


def _rand_user(prefix="testu"):
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------- Health ----------------
def test_root_message(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("message") == "Aurora Character Sheet API"


# ---------------- Auth ----------------
class TestAuth:
    def test_register_login_me_flow(self, session):
        username = _rand_user()
        password = "passw0rd!"
        r = session.post(f"{API}/auth/register", json={"username": username, "password": password, "name": "Tester"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data and isinstance(data["access_token"], str)
        assert data["user"]["username"] == username
        token = data["access_token"]

        # /auth/me with Bearer
        r2 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r2.status_code == 200
        assert r2.json()["username"] == username

        # login with same creds
        r3 = requests.post(f"{API}/auth/login", json={"username": username, "password": password})
        assert r3.status_code == 200
        assert r3.json()["user"]["username"] == username

    def test_login_wrong_password(self, session):
        username = _rand_user()
        session.post(f"{API}/auth/register", json={"username": username, "password": "rightpass1", "name": "T"})
        r = requests.post(f"{API}/auth/login", json={"username": username, "password": "wrongpass1"})
        assert r.status_code == 401

    def test_characters_requires_auth(self):
        r = requests.get(f"{API}/characters")
        assert r.status_code == 401


# ---------------- Characters CRUD ----------------
@pytest.fixture(scope="module")
def user_a_token():
    username = _rand_user("usera")
    r = requests.post(f"{API}/auth/register", json={"username": username, "password": "passw0rd!", "name": "User A"})
    assert r.status_code == 200, r.text
    return username, r.json()["access_token"]


@pytest.fixture(scope="module")
def user_b_token():
    username = _rand_user("userb")
    r = requests.post(f"{API}/auth/register", json={"username": username, "password": "passw0rd!", "name": "User B"})
    assert r.status_code == 200, r.text
    return username, r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestCharacters:
    def test_empty_list_for_new_user(self, user_a_token):
        _, tok = user_a_token
        r = requests.get(f"{API}/characters", headers=_auth(tok))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_full_crud_cycle(self, user_a_token):
        _, tok = user_a_token
        payload = {
            "name": "TEST_Aurora",
            "char_class": "Bard",
            "level": 3,
            "data": {"name": "TEST_Aurora", "class": "Bard", "level": 3, "meta": {}},
        }
        r = requests.post(f"{API}/characters", json=payload, headers=_auth(tok))
        assert r.status_code == 200, r.text
        ch = r.json()
        assert ch["name"] == "TEST_Aurora"
        assert ch["char_class"] == "Bard"
        assert ch["level"] == 3
        assert "portrait_url" in ch
        char_id = ch["id"]
        assert isinstance(char_id, str) and len(char_id) > 5

        # GET full
        r2 = requests.get(f"{API}/characters/{char_id}", headers=_auth(tok))
        assert r2.status_code == 200
        full = r2.json()
        assert full["id"] == char_id
        assert full["data"]["class"] == "Bard"

        # UPDATE
        upd = {
            "name": "TEST_AuroraV2",
            "char_class": "Rogue",
            "level": 5,
            "data": {"name": "TEST_AuroraV2", "class": "Rogue", "level": 5, "meta": {}},
        }
        r3 = requests.put(f"{API}/characters/{char_id}", json=upd, headers=_auth(tok))
        assert r3.status_code == 200, r3.text
        assert r3.json()["name"] == "TEST_AuroraV2"
        assert r3.json()["level"] == 5
        assert r3.json()["char_class"] == "Rogue"

        # GET verifies persistence
        r4 = requests.get(f"{API}/characters/{char_id}", headers=_auth(tok))
        assert r4.status_code == 200
        assert r4.json()["name"] == "TEST_AuroraV2"
        assert r4.json()["char_class"] == "Rogue"

        # PORTRAIT set
        portrait = "https://example.com/p.png"
        r5 = requests.put(f"{API}/characters/{char_id}/portrait", json={"portrait_url": portrait}, headers=_auth(tok))
        assert r5.status_code == 200
        assert r5.json()["portrait_url"] == portrait
        # confirm via GET full
        r5b = requests.get(f"{API}/characters/{char_id}", headers=_auth(tok))
        assert r5b.json()["portrait_url"] == portrait
        assert r5b.json()["data"].get("meta", {}).get("portraitUrl") == portrait

        # PORTRAIT clear
        r6 = requests.put(f"{API}/characters/{char_id}/portrait", json={"portrait_url": ""}, headers=_auth(tok))
        assert r6.status_code == 200
        assert r6.json()["portrait_url"] == ""
        r6b = requests.get(f"{API}/characters/{char_id}", headers=_auth(tok))
        assert r6b.json()["portrait_url"] == ""
        assert "portraitUrl" not in (r6b.json()["data"].get("meta") or {})

        # DELETE
        r7 = requests.delete(f"{API}/characters/{char_id}", headers=_auth(tok))
        assert r7.status_code == 200
        r7b = requests.get(f"{API}/characters/{char_id}", headers=_auth(tok))
        assert r7b.status_code == 404

    def test_cross_user_isolation(self, user_a_token, user_b_token):
        _, tok_a = user_a_token
        _, tok_b = user_b_token
        # User A creates
        r = requests.post(f"{API}/characters", json={
            "name": "TEST_Isolated",
            "char_class": "Wizard",
            "level": 1,
            "data": {"name": "TEST_Isolated"},
        }, headers=_auth(tok_a))
        assert r.status_code == 200, r.text
        char_id = r.json()["id"]

        # B's list must not include it
        r_b_list = requests.get(f"{API}/characters", headers=_auth(tok_b))
        assert r_b_list.status_code == 200
        assert all(c["id"] != char_id for c in r_b_list.json())

        # B cannot read it
        r_b_get = requests.get(f"{API}/characters/{char_id}", headers=_auth(tok_b))
        assert r_b_get.status_code == 404

        # B cannot delete it
        r_b_del = requests.delete(f"{API}/characters/{char_id}", headers=_auth(tok_b))
        assert r_b_del.status_code == 404

        # Cleanup
        requests.delete(f"{API}/characters/{char_id}", headers=_auth(tok_a))


# ---------------- Admin ----------------
class TestAdmin:
    @pytest.fixture(scope="class")
    def admin_token(self):
        r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
        assert r.status_code == 200, r.text
        return r.json()["access_token"]

    def test_admin_users_list(self, admin_token, user_a_token):
        username_a, _ = user_a_token
        r = requests.get(f"{API}/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        usernames = [u["username"] for u in users]
        assert username_a in usernames
        # character_count field present
        for u in users:
            assert "character_count" in u

    def test_admin_user_chars(self, admin_token, user_a_token):
        username_a, _ = user_a_token
        r = requests.get(f"{API}/admin/users/{username_a}/characters",
                         headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_non_admin_blocked(self, user_a_token):
        _, tok = user_a_token
        r = requests.get(f"{API}/admin/users", headers=_auth(tok))
        assert r.status_code == 403
