-- M2-B01 — the user's accounts: where money lives.
--
-- RLS is enabled in the very next migration, in the same PR: a table without
-- policies must never exist on main (docs/ops/database-migrations.md#naming).
--
-- Columns per docs/architecture/data-model.md#accounts. Note what is absent:
-- there is no balance column. The current balance is derived from the opening
-- balance plus the transaction ledger, never stored, so it cannot drift
-- (docs/adr/0007-derived-account-balances.md).

-- GCash and Maya are both `ewallet`: spec §5 names them, but the provider is a
-- display concern, not a type. Do not add per-brand values — an enum value per
-- e-wallet would need a migration for every new provider and buys no
-- behaviour (data-model.md#enums).
create type public.account_type as enum (
  'cash',
  'bank',
  'ewallet',
  'credit_card',
  'savings',
  'other'
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type public.account_type not null,

  -- Signed: a credit card opens in debt. The one money column without a
  -- positivity check, deliberately (data-model.md#constraints-summary).
  opening_balance_minor bigint not null default 0,

  -- ISO 4217. Set by the Server Action from the user's profile, never from
  -- the client. char(3) pads, so 'US' becomes 'US ' and fails the allowlist.
  currency char(3) not null,

  -- Required by spec §9: money set aside is not safe to spend. The Server
  -- Action, not SQL, defaults it to true for savings accounts.
  exclude_from_safe_to_spend boolean not null default false,

  -- Archived when set. Archiving hides an account from pickers and totals
  -- while keeping its history; deleting would rewrite the user's past.
  archived_at timestamptz,

  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),

  constraint accounts_name_length
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 60),

  -- The profile allowlist (profiles_currency_allowed), so no account holds a
  -- currency the money code cannot format. Adding a currency changes both.
  constraint accounts_currency_allowed
    check (currency in ('PHP', 'USD', 'EUR', 'JPY'))
);

comment on table public.accounts is
  'Spec §5 accounts. No balance column: the current balance is derived (ADR-0007).';

comment on column public.accounts.opening_balance_minor is
  'Balance when the account was added, in integer minor units of `currency` '
  '(docs/domain/money-and-rounding.md). May be negative: a credit card opens '
  'in debt.';

-- "GCash" and "gcash" are the same account to a human, and indistinguishable
-- in a picker. An index rather than a constraint because it is on an
-- expression; named so the Server Action can map the violation to a field
-- error (M2-B06). Leads with user_id, so it also serves per-user lookups.
create unique index accounts_unique_name
  on public.accounts (user_id, pg_catalog.lower(name));

-- The account list with or without archived accounts. With
-- accounts_unique_name, it makes a (user_id)-only index redundant.
create index accounts_user_archived_idx
  on public.accounts (user_id, archived_at);

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();
