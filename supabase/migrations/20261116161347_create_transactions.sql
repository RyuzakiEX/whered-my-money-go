-- M3-B03 — the ledger: every movement of money.
--
-- RLS is enabled two migrations on, in the same PR: a table without policies
-- must never exist on main (docs/ops/database-migrations.md#naming).
--
-- Columns per docs/architecture/data-model.md#transactions. Everything
-- downstream — balances, the dashboard, budgets, Safe to Spend, the timeline —
-- is a view over this table, so its invariants are enforced here rather than
-- trusted to every writer.

-- The direction of a row's money. Carries the sign of amount_minor, which is
-- never negative (data-model.md#1-amount_minor-bigint-always-positive-sign-lives-in-type).
create type public.transaction_type as enum (
  'income',
  'expense',
  'transfer'
);

-- Which leg of a transfer a row is. Two legs of one transfer are otherwise
-- identical by type and amount, and account_balances needs to know which one
-- left the source and which arrived at the destination (ADR-0007).
create type public.transfer_direction as enum (
  'out',
  'in'
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- RESTRICT, not cascade: deleting an account must never silently delete
  -- its history. deleteAccount refuses first with a `blocked` result; this
  -- foreign key is the database backstop (M3-B03, M2-B06).
  account_id uuid not null references public.accounts (id) on delete restrict,

  -- SET NULL: deleting a category leaves its transactions uncategorised, not
  -- gone (M3-B08 documents the rule and shows the count first).
  category_id uuid references public.categories (id) on delete set null,

  -- Integer minor units, ALWAYS positive. The sign comes from `type` (and
  -- `transfer_direction` for a transfer leg), applied once, in views and
  -- lib/core (docs/domain/money-and-rounding.md).
  amount_minor bigint not null,

  -- Denormalised from the account when the row is written, and never
  -- rewritten: a later currency correction on the account must not change
  -- what a past transaction was recorded in (data-model.md#7).
  currency char(3) not null,

  type public.transaction_type not null,
  description text,

  -- Named occurred_on, NOT `date`: `date` is an SQL keyword and a Postgres
  -- type name, legal as a column but a trap in every query that touches it.
  -- A calendar date, never an instant, so a Manila evening never lands in
  -- the next UTC day (docs/domain/recurrence.md). No default: the database's
  -- current_date is the server's UTC date, not the user's; the Server Action
  -- always supplies it.
  occurred_on date not null,

  -- The two legs of a transfer share a group id (data-model.md#3).
  transfer_group_id uuid,
  transfer_direction public.transfer_direction,

  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),

  constraint transactions_amount_positive
    check (amount_minor > 0),

  -- The profile allowlist, as accounts_currency_allowed.
  constraint transactions_currency_allowed
    check (currency in ('PHP', 'USD', 'EUR', 'JPY')),

  constraint transactions_description_length
    check (description is null or pg_catalog.char_length(description) <= 200),

  -- A transfer is not spending or earning. A categorised one would be
  -- double-counted in the breakdown and in budget usage.
  constraint transactions_transfer_no_category
    check (type <> 'transfer' or category_id is null),

  -- A transfer leg without a group is an orphan; a group on a non-transfer
  -- means nothing.
  constraint transactions_transfer_group_shape
    check ((type = 'transfer') = (transfer_group_id is not null)),

  -- account_balances signs a transfer leg by its direction.
  constraint transactions_transfer_direction_shape
    check ((type = 'transfer') = (transfer_direction is not null))
);

comment on table public.transactions is
  'Spec §6 transactions: the ledger. Amounts are positive; direction comes from type (and transfer_direction).';

comment on column public.transactions.amount_minor is
  'Always positive, in integer minor units of `currency` '
  '(docs/domain/money-and-rounding.md). The sign comes from `type`, and from '
  '`transfer_direction` for a transfer leg.';

comment on column public.transactions.occurred_on is
  'Spec §22 `date`, renamed: `date` is an SQL keyword. A calendar date in the '
  'user''s timezone, never an instant.';

-- The transaction list, newest first, with keyset pagination over
-- (occurred_on, id) (M3-B06). `desc` matches the scan direction.
create index transactions_user_occurred_idx
  on public.transactions (user_id, occurred_on desc);

-- Spending by category, budget progress, category trends: range scans over a
-- period, so ascending.
create index transactions_user_category_occurred_idx
  on public.transactions (user_id, category_id, occurred_on);

-- account_balances and per-account history, and the restrict check when an
-- account is deleted.
create index transactions_account_idx
  on public.transactions (account_id);

-- Finding the sibling leg on edit or delete. Partial: most rows are not
-- transfers.
create index transactions_transfer_group_idx
  on public.transactions (transfer_group_id)
  where transfer_group_id is not null;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();
