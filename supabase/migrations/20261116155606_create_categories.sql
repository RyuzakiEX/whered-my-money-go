-- M3-B01 — the user's categories: what money was for.
--
-- RLS is enabled in the very next migration, in the same PR: a table without
-- policies must never exist on main (docs/ops/database-migrations.md#naming).
--
-- Columns per docs/architecture/data-model.md#categories. Categories are
-- per-user copies, not shared rows: a user renaming "Food" must not rename it
-- for everyone. Spec §7's defaults are seeded per user on sign-up (M3-B02).

-- No `transfer` value: a transfer is not spending or earning, so it is never
-- categorised (transactions_transfer_no_category, M3-B03).
create type public.category_type as enum (
  'income',
  'expense'
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,

  -- Decides which transactions may use the category: an income transaction
  -- takes an income category, an expense an expense one (M3-B03's guard).
  type public.category_type not null,

  -- Reaches a chart fill and a CSS context, so only a #rrggbb literal is
  -- accepted. The default is slate, legible on both themes.
  color text not null default '#64748B',

  -- A name from the app's icon set (lucide, kebab-case), never a URL or
  -- markup. No default: the seed and the form always choose one.
  icon text not null,

  -- Marks a spec §7 seeded category. Defaults cannot be deleted (M3-B08).
  is_default boolean not null default false,

  -- Archived when set: hidden from pickers, kept for the history that
  -- references it, same as accounts.archived_at.
  archived_at timestamptz,

  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),

  constraint categories_name_length
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 40),

  constraint categories_color_hex
    check (color ~ '^#[0-9A-Fa-f]{6}$'),

  constraint categories_icon_format
    check (icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and pg_catalog.char_length(icon) <= 40)
);

comment on table public.categories is
  'Spec §7 categories, one copy per user. Seeded with the spec defaults on sign-up.';

-- "Food" and "food" are one category to a human; two of them split spending
-- across identical-looking rows. Scoped by type, so an income "Other" and an
-- expense "Other" may coexist. Named so the Server Action can map the
-- violation to a field error (M3-B08). Leads with user_id.
create unique index categories_unique_name
  on public.categories (user_id, pg_catalog.lower(name), type);

-- Category pickers always filter by transaction type; the settings list
-- groups by it. Not partial on archived_at: settings lists archived rows too.
create index categories_user_type_idx
  on public.categories (user_id, type);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();
