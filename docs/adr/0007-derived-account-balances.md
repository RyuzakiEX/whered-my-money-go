# 0007 — Derive account balances from the ledger rather than storing them

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-01 |
| **Deciders** | @jorge |
| **Affects** | [data-model.md](../architecture/data-model.md#4-opening-balance-is-stored-current-balance-is-derived), [M2](../../tasks/backlog/m2-accounts.md), [M3](../../tasks/backlog/m3-transactions-and-categories.md), every figure built on a balance — the dashboard, Safe to Spend, the Timeline |

## Context

Spec §5 and §22 list `balance` as a field of an account. The obvious schema is a
`balance` column that every transaction write adjusts.

That column has to stay equal to the opening balance plus the signed sum of the
account's transactions, through every write path, forever: insert, edit of
amount, type, or account, delete, both legs of a transfer, and any bulk import
or hand-run SQL. Miss one path and it drifts, silently. A balance that disagrees
with the user's own transaction list makes every other number on the screen
untrustworthy, Safe to Spend included.

Against that: a derived balance costs an aggregate on every read, where a stored
one costs a column read.

## Decision

> We will store only `accounts.opening_balance_minor` and derive the current
> balance from it plus the transaction ledger, through the `account_balances`
> view (`security_invoker = true`).

There is no `balance` column on `accounts`, and none is added later as an
optimisation without superseding this ADR. Until the view lands (M2-B02, done in
M3 after the `transactions` table exists), an account's balance is its opening
balance — correct, because no transactions exist yet. The query module reads it
from one place, so switching to the view changes no caller.

## Consequences

### What this makes easier

- A balance cannot drift: it is a function of the ledger, recomputed on read.
- A write is one row. No paired balance update to make atomic.
- Fixing a ledger bug fixes every balance at once. No repair migration.

### What this makes harder

- Every balance read aggregates the account's transactions. At personal-finance
  scale (10² to 10⁴ rows per user) with the `(user_id, account_id, occurred_on)`
  index this is milliseconds, but it grows with history.
- The view's SQL must sign transfer legs correctly, which needs
  `transactions.transfer_direction`.
- The view must use `security_invoker`, or it bypasses RLS. CI checks this.

### What this forecloses

- Reading a balance as a plain column. Anything that wants one goes through the
  view or `lib/server/queries/accounts.ts`.

## Alternatives considered

### A stored `balance` column maintained by the Server Actions

**Why rejected.** Correct only while every write goes through those actions. A
migration, a seed script, a CSV import, or a manual fix in the SQL editor
bypasses them, and nothing detects the result.

### A stored column maintained by database triggers

**Why rejected.** Closer, since triggers see every write, but the trigger must
handle every case in data-model.md decision 4's table, including a transfer
edited on one leg. Any mistake is still silent, and fixing it needs a repair
migration over every account.

### A materialized view or monthly snapshots

**Not rejected — deferred.** Both keep the balance derived, with a rebuild path,
so they are optimisations within this decision rather than alternatives to it.
Reached for only when a measurement says the plain view is too slow.

## Revisit when

- Dashboard latency against the 5,000-transaction seed (M4-B04, budgets in
  [deployment.md](../ops/deployment.md#performance-budgets)) is dominated by the
  balance aggregate.
- Per-user ledgers grow past ~10⁵ rows.

## References

- [data-model.md](../architecture/data-model.md#4-opening-balance-is-stored-current-balance-is-derived) — the full trade-off table
- [data-model.md](../architecture/data-model.md#derived-views) — the view's SQL
- [rls-policies.md](../architecture/rls-policies.md#views-and-rls) — `security_invoker`
- [ADR-0005](0005-money-as-integer-minor-units.md) — why the sum is exact
