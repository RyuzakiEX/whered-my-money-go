# Database Changes

**Never change the schema through the Supabase Studio UI.** Every schema change
is a committed `.sql` migration. Reference:
[database-migrations.md](../docs/ops/database-migrations.md).

A dashboard change exists in one project's database and nowhere else — absent
from git, absent from other environments, invisible in review, and overwritten
the next time migrations replay.

## The sequence

```bash
# 1. Create the migration
supabase migration new create_accounts
```

```sql
-- 2. Write it. Forward-only. See docs/architecture/data-model.md.
create type account_type as enum (
  'cash', 'bank', 'ewallet', 'credit_card', 'savings', 'other'
);
-- 'ewallet' covers GCash and Maya (spec §5). Deliberately generic:
-- per-brand enum values would need a migration per new wallet.

create table public.accounts (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  name                        text not null check (length(trim(name)) between 1 and 100),
  type                        account_type not null,
  opening_balance_minor       bigint not null default 0,
  currency                    char(3) not null,
  exclude_from_safe_to_spend  boolean not null default false,
  archived_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on column public.accounts.opening_balance_minor is
  'Integer minor units (centavos). Signed — a credit card may open negative.';

create unique index accounts_user_name_unique
  on public.accounts (user_id, lower(name));

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function set_updated_at();
```

```sql
-- 3. RLS. In the same PR, always. A table without policies must never
--    exist on main.
alter table public.accounts enable row level security;

create policy accounts_select_own on public.accounts
  for select using (user_id = auth.uid());

create policy accounts_insert_own on public.accounts
  for insert with check (user_id = auth.uid());

create policy accounts_update_own on public.accounts
  for update using (user_id = auth.uid())
              with check (user_id = auth.uid());

create policy accounts_delete_own on public.accounts
  for delete using (user_id = auth.uid());
```

```bash
# 4. Verify it replays from empty
supabase db reset

# 5. Regenerate types — and COMMIT the result
npm run db:types

# 6. Write the pgTAP isolation test
$EDITOR supabase/tests/rls/accounts.sql
supabase test db

# 7. Update the docs in this SAME PR
$EDITOR docs/architecture/data-model.md
```

## Cross-table ownership

> [!IMPORTANT]
> **The single most important thing on this page.**

When a table references another user-owned table, `user_id = auth.uid()` is
**not enough**.

```sql
-- VULNERABLE. Every predicate passes, and yet:
create policy transactions_insert_own on public.transactions
  for insert with check (user_id = auth.uid());
```

That policy accepts a transaction where `user_id` is yours and `account_id`
belongs to a stranger. You have just written a row referencing someone else's
account. RLS answered "may this user write this row?" — it never asked "does
this row make sense?"

```sql
-- CORRECT
create policy transactions_insert_own on public.transactions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = auth.uid()
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id and c.user_id = auth.uid()
      )
    )
  );
```

**And the pgTAP test must specifically attempt it**, because every other test
passes against the vulnerable policy:

```sql
select throws_ok(
  $$ insert into transactions (user_id, account_id, amount_minor, type, occurred_on)
     values (tests.user_b(), tests.user_a_account(), 100000, 'expense', current_date) $$,
  'new row violates row-level security policy for table "transactions"',
  'user B cannot attach a transaction to user A''s account'
);
```

Full treatment:
[rls-policies.md](../docs/architecture/rls-policies.md#cross-table-ownership).
This applies to `transactions`, `budgets` (category), and `goal_contributions`
(goal).

## What the schema gate checks

`schema-drift.yml`, four assertions over one `supabase start`:

| # | Check | Catches |
|---|---|---|
| 1 | `supabase db reset` replays every migration from empty | A migration depending on hand-applied state |
| 2 | `supabase db diff --schema public` is empty | A change made outside a migration |
| 3 | Committed `database.types.ts` matches the live schema | A stale types file — TypeScript confidently validating against a schema that no longer exists |
| 4 | RLS enabled on every public table, policies present, pgTAP passes | **A table shipped without Row Level Security** |

Check 4 exists because the failure is silent and total: the anon key is public
by design, so an unprotected table is readable by anyone who reads the client
bundle.

## Expand / contract

**Every migration must be backward-compatible with the currently deployed app.**

Not a style preference — Vercel and Supabase deploy independently, so there is
always a window where the new schema is live and the old application code is
still serving requests.

Renaming a column is the canonical trap. `ALTER TABLE ... RENAME COLUMN` is one
statement and it breaks every deployed query using the old name. The compatible
path spans releases:

```text
Release N     EXPAND    Add the new nullable column. Old code ignores it.
Release N     BACKFILL  Populate it. Still nullable, still ignored.
Release N+1   READS     New code reads the new column, writes both.
Release N+2   CONTRACT  Nothing reads the old column. Now drop it.
```

Safe in a single migration:

- Adding a nullable column
- Adding a table, index, view, or enum value
- Adding a *permissive* constraint (one existing data already satisfies)
- Adding an RLS policy

Requires the sequence:

- Renaming or dropping a column
- Narrowing a type
- Adding `not null` without a default
- Adding a constraint existing data violates
- Renaming a table

## Forward-only

**There are no down-migrations.**

Not because rollback is hard, but because on financial data it is destructive: a
down-migration that drops a column deletes transactions someone recorded. And it
would be run mid-incident, at speed, against whichever environment the terminal
happens to be pointed at.

Fix forward. A bad migration is corrected by a new one. The history stays
append-only and auditable.

`supabase db reset` locally is the exception — that is what a local database is
for.

## Naming

```text
20260915140000_create_accounts.sql
20260915141000_accounts_rls.sql
20260920093000_add_accounts_exclude_from_safe_to_spend.sql
```

The CLI supplies the timestamp. Keep the description imperative and snake_case.
One logical change per file; table creation and its policies may be separate
files but land in the same PR.

**Never edit a migration that has been applied beyond local.** It has already
run — editing it means the file no longer describes what happened. Write a new
one.

## Which milestone creates what

| Milestone | Creates |
|---|---|
| M1 | `profiles`, `on auth.users` trigger, shared `set_updated_at()`, profiles RLS |
| M2 | `account_type`, `accounts`, `account_balances` view, accounts RLS |
| M3 | `category_type`, `transaction_type`, `categories`, `transactions`, default-category seeding, RLS **with cross-table checks** |
| M5 | `budget_period`, `budgets`, RLS with category ownership |
| M6 | `goal_status`, `goals`, `goal_contributions`, RLS with transitive goal ownership |
| M7 | `accounts.exclude_from_safe_to_spend`, scheduled-transaction support |
| M8 | `recurrence_frequency`, `recurring_transactions`, RLS |
| V2 | `audit_log` |

Note `account_balances` (M2) depends on `transactions` (M3) — handled explicitly
in `M2-B02`'s acceptance criteria.

## Applying to production

```text
1. Merge (all gates green).
2. supabase db push          ← migrations FIRST
3. Verify: schema correct, RLS on, a smoke query works.
4. Let Vercel deploy the app.
5. Smoke test the affected flow.
```

Migrations before the app, always. New code may need the new schema; old code
tolerates it because of expand/contract. Details:
[10-release.md](10-release.md).

## Next

- [`../docs/architecture/data-model.md`](../docs/architecture/data-model.md) — every column and constraint.
- [`../docs/architecture/rls-policies.md`](../docs/architecture/rls-policies.md) — the full policy matrix.
- [10-release.md](10-release.md) — deploy ordering and rollback.
