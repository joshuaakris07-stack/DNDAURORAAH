# Test Credentials

## Backend: PocketBase (Fly.io) — https://dndlostharcreation.fly.dev
The app is now **PocketBase-native** (React talks directly to PocketBase; the
old FastAPI/Netlify + Supabase backend is retired/unused).

### App login (collection `users`, login by username)
All migrated users share a TEMP password (should be reset after first login):
- **Temp password for ALL migrated users:** `AuroraTemp#2026`
- Admin account:  username `admin`  / password `AuroraTemp#2026`  (role=admin)
- Other admin:    username `admin123` / `AuroraTemp#2026` (role=admin)
- Sample players: `dungeonmaster`, `remdoy123`, `seraphkim`, `trufflecarbonar`,
  `uitester`, `chickenjockey`, `qatester`, `littleredridinghood`, `uitester2`,
  `usera-602b10d7` — all with `AuroraTemp#2026`.
- New self-registered users choose their own password (min 8 chars, role=user).

### PocketBase superuser (server-side ONLY — never in frontend / never committed)
Stored in `backend/.env` (git-ignored):
- POCKETBASE_URL, POCKETBASE_SUPERUSER_EMAIL, POCKETBASE_SUPERUSER_PASSWORD
- Admin dashboard: https://dndlostharcreation.fly.dev/_/

### Setup / migration scripts
- `python3 scripts/pb_setup.py`        → create/adapt collections (idempotent)
- `python3 scripts/pb_migrate_data.py` → Supabase → PocketBase import (idempotent)
