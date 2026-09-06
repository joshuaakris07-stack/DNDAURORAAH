
## Round — 2026-07-16 — FIX: admin autosave/quicksave failing (400/500)
- **Symptom:** As admin (DM Vault), autosaving or quick-saving another user's
  character failed with "Request failed with status code 400 / 500".
- **Root cause:** Heavy image-laden sheets are ~2.8–2.9 MB "clean"; the save
  logic duplicates the whole sheet into `__autosave`, so the stored row reaches
  ~5.7–5.8 MB. Every write used PostgREST `return=representation`, so the backend
  **echoed that entire `data` blob back in the response**. On the deployed
  **Netlify** serverless function (AWS Lambda), responses cap at ~6 MB → the
  oversized response failed (500; intermittently 400/413). The DM/admin hit it
  hardest because the Vault opens everyone's heaviest sheets.
- **Fix (both backends):** write endpoints now request only the summary columns
  (`?select=id,name,char_class,level,portrait_url,created_at,updated_at`) so the
  response no longer contains `data`. Response dropped 5.6 MB → ~278 bytes; data
  still persists. The React frontend never reads `data` from write responses, so
  this is safe.
  - `backend/supabase_storage.py`: `create_character`, `update_character`.
  - `netlify/functions/api.js`: `createChar`, `updateChar` (added `CHAR_SUMMARY_COLS`).
- **Verified:** curl PUT (5.6 MB payload) → 200, 278-byte response, GET confirms
  full data persisted. Browser: admin quick-save on heaviest char (frances 5.8 MB)
  → PUT 200, "Saved to @dungeonmaster's codex", no regression.
- **Env:** project ported into /app; backend/.env holds Supabase creds + JWT + admin.
- **Follow-up (not blocking):** request payload is still ~2x (main + __autosave
  duplicate). To harden very heavy sheets on serverless, consider de-duplicating
  large base64 gallery images across main/__autosave/__slots, or a jsonb-merge
  autosave endpoint that patches only the `__autosave` key.

## Round — 2026-07-16 (b) — Image de-duplication (request payload halved)
- **Goal:** cut the ~2x request payload caused by `__autosave` (and `__slots`)
  duplicating the whole sheet — including multi-MB base64 gallery/portrait images.
- **Approach (React-only, iframe untouched):** new `frontend/src/lib/assets.js`.
  - `packForCloud(blob)` extracts every sizeable `data:` base64 URI (>512B) into a
    shared `__assets` pool, replacing each occurrence with an `asset://<fnv>-<len>`
    token. Identical images across main/__autosave/__slots collapse to ONE pool
    entry. FNV-1a hash + length token → no realistic collisions.
  - `unpackFromCloud(blob)` rehydrates tokens → data URIs and strips `__assets`.
  - Wired into `Sheet.js`: unpack on load (before splitBlob); pack on autosave,
    persistSlots, quick save, and JSON-upload save. The iframe always receives
    fully-hydrated images.
- **Backend:** `derivePortrait` in both `backend/supabase_storage.py` and
  `netlify/functions/api.js` now also rejects `asset://` tokens (stores "" in the
  portrait_url column — same as it already did for `data:` portraits, so the codex
  thumbnail grid is unchanged).
- **Verified:** node round-trip is byte-identical (lossless); frances character
  stored 5.78MB → 2.95MB (49% smaller); browser load shows real images (0 leftover
  tokens, portrait renders), quick-save → PUT 200, reload from the packed store
  hydrates correctly. Both request AND response are now well under the ~6MB limit.
- Backward compatible: old rows without `__assets` load unchanged.

## Round — 2026-07-17 — MIGRATION: Supabase + Netlify → PocketBase (Fly.io)
- **Decision:** PocketBase-native. React talks directly to PocketBase via the JS
  SDK; FastAPI/Netlify + Supabase are RETIRED (files remain but are unused). Access
  control is enforced by PocketBase collection API rules using the logged-in user's
  token — the superuser is NEVER used in the frontend.
- **Schema** (scripts/pb_setup.py, idempotent; snapshot in pb_migrations/):
  - `users` (auth): login by `username`, added `role` (user/admin), email optional.
  - `characters` (base): `owner`→users (cascade), name/char_class/level, `portrait`
    (file field), `data` (json ≤20MB), autodate created/updated.
  - `magic_items`, `spells` (base): shared library.
  - Role-aware API rules (owner-or-admin for characters; admin-write for library;
    open registration as role=user only; user role-escalation blocked).
- **Data migrated** (scripts/pb_migrate_data.py): 12 users (TEMP password
  `AuroraTemp#2026`) + 12 characters (portraits uploaded to the `portrait` file
  field; full `data` blob preserved). Supabase library tables didn't exist → empty.
