# Database Migrations

**Shape in one sentence:** `supabase/migrations/*.sql` is the only truth about
the schema, migrations are forward-only because down-migrations on financial
data destroy records, and CI proves the claim on every change rather than
trusting it.

Related: [../adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md](../adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md),
[../architecture/data-model.md](../architecture/data-model.md),
[../architecture/rls-policies.md](../architecture/rls-policies.md),
[../../workflow/09-database-changes.md](../../workflow/09-database-changes.md)
(the step-by-step procedure),
[environments.md](environments.md).

## The rule

> **Never change a schema through the Supabase Studio UI.**

A change made in the dashboard exists in that one project's database and nowhere
else. It is absent from git, absent from every other environment, and
overwritten the next time migrations replay. The next developer — including
future-you — has no way to know it happened.

Studio is for *reading* data and testing queries. Every schema change is a
committed `.sql` file.

## Naming

The CLI timestamps files; the description is yours:

```text
supabase/migrations/
  20260910093000_create_profiles.sql
  20260910093500_profiles_rls.sql
  20260915140000_create_accounts.sql
  20260915141000_create_account_balances_view.sql
```

- **One logical change per file.** Table creation and its RLS policies may be
  separate files, but both land in the same PR — a table without policies must
  never exist on `main`.
- **Descriptive, imperative, snake_case.** `create_accounts`, not `update3`.
- **Never edit a migration that has been applied anywhere beyond local.** It has
  already run; editing it means the file no longer describes what happened.
  Write a new migration.

## Forward-only

**There are no down-migrations.**

Not because rollback is hard, but because on financial data it is destructive.
A down-migration that drops a column deletes the transactions someone recorded.
A rollback that reverts a constraint may leave rows that violate the version you
roll back to. And a rollback under pressure — mid-incident, at speed — is
exactly when a destructive operation gets run against the wrong environment.

So: **fix forward.** A bad migration is corrected by a new migration. The
schema history is append-only, which also means it is auditable.

The one exception is local development, where `supabase db reset` drops
everything and replays from scratch. That is the point of a local database.

## Expand / contract

Every migration must be **backward-compatible with the currently deployed app**.

This is not optional, and the reason is structural: Vercel and Supabase deploy
independently. There is always a window — seconds to minutes — where the new
schema is live and the old application code is still serving requests. A
migration that breaks the old code breaks production during that window.

So a change that would break compatibility is split across releases:

```text
Release N      EXPAND
               Add the new nullable column / new table.
               Old code ignores it. Nothing breaks.

Release N      BACKFILL
               Populate it. Still nullable, still ignored.

Release N+1    MIGRATE READS
               New app code reads the new column, writes both.

Release N+2    CONTRACT
               Nothing reads the old column. Now drop it.
```

Renaming a column is the canonical example. `ALTER TABLE ... RENAME COLUMN` is
a single statement and it breaks every deployed query referencing the old name.
The compatible path is: add the new column, backfill, switch reads, drop the old
one a release later.

Concrete example from this schema: spec §22 calls the transaction date field
`date`; the physical column is `occurred_on`
([data-model.md](../architecture/data-model.md)). Because that decision was made
*before* any code existed, it costs nothing. Making it after launch would have
been a four-release sequence.

## What CI verifies

`schema-drift.yml` runs four gates over one `supabase start`. Together they are
what makes "migrations are the source of truth" a fact rather than a policy.

| Gate | Checks | Catches |
|---|---|---|
| **1. Replay** | `supabase db reset` applies every migration to an empty database | A migration depending on hand-applied state, or on another migration's side effect |
| **2. Drift** | `supabase db diff --schema public` is empty | A schema change made outside a migration |
| **3. Types** | `supabase gen types typescript --local` matches the committed file | A stale `database.types.ts`, which makes TypeScript validate against a schema that no longer exists |
| **4a. RLS on** | Every public table has `relrowsecurity = true` | **A new table shipped without Row Level Security** |
| **4b. Policies** | Every RLS table has ≥1 policy (warning) | RLS enabled but no policies — fails closed, but almost always a mistake |
| **4c. Isolation** | `supabase test db` — the pgTAP suite | A policy that exists but does not isolate |

**Gate 4a is the most valuable check in this repository.** The anon key is
public by design ([security-model.md](../security/security-model.md)); RLS is
the only thing standing between a table and every reader of the JavaScript
bundle. A table shipped without it is world-readable, silently. So CI fails the
build rather than warning.

Gate 3 exists because a stale generated types file is worse than none — it
provides confident autocomplete for columns that no longer exist.

The gate needs **no secrets**: it runs a throwaway local Postgres, so it works
on fork pull requests.

## Migration ordering

Which migration creates what, per milestone. This makes the backend tasks
unambiguous about sequencing.

| Milestone | Creates |
|---|---|
| **M1** | `profiles` + `on auth.users` trigger + `set_updated_at()` shared trigger; `profiles` RLS |
| **M2** | `account_type` enum; `accounts`; `account_balances` view; `accounts` RLS |
| **M3** | `category_type`, `transaction_type` enums; `categories`; `transactions`; default-category seeding; RLS **including cross-table ownership** |
| **M5** | `budget_period` enum; `budgets`; RLS with category-ownership check |
| **M6** | `goal_status` enum; `goals`; `goal_contributions`; RLS with transitive goal-ownership check |
| **M7** | `accounts.exclude_from_safe_to_spend`; scheduled-transaction support |
| **M8** | `recurrence_frequency` enum; `recurring_transactions`; RLS |
| **V2** | `audit_log` |

Note `account_balances` (M2) depends on `transactions` (M3). Resolve by creating
the view in M3 after the table, or by creating it in M2 in a form that degrades
gracefully — the dependency is called out in `M2-B02`'s acceptance criteria so
it is handled deliberately.

## Seeds

`supabase/seed.sql` runs on `supabase db reset`.

| Kind | Where | Notes |
|---|---|---|
| **Reference data** | A migration, not the seed | Default categories are seeded per-user by trigger (`M3-B02`), because they belong to a user |
| **Demo data** | `seed.sql` / a script | ~5,000 transactions over six months (`M4-B04`), shared by integration tests, E2E, manual QA, and the performance baseline |

Seeds must be **idempotent** and must never run against production.

## Production procedure

```text
1. Merge the PR (all gates green, including schema).
2. Apply migrations FIRST:     supabase db push
3. Verify:                     schema matches; RLS on; smoke-check a query.
4. Then deploy the app.
5. Smoke test the affected flow on production.
```

**Migrations before app deploy, always.** New app code may require the new
schema; old app code must tolerate it (that is what expand/contract
guarantees). Deploying the app first creates a window where new code meets an
old schema — which breaks immediately rather than during a race.

Release checklist and rollback:
[../../workflow/10-release.md](../../workflow/10-release.md).
