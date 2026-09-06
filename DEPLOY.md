# Updating Aurora yourself (Fly.io + PocketBase)

This is the full "I have the code downloaded and need to push an update, no AI
handy" guide.

## The big picture (read this once)

There are **two separate things** running on Fly.io:

| App on Fly | What it is | Holds your data? | You redeploy it when… |
|------------|-----------|------------------|------------------------|
| `dndlostharcreation` | **PocketBase** (database + auth + file storage) | ✅ **YES** | almost never — it just runs |
| `aurora-dnd-codex`   | **Frontend** (React site, static) | ❌ no | you change the app code / UI / sheet |

**Key idea — there is nothing to "sync".** The frontend does **not** contain a
copy of your data. Every time the site loads, it reads live from PocketBase over
the internet (`https://dndlostharcreation.fly.dev`). So when you redeploy the
frontend, all users/characters/library stay exactly as they are in PocketBase.
Deploying the frontend **cannot touch or overwrite PocketBase** — they are
different apps.

So a normal update = **redeploy the frontend only**. PocketBase is left alone.

---

## One-time setup (on any computer)

1. **Install the Fly CLI**
   - macOS/Linux: `curl -L https://fly.io/install.sh | sh`
   - Windows (PowerShell): `iwr https://fly.io/install.sh -useb | iex`
   Then open a new terminal so `fly` is on your PATH.

2. **Log in** (opens a browser):
   ```
   fly auth login
   ```
   (Or use a token instead: create one at
   https://fly.io/user/personal_access_tokens then
   `export FLY_API_TOKEN="FlyV1 ..."`)

---

## Deploy a frontend update (the usual case)

From the downloaded project folder:

```
cd frontend
fly deploy --app aurora-dnd-codex --remote-only
```

- `--app aurora-dnd-codex` guarantees you're pushing the **frontend**, never
  PocketBase. (`fly.toml` already names this app, but passing it is extra-safe.)
- `--remote-only` builds the image on Fly's servers, so you don't need Docker
  installed locally.
- Takes ~2–4 minutes. When it finishes it prints:
  `Visit your newly deployed app at https://aurora-dnd-codex.fly.dev/`

That's it. Hard-refresh the site (Ctrl/Cmd-Shift-R) to see the changes.

> ⚠️ **Never** run a deploy while inside a PocketBase folder or with
> `--app dndlostharcreation`. Frontend deploys always target `aurora-dnd-codex`.

### If the PocketBase URL ever changes
The URL is baked into the site at build time. If you move PocketBase to a new
address, edit `frontend/fly.toml`:
```toml
[build.args]
  REACT_APP_POCKETBASE_URL = "https://your-new-pocketbase.fly.dev"
```
then redeploy. (Or one-off: `fly deploy --build-arg REACT_APP_POCKETBASE_URL=https://... --app aurora-dnd-codex --remote-only`)

---

## When you ALSO need to touch PocketBase (rare)

You only touch PocketBase for **schema changes** — e.g. adding a new field or a
new collection. Your data itself never needs redeploying.

**Option A — Admin UI (no code):**
1. Go to https://dndlostharcreation.fly.dev/_/ and log in as superuser.
2. Add/edit the collection or field there. Done — the change is instant.

**Option B — from this repo (reproducible):**
```
# needs backend/.env with the PocketBase superuser creds (never commit it)
python3 scripts/pb_setup.py
```
This creates/updates the collections + rules idempotently (safe to re-run;
it never deletes data).

**Option C — import the snapshot:**
PB Admin → Settings → Import collections → upload
`pb_migrations/collections_snapshot.json` → keep "merge" (do NOT enable delete).

> After a schema change, redeploy the frontend only if the app code also changed
> to use the new field.

---

## Handy Fly commands

```
fly status   --app aurora-dnd-codex     # is it up? how many machines?
fly logs     --app aurora-dnd-codex     # live logs (frontend)
fly releases --app aurora-dnd-codex     # deploy history
fly apps list                           # see both apps

# Roll back the frontend to a previous release:
fly releases --app aurora-dnd-codex     # note the version, e.g. v7
fly deploy   --app aurora-dnd-codex --image <image-ref-from-that-release> --remote-only
```

To back up PocketBase (data + files), from the PB machine or via the Admin UI's
"Export collections", or `fly ssh console --app dndlostharcreation` and copy
`/pb_data`. Keeping periodic backups of `pb_data` is the only real safety net for
your data.

---

## Quick checklist for a routine update
1. Make code changes in `frontend/`.
2. `cd frontend && fly deploy --app aurora-dnd-codex --remote-only`
3. Hard-refresh https://aurora-dnd-codex.fly.dev/
4. PocketBase untouched; all data intact. ✅