- **Frontend:** `lib/pocketbase.js` (client), `lib/api.js` rewritten as a PocketBase
  adapter keeping the axios-like `api.get/post/put/delete` surface (pages unchanged),
  `context/AuthContext.js` uses pb auth. `REACT_APP_POCKETBASE_URL` in frontend/.env.
- **Gotchas fixed:** (1) base collections lacked created/updated autodate fields →
  added + backfilled `updated`. (2) This PB build 400s when sorting by autodate
  fields → adapter sorts client-side. (3) 12 sequential count requests + StrictMode
  churn left the admin vault stuck loading → now one getFullList of characters,
  counted in JS.
- **Verified in preview:** username+temp-password login, dashboard, Admin Vault
  (12 users + counts + expand), sheet load (images hydrate), quick-save persists to
  PocketBase ("Saved to @dungeonmaster's codex").
- **Secrets:** superuser creds only in backend/.env; added `.env` to .gitignore.
- **Deferred:** gallery/inline images still base64 in `data` (deduped) — only the
  portrait moved to a file field; user self-service password reset UI; Fly.io deploy
  config (verified in preview only, per request).

## Round — 2026-07-17 (b) — User accounts, gallery→files, Fly.io deploy
- **Accounts & password reset (no SMTP):** new `/account` page + Navbar link.
  AuthContext gained `changePassword({oldPassword,newPassword})` (PocketBase
  update → re-auth, since the token invalidates) and `updateName(name)`. Register
  min password raised to 8 (PB default). Self-service change verified end-to-end.
- **Gallery images → PocketBase file fields:** added `images` (multi-file) to the
  characters collection (+`portrait` already existed). New `lib/images.js`:
  extractBase64() swaps base64 data-URIs for placeholders + File objects;
  applyUrls() restores real file URLs after upload. The API adapter (`writeCharacter`
  in lib/api.js) now: hydrates legacy asset:// tokens → uploads new gallery files
  (images+) + portrait → rewrites `data` to file URLs → prunes unreferenced files
  (images-) / clears removed portrait. Sheet.js no longer packs (sends raw data).
  Legacy characters auto-migrate to files on their next save.
  Verified: frances save moved 4 gallery images + portrait to files; `data`
  2.95MB → 0.32MB (89% smaller); reload renders images from file URLs; 0 base64 left.
- **Fly.io deploy config:** frontend/Dockerfile (build + nginx), frontend/nginx.conf
  (SPA fallback + static sheet/race-art), frontend/fly.toml (bakes
  REACT_APP_POCKETBASE_URL), frontend/.dockerignore, and DEPLOY.md. PocketBase stays
  as the separate Fly app.
- **Verified in preview:** login, save (image→file migration), load (from file URLs),
  registration, password change + re-login. No console errors. Threw-away test user
  cleaned up.

## Round — 2026-07-17 (c) — Fly.io frontend deploy (LIVE)
- Deployed the React frontend as a SEPARATE Fly app **aurora-dnd-codex**
  (org personal, region iad, remote build). PocketBase app **dndlostharcreation**
  was NOT touched (confirmed still deployed).
- Live URL: **https://aurora-dnd-codex.fly.dev/**
- Verified live: root/static/SPA-fallback all 200; PocketBase URL baked into bundle;
  CORS auth 200 from the deployed origin; browser login → dashboard; Admin Vault
  lists users from PocketBase; no console errors.
- Fly token was used only for this deploy (not committed/stored); deploy log removed.

## Round — 2026-07-17 (d) — FIX: custom library not showing in native browsers
- **Issue:** Admin-added spells/magic items (stored fine in PocketBase) did NOT
  appear in the sheet's native "Spell Browser" and "📖 Browse Catalog". They only
  showed in the separate React "Library" modal. No error was thrown.
- **Cause:** the native browsers read hardcoded `SB_SPELLS` / `CATALOG_DATA`; the
  custom PocketBase library was never injected into the iframe.
- **Fix:** added `window._setCustomLibrary(items, spells)` in aurora.html that
  merges custom spells into `SB_SPELLS` (tagged `_custom`, re-callable) and custom
  items into `CATALOG_DATA` under a new "✦ Homebrew" category, then live-refreshes
  any open browser. Sheet.js fetches `/library/magic-items` + `/library/spells`
  once on load and calls it (retries until the iframe is ready).
- **Verified in preview:** Spell Browser shows "Whispered Verdict", Browse Catalog
  shows "Boots of Dogs" under Homebrew; both add to the sheet via "+ Add".
- NOTE: aurora.html is a static build asset — redeploy the frontend (`cd frontend
  && fly deploy`) to get this on the LIVE site.
