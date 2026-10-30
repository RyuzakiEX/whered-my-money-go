-- M1-B01 — the user's profile: one row per auth user.
--
-- Created only by the `on_auth_user_created` trigger (a later migration in
-- this PR), never by application code. RLS is enabled in the very next
-- migration, in the same PR: a table without policies must never exist on
-- main (docs/ops/database-migrations.md#naming).
--
-- Columns per docs/architecture/data-model.md#profiles.

create table public.profiles (
  -- Not a surrogate key: one profile per user, and sharing the id makes every
  -- policy `id = auth.uid()`.
  id uuid primary key references auth.users (id) on delete cascade,

  -- Nullable: sign-up asks for email and password only.
  display_name text,

  -- ISO 4217, from the MVP allowlist below. char(3) pads, so 'US' becomes
  -- 'US ' and fails the allowlist rather than slipping through.
  currency char(3) not null default 'PHP',

  -- IANA zone name, never an offset: offsets do not survive DST or
  -- legislative change. Validated as a real zone by the app
  -- (Intl.supportedValuesOf, M1-B07); the database only refuses blanks,
  -- because a check constraint cannot consult pg_timezone_names.
  timezone text not null default 'Asia/Manila',

  -- Drives the spec §30 first-run journey without a client-side flag that
  -- resets on a new device. Additive infrastructure, not a product change.
  onboarding_completed_at timestamptz,

  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),

  -- The MVP currency allowlist (decided 2026-10-30). Adding a currency means a
  -- new migration here AND minor-unit support in lib/core/money — a currency
  -- the database accepts but the money code cannot parse is a broken account.
  constraint profiles_currency_allowed
    check (currency in ('PHP', 'USD', 'EUR', 'JPY')),

  constraint profiles_timezone_not_blank
    check (pg_catalog.btrim(timezone) <> ''),

  constraint profiles_display_name_length
    check (
      display_name is null
      or pg_catalog.char_length(pg_catalog.btrim(display_name)) between 1 and 80
    )
);

comment on table public.profiles is
  'One row per auth user, created by the on_auth_user_created trigger. Spec §4.1 preferences.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
