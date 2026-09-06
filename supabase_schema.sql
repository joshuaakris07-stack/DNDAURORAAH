-- Aurora Codex — Supabase schema bootstrap.
--
-- Paste this whole file into Supabase → SQL editor → New query → Run
-- once after creating your project. Idempotent: re-running is safe.
--
-- Tables are prefixed `aurora_` so they don't collide with any other
-- project tables you may add later. RLS is left OFF because the
-- backend always connects with the service-role (sb_secret_*) key,
-- which bypasses RLS by design. The frontend never talks to Postgres
-- directly.

create extension if not exists "pgcrypto";

-- ── users ────────────────────────────────────────────────────────────
create table if not exists public.aurora_users (
  id            text        primary key,
  username      text        unique not null,
  password_hash text        not null,
  name          text        not null default '',
  role          text        not null default 'user',
  created_at    timestamptz not null default now()
);

-- ── characters ───────────────────────────────────────────────────────
create table if not exists public.aurora_characters (
  id            uuid        primary key default gen_random_uuid(),
  username      text        not null
                 references public.aurora_users(username)
                 on update cascade on delete cascade,
  name          text        not null,
  char_class    text        not null default '',
  level         int         not null default 1,
  portrait_url  text        not null default '',
  data          jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists aurora_characters_username_idx
  on public.aurora_characters(username);

create index if not exists aurora_characters_updated_idx
  on public.aurora_characters(updated_at desc);

-- ── updated_at trigger ───────────────────────────────────────────────
create or replace function public.aurora_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists aurora_characters_set_updated_at on public.aurora_characters;
create trigger aurora_characters_set_updated_at
  before update on public.aurora_characters
  for each row execute function public.aurora_set_updated_at();

-- ── library: magic items ─────────────────────────────────────────────
-- Shared across all players. Only admins can POST/PUT/DELETE; any
-- authenticated user can GET (backend enforces this — RLS still off
-- because the service-role key is used).
create table if not exists public.aurora_magic_items (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  rarity        text        not null default 'Common',
  item_type     text        not null default 'Wondrous',
  attunement    boolean     not null default false,
  charges       text        not null default '',
  description   text        not null default '',
  created_by    text        not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists aurora_magic_items_name_idx
  on public.aurora_magic_items(lower(name));

drop trigger if exists aurora_magic_items_set_updated_at on public.aurora_magic_items;
create trigger aurora_magic_items_set_updated_at
  before update on public.aurora_magic_items
  for each row execute function public.aurora_set_updated_at();

-- ── library: spells ──────────────────────────────────────────────────
create table if not exists public.aurora_spells (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  level         int         not null default 0,
  school        text        not null default 'Evocation',
  casting_time  text        not null default '1 Action',
  range_text    text        not null default 'Self',
  components    text        not null default 'V, S',
  duration      text        not null default 'Instantaneous',
  description   text        not null default '',
  higher_levels text        not null default '',
  created_by    text        not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists aurora_spells_name_idx
  on public.aurora_spells(lower(name));
create index if not exists aurora_spells_level_idx
  on public.aurora_spells(level);

drop trigger if exists aurora_spells_set_updated_at on public.aurora_spells;
create trigger aurora_spells_set_updated_at
  before update on public.aurora_spells
  for each row execute function public.aurora_set_updated_at();
