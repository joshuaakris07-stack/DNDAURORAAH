# Aurora — D&D 2024 Character Codex

A self-hosted, leather-bound digital grimoire for D&D 2024 characters.
Players sign in with **username + password**, build characters on a
full-featured Aurora sheet, and every save — including the user-accounts
file itself — is written to **one shared Google Drive account** that the
operator owns. End-users never see a Google consent screen. **No
database required.**

## Architecture

```
┌──────────────────────────┐      ┌──────────────────────────┐
│  React frontend          │      │  FastAPI backend         │
│  (static, /sheet/*.html  │ HTTP │  - JWT auth              │
│   iframe character sheet)│ ───▶│  - Google Drive proxy     │
└──────────────────────────┘      └────────────┬─────────────┘
                                                │
                                                ▼
                                  ┌────────────────────────┐
                                  │  Owner Drive           │
                                  │  Aurora Codex/         │
                                  │    _users.json         │
                                  │    <user1>/*.json      │
                                  │    <user2>/*.json      │
                                  └────────────────────────┘
```

## Features

- Username + pass-phrase signup / login (open registration)
- Full D&D 2024 character sheet — every PHB-2024 spell, the complete
  DMG-2024 magic-item catalog with rich descriptions, rest mechanics,
  inventory, attunement, action economy auto-population, charge trackers
- Codex dashboard with portrait thumbnails (per-character)
- Quick Save & manual save → JSON written to your Google Drive folder
- Local JSON download / upload — characters are portable
- Admin role with per-user character counts

## Local development

### Backend

```bash
cd backend
cp .env.example .env       # edit values
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### Frontend

```bash
cd frontend
cp .env.example .env       # edit REACT_APP_BACKEND_URL
yarn install
yarn start
```

Then open http://localhost:3000.

### MongoDB

No database required. Both user accounts (`_users.json`) and character
JSONs live entirely inside the shared Google Drive folder.

### Initial admin

A single admin user is auto-seeded on first backend boot from
`ADMIN_USERNAME` / `ADMIN_PASSWORD`. Defaults: `admin` / `admin123` —
change them in production!

## Deploy

- **Netlify (one platform)** — recommended, free. Hosts the React build
  AND runs the API as a single Netlify Function. Follow
  [`DEPLOY_NETLIFY.md`](./DEPLOY_NETLIFY.md).
- **Render** — alternative if you prefer a Python backend. Follow
  [`DEPLOY_RENDER.md`](./DEPLOY_RENDER.md).

Both paths require no database. The build output is portable: any
static host works for the frontend (Cloudflare Pages, Vercel, S3, etc.)
and any Python host works for the FastAPI backend (Fly.io, Railway,
Cloud Run, a VPS) if you don't want serverless.
