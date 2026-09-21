# Data Model

> [!IMPORTANT]
> **PLANNED — no migrations exist yet.** This document is the design that
> [M1](../../tasks/backlog/m1-auth-and-profile.md) through
> [M8](../../tasks/backlog/m9-mvp-hardening-and-launch.md) implement, one migration at a time.
> `supabase/migrations/*.sql` is the schema source of truth
> ([ADR-0002](../adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md));
> this file is the reasoning behind it.

**Shape in one sentence:** nine user-scoped tables holding money as positive
`bigint` minor units with sign carried by an enum, where every balance and every
goal total is *derived* rather than stored, because a stored mutable balance is
the one bug this category of app always ships.

Spec §22 gives the initial schema. This document is the physical design derived
from it: exact Postgres types, nullability, constraints, indexes, and the order
migrations create them in. Where a column here does not appear in spec §22, it is
marked **additive infrastructure, not a product change** — it exists to make the
spec's stated features correct or performant, and it changes no product
behaviour.

Related: [system-architecture.md](system-architecture.md) for the runtime
topology, [rls-policies.md](rls-policies.md) for who may read which row,
[../domain/money-and-rounding.md](../domain/money-and-rounding.md) for the
arithmetic rules, and [../domain/safe-to-spend.md](../domain/safe-to-spend.md)
for the formula that drives several of the choices below.

## Contents

- [Entity relationships](#entity-relationships)
- [Key decisions](#key-decisions)
- [Enums](#enums)
- [Tables](#tables)
- [Derived views](#derived-views)
- [Constraints summary](#constraints-summary)
- [Indexes](#indexes)
- [Triggers](#triggers)
- [Migration ordering](#migration-ordering)
- [What is deliberately absent](#what-is-deliberately-absent)

## Entity relationships

```text
                        ┌──────────────────────┐
                        │  auth.users          │  (Supabase Auth, GoTrue)
                        │  id uuid PK          │
                        └──────────┬───────────┘
                                   │ 1:1  (trigger creates profile)
                                   ▼
                        ┌──────────────────────┐
                        │  profiles            │
                        │  id uuid PK/FK       │
                        │  currency, timezone  │
                        └──────────┬───────────┘
                                   │ 1:N  (user_id on every table below)
        ┌──────────────────┬───────┴────────┬──────────────────┐
        ▼                  ▼                ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────┐  ┌──────────────────┐
│  accounts     │  │  categories   │  │  goals    │  │ recurring_       │
│  id PK        │  │  id PK        │  │  id PK    │  │ transactions     │
│  type         │  │  type         │  │  target   │  │  id PK           │
│  opening_     │  │  (income|     │  │  status   │  │  frequency       │
│  balance_minor│  │   expense)    │  │           │  │  next_date       │
└───┬───────────┘  └───┬───────┬───┘  └─────┬─────┘  └──┬────────────┬──┘
    │                  │       │            │           │            │
    │ N:1              │ N:1   │ 1:N        │ 1:N       │ N:1        │ N:1
    │                  │       │            │           │            │
    │   ┌──────────────┘       ▼            ▼           │            │
    │   │            ┌───────────────┐ ┌──────────────┐ │            │
    │   │            │  budgets      │ │ goal_        │ │            │
    │   │            │  id PK        │ │ contributions│ │            │
    │   │            │  period_start │ │  id PK       │ │            │
    │   │            │  amount_minor │ │  occurred_on │ │            │
    │   │            │  UNIQUE       │ │  amount_minor│ │            │
    │   │            │  (user,cat,   │ └──────┬───────┘ │            │
    │   │            │   period)     │        │         │            │
    │   │            └───────────────┘        │ N:1     │            │
    ▼   ▼                                     ▼ (opt)   ▼            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  transactions                                                            │
│  id PK · user_id · account_id · category_id? · amount_minor > 0           │
│  type (income|expense|transfer) · currency · occurred_on                 │
│  transfer_group_id? ──┐  pairs exactly two rows: the out-leg and in-leg   │
│  recurring_transaction_id?  provenance of a materialised occurrence       │
└───────────────────────┼──────────────────────────────────────────────────┘
                        │
                        └─▶ self-referential grouping, not a FK to a table

DERIVED (views, never stored):
   account_balances     opening_balance_minor ± transaction legs → current
   goal_progress        sum(goal_contributions.amount_minor)     → saved
   V2: audit_log        append-only, see §24 scope
```

Two things the diagram is making explicit, because both are easy to get wrong:

- `transfer_group_id` is **not** a foreign key. There is no `transfers` table.
  A transfer is two `transactions` rows sharing a group id, so a transfer legs
  through the same ledger every other movement does.
- `account_balances` and `goal_progress` are views. No table on this diagram has
  a `balance` or `current_amount` column that anything writes to.

## Key decisions

### 1. `amount_minor bigint`, always positive; sign lives in `type`

Money is stored in the currency's minor unit as an integer — centavos for PHP —
never as `numeric`, never as a float, and never negative.

```sql
amount_minor bigint not null check (amount_minor > 0)
```

Three separate reasons, in priority order:

- **Integers are exact.** Floats are not. `0.1 + 0.2 ≠ 0.3` is not an
  acceptable property for a ledger. `numeric` would also be exact, but it lets a
  fractional centavo exist, and once one does it propagates through every
  budget-progress percentage.
- **`bigint`, not `integer`.** `integer` caps at ~₱21.4M in centavos. Someone
  will enter a house price, a payroll figure, or a typo, and a silent overflow
  in a finance app is unforgivable. `bigint` is free here.
- **Strictly positive, sign derived from `type`.** The alternative — signed
  amounts — means `amount = -500, type = 'income'` is representable, and the
  database has no way to reject it. Every aggregate then needs to decide whether
  to trust the sign or the type, and different queries will decide differently.
  With a positive-only invariant there is exactly one source of direction:

  | `type` | Effect on the account | Effect on cash flow |
  |---|---|---|
  | `income` | `+ amount_minor` | inflow |
  | `expense` | `- amount_minor` | outflow |
  | `transfer` | out-leg `-`, in-leg `+` | neither; net zero |

  The sign is applied once, in SQL views and in `lib/core`, from `type`. See
  [../domain/money-and-rounding.md](../domain/money-and-rounding.md).

The suffix `_minor` on every money column is deliberate friction. A column named
`amount` invites someone to write `amount * 100`; `amount_minor` does not.

### 2. `occurred_on date` — spec calls it `date`

Spec §22 names the transaction date column `date`. **We rename it to
`occurred_on`.** This is a naming change only; no product behaviour differs.

`date` is a reserved word in SQL and a type name in Postgres. It is legal as a
column name but must be quoted or qualified in enough contexts that it will
eventually be got wrong:

```sql
-- Legal, but this is a trap waiting to be stepped in:
select date from transactions order by date desc;
select date(date) from transactions;          -- type-vs-column ambiguity
create index on transactions (user_id, date desc);  -- reads terribly

-- With occurred_on there is nothing to think about:
select occurred_on from transactions order by occurred_on desc;
```

`occurred_on` also reads correctly against its siblings: `created_at` (when the
row was written) versus `occurred_on` (when the money moved). Those are
genuinely different facts — a user entering last week's receipts today has
`occurred_on < created_at` — and a column called `date` obscures the
distinction. Type is `date`, not `timestamptz`: a transaction happens on a
calendar day in the user's timezone, and storing an instant guarantees
month-boundary bugs at the edges of `Asia/Manila`. Same reasoning as
[../domain/recurrence.md](../domain/recurrence.md).

The same rename applies to `recurring_transactions.start_date` → kept as
`start_on`, and `next_date` → kept as `next_on`, for consistency of the
`_on = date`, `_at = timestamptz` convention.

### 3. `transfer_group_id uuid` pairs the two legs of a transfer

Spec §6 lists `transfer` as a transaction type but says nothing about how a
transfer between two of the user's accounts is represented. A single row cannot
do it — one row has one `account_id`, and a transfer touches two.

Modelling choice: **two rows, one group id.**

```sql
transfer_group_id uuid null
```

- The out-leg: `type = 'transfer'`, `account_id = source`, `amount_minor = X`.
- The in-leg: `type = 'transfer'`, `account_id = destination`, `amount_minor = X`.
- Both share `transfer_group_id`.

Why not a `transfers` table with `from_account_id` / `to_account_id`? Because
then every balance query, every account transaction history, and every export
must union two shapes. Keeping transfers in the ledger means
`account_balances` is one query and the account detail page needs no special
case. The cost is that "a transfer" is not a single row — deletes and edits must
act on the group, which is a Server Action concern, enforced in
[api-and-data-access.md](api-and-data-access.md).

Transfers are also excluded from income and expense totals by construction: any
aggregate that computes cash flow filters `type <> 'transfer'`. Without this,
moving ₱10,000 from savings to checking would appear as ₱10,000 of income *and*
₱10,000 of expense, and the dashboard would lie.

**Additive infrastructure, not a product change** — spec §6 requires transfers;
this is how they are stored.

### 4. Opening balance is STORED; current balance is DERIVED

This is the most consequential decision in the document, and the one most likely
to be argued with later.

Spec §5 and §22 both list `balance` on `accounts`. **We do not store a mutable
balance.** We store `opening_balance_minor` — the balance at the moment the user
created the account in the app — and derive the current balance from it plus the
transaction ledger, via the `account_balances` view.

```sql
-- accounts
opening_balance_minor bigint not null default 0
```

```sql
-- current balance is a query, not a column
current_balance_minor
  = opening_balance_minor
  + sum(income legs)
  - sum(expense legs)
  + sum(transfer in-legs)
  - sum(transfer out-legs)
```

**Why a stored mutable balance drifts.** It requires that every write path
update two places atomically and correctly, forever:

| Write | Balance delta that must also happen |
|---|---|
| Insert expense | `-amount` |
| Insert income | `+amount` |
| Update amount | `-old ±, +new ±` |
| Update `type` | reverse old direction, apply new |
| Update `account_id` | `+amount` to old account, `-amount` to new |
| Delete | reverse the original direction |
| Insert transfer | two accounts, opposite directions |
| Edit one leg of a transfer | both accounts |
| Restore a soft-deleted row | reverse of the delete |

Miss any single cell in that table — or ship one non-atomic path, one failed
trigger, one bulk import, one manual `update` in the Supabase SQL editor during
debugging — and the stored balance is wrong. Nothing detects it. The user sees a
balance that does not match the sum of their own transactions, which in a
budgeting app destroys trust in every other number on the screen, including
Safe to Spend. This is the classic budgeting-app bug; it is not hypothetical.

**The trade-off, stated honestly:**

| | Derived (chosen) | Stored |
|---|---|---|
| Correctness | Cannot drift — it is a function of the ledger | Drifts on any missed path |
| Write complexity | Insert one row | Insert plus a correct, atomic delta |
| Read cost | Aggregate over the account's transactions | Single column read |
| Backfill after a bug fix | Automatic; the view recomputes | Requires a repair migration |
| Scale ceiling | Degrades as history grows | Flat |

The read cost is the real objection. At the scale this product operates —
personal finance, on the order of 10² to 10⁴ transactions per user, with an index
on `(user_id, account_id)` — a sum over a user's ledger is a few milliseconds.
The mitigations, in the order we would reach for them:

1. Index-only aggregation via the view (MVP; sufficient).
2. A materialized view refreshed on write, if dashboard latency demands it.
3. A monthly `account_balance_snapshots` rollup so the view sums only the
   current period. This preserves derivation — snapshots are a cache with a
   rebuild path, not a mutable truth.

> [!IMPORTANT]
> This decision is a candidate **ADR-0007** — *Derived account balances over a
> stored mutable balance*. It is a schema-shaping choice with a real performance
> trade-off and a plausible dissent, which is exactly the bar for an ADR. Write
> it before M2 lands, so the reasoning is on record before someone "optimises"
> the view into a column. See [../adr/README.md](../adr/README.md).

`goals.current_amount` follows identical reasoning; see decision 6.

### 5. `accounts.exclude_from_safe_to_spend boolean`

Spec §9 defines Safe to Spend as current balance plus expected income minus
upcoming expenses, planned savings, and debt payments. Taken literally against
all accounts, it produces a number that is wrong in a way users will notice
immediately: an emergency fund of ₱100,000 sitting in a savings account makes
Safe to Spend read ₱100,000+, which is the exact opposite of the feature's
purpose. Money earmarked as savings is *not* safe to spend.

```sql
exclude_from_safe_to_spend boolean not null default false
```

Default `false` so behaviour is unsurprising, with the seeded default flipped to
`true` for accounts created with `type = 'savings'`. The user can override per
account — a "savings account" they actually spend from, or a cash account they
treat as untouchable.

**Additive infrastructure, not a product change** — it is required for spec §9 to
compute a defensible number. Consumed by
[../domain/safe-to-spend.md](../domain/safe-to-spend.md).

Credit cards need related but distinct handling: their balance is a liability,
not spendable cash. Handled in the domain layer via `account_type`, not another
flag.

### 6. `goal_contributions` is a NEW table

Spec §13 lists "Add contributions" as a goal feature, and spec §22 gives `goals`
a `current_amount` column. Those two requirements are in tension: `current_amount`
as a stored, mutable number reproduces exactly the drift problem from decision 4,
and it also throws away the contribution history that spec §13's "View projected
completion date" and V2's Goal Impact (spec §14) both need.

So: **a new `goal_contributions` table**, and `goals.current_amount` becomes
derived.

| Question | Answerable with stored `current_amount`? | With `goal_contributions`? |
|---|---|---|
| How much is saved? | Yes | Yes (sum) |
| When did they contribute? | No | Yes |
| What is their monthly savings rate? | No | Yes |
| Projected completion date (§13) | No — needs a rate | Yes |
| Goal Impact (§14, V2) | No | Yes |
| Undo a contribution | Not reliably | Delete a row |

The projected-completion-date feature the spec explicitly asks for is not
implementable without contribution history. The table is not scope creep; it is
what §13 requires.

A contribution may optionally reference the `transactions` row that funded it
(`transaction_id`), so a transfer into a savings account can be recorded as a
goal contribution without double-counting. Nullable, because a user may log a
contribution without a matching ledger entry.

**Additive infrastructure, not a product change.**

### 7. `currency char(3)` denormalized onto transactions

`profiles.currency` is the user's preference and `accounts.currency` is the
account's denomination, yet `transactions` carries its own `currency` column.
That is a deliberate denormalization.

A transaction is a historical fact. If a user changes their profile currency, or
an account's currency is corrected, every past transaction must keep the
currency it was actually recorded in — otherwise ₱450 spent on lunch silently
becomes $450, and a year of reports is retroactively wrong. Joining to
`accounts` for currency means the display value of a 2025 row depends on a 2026
edit.

```sql
currency char(3) not null  -- ISO 4217, uppercase; immutable once written
```

`char(3)` rather than `text`: ISO 4217 codes are exactly three characters, and
the fixed width documents that. A check constraint enforces uppercase.

The MVP does no multi-currency arithmetic — mixed currency in one computation is
an explicit error, per
[system-architecture.md](system-architecture.md#non-goals). This column does not
enable multi-currency; it makes the eventual addition non-destructive, and makes
today's data honest.

Same reasoning applies to `goal_contributions.currency` and
`budgets.currency`.

**Additive infrastructure, not a product change.**

## Enums

Native Postgres enums, not lookup tables and not `text` with a check. Enums give
type safety, appear in generated TypeScript via `supabase gen types`, and cost
nothing. The trade-off is that adding a value requires a migration — which for a
closed set like transaction direction is a feature, not a limitation.

| Enum | Values | Notes |
|---|---|---|
| `account_type` | `cash`, `bank`, `ewallet`, `credit_card`, `savings`, `other` | Spec §5's examples. GCash and Maya are both `ewallet` — the provider is a display concern, not a type |
| `transaction_type` | `income`, `expense`, `transfer` | Spec §6. Carries the sign of `amount_minor` |
| `category_type` | `income`, `expense` | Spec §7. No `transfer` value — transfers are uncategorised by constraint |
| `budget_period` | `monthly` | Spec §11 is monthly-only for MVP. The enum exists so `weekly`/`yearly` are an `alter type`, not a column change |
| `recurrence_frequency` | `weekly`, `biweekly`, `monthly`, `quarterly`, `yearly` | Spec §15 verbatim |
| `goal_status` | `active`, `achieved`, `paused`, `archived` | Additive infrastructure. A goal list needs to distinguish "reached ₱100,000" from "gave up" without deleting history |

> [!NOTE]
> `ewallet` covers GCash and Maya (spec §5 names both). A provider column is not
> added: the MVP has no provider-specific behaviour, and an unused column that
> looks like it means something is worse than no column.

`budget_period` having a single value looks odd, and is intentional. It reserves
the concept without implementing weekly budgets, so M5's schema does not change
when V2 adds them. Same for `goal_status`'s `paused`.

## Tables

Conventions applied throughout, stated once:

- `id uuid primary key default gen_random_uuid()` — UUIDs so ids can be
  generated client-side for optimistic UI without a round trip, and so an id
  leaks no information about row count or creation order.
- `user_id uuid not null references auth.users(id) on delete cascade` on every
  user table. Not `references profiles(id)`: `auth.users` is the identity of
  record, and `auth.uid()` in RLS returns exactly that.
- `created_at timestamptz not null default now()`, `updated_at timestamptz not
  null default now()` — instants, so `timestamptz`. Contrast the `_on` date
  columns.
- Foreign keys carry an explicit `on delete` rule. There are no defaults left
  implicit; the deletion semantics of financial data are a product decision.

### `profiles`

1:1 with `auth.users`. Created by trigger on sign-up, never by application code
— see [rls-policies.md](rls-policies.md).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | — | PK and FK → `auth.users(id) on delete cascade`. Not a separate surrogate key: one profile per user, and sharing the id makes every RLS policy `id = auth.uid()` |
| `display_name` | `text` | yes | `null` | Spec §22 `name`. Nullable — sign-up asks for email and password only; a required name is friction on the critical path. Check `length between 1 and 80` when present |
| `currency` | `char(3)` | no | `'PHP'` | Spec §4.1 currency preference. ISO 4217 uppercase. PHP default per spec's ₱ examples |
| `timezone` | `text` | no | `'Asia/Manila'` | Spec §4.1. IANA name, not an offset — offsets do not survive DST or legislative change. Validated against `pg_timezone_names` |
| `onboarding_completed_at` | `timestamptz` | yes | `null` | **Additive infrastructure, not a product change.** Drives the spec §30 first-run journey without a client-side flag that resets on a new device |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Maintained by trigger |

### `accounts`

Spec §5. Note the absence of a `balance` column — see
[decision 4](#4-opening-balance-is-stored-current-balance-is-derived).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `auth.users(id) on delete cascade` |
| `name` | `text` | no | — | Check `length between 1 and 60`. Not unique — two accounts may legitimately be called "Savings" |
| `type` | `account_type` | no | `'bank'` | Spec §5 |
| `opening_balance_minor` | `bigint` | no | `0` | Balance when the account was added. **May be negative** — a credit card starts in debt. This is the one money column without a `> 0` check, and the exception is documented in the constraint |
| `currency` | `char(3)` | no | — | ISO 4217. Defaults from `profiles.currency` in the Server Action, not in SQL, so the default is visible in the form |
| `exclude_from_safe_to_spend` | `boolean` | no | `false` | **Additive infrastructure, not a product change** — required by spec §9. See [decision 5](#5-accountsexclude_from_safe_to_spend-boolean) |
| `is_archived` | `boolean` | no | `false` | **Additive infrastructure, not a product change.** Spec §5 says "delete account", but a hard delete cascades away the transaction history that every past report depends on. Archive hides it from pickers and keeps the ledger intact. Hard delete stays available and is explicit about what it destroys |
| `display_order` | `smallint` | no | `0` | **Additive infrastructure, not a product change.** Stable account ordering; without it list order is whatever Postgres returns |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Trigger |

### `categories`

Spec §7. Seeded with the spec's default sets on sign-up by the same trigger that
creates the profile.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `auth.users(id) on delete cascade`. Categories are per-user copies, not shared rows — a user renaming "Food" must not rename it for everyone, and RLS on a shared table would be far more delicate |
| `name` | `text` | no | — | Check `length between 1 and 40` |
| `type` | `category_type` | no | — | `income` or `expense`. Determines which transaction types may reference it |
| `color` | `text` | no | `'#64748B'` | Spec §7 "choose category color". Check against `^#[0-9A-Fa-f]{6}$` — an unvalidated color string reaches a chart and a CSS context |
| `icon` | `text` | yes | `null` | Spec §7 "choose category icon". A name from the app's icon set, not a URL or markup |
| `is_default` | `boolean` | no | `false` | **Additive infrastructure, not a product change.** Marks a seeded category, so onboarding can offer "reset to defaults" and so analytics can tell customised users from default ones |
| `is_archived` | `boolean` | no | `false` | **Additive infrastructure, not a product change.** Same reasoning as `accounts.is_archived` — deleting a category orphans historical transactions |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Trigger |

### `transactions`

Spec §6. The core table; every index and constraint here earns its place.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `auth.users(id) on delete cascade` |
| `account_id` | `uuid` | no | — | FK → `accounts(id) on delete restrict`. **`restrict`, not `cascade`**: deleting an account must not silently erase its financial history. The Server Action either archives the account or requires the user to confirm the transaction deletion explicitly |
| `category_id` | `uuid` | yes | `null` | FK → `categories(id) on delete set null`. Nullable for two reasons: transfers must be uncategorised (constraint below), and an uncategorised expense is a legitimate intermediate state — forcing a category at entry time makes the spec §33 "add a transaction in seconds" flow slower |
| `amount_minor` | `bigint` | no | — | Check `> 0`. Sign from `type`. See [decision 1](#1-amount_minor-bigint-always-positive-sign-lives-in-type) |
| `currency` | `char(3)` | no | — | Denormalized and immutable. See [decision 7](#7-currency-char3-denormalized-onto-transactions) |
| `type` | `transaction_type` | no | — | `income` / `expense` / `transfer` |
| `description` | `text` | yes | `null` | Spec §6. Check `length <= 200`. Never logged — see [observability.md](observability.md) |
| `occurred_on` | `date` | no | `current_date` | Spec §22 `date`, renamed. See [decision 2](#2-occurred_on-date--spec-calls-it-date) |
| `transfer_group_id` | `uuid` | yes | `null` | Pairs the two legs of a transfer. See [decision 3](#3-transfer_group_id-uuid-pairs-the-two-legs-of-a-transfer). **Additive infrastructure, not a product change** |
| `recurring_transaction_id` | `uuid` | yes | `null` | FK → `recurring_transactions(id) on delete set null`. Provenance of a materialised occurrence, so the timeline can dedupe a projected occurrence against the real transaction that fulfilled it. **Additive infrastructure, not a product change** — required by [../domain/recurrence.md](../domain/recurrence.md). V2 populates it; the column ships in M2 so no later migration rewrites the table |
| `created_at` | `timestamptz` | no | `now()` | Distinct from `occurred_on` |
| `updated_at` | `timestamptz` | no | `now()` | Trigger |

### `budgets`

Spec §11. Monthly category budgets.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `auth.users(id) on delete cascade` |
| `category_id` | `uuid` | no | — | FK → `categories(id) on delete cascade`. `cascade` here, unlike transactions: a budget for a deleted category is meaningless, and unlike a transaction it records no historical fact worth keeping |
| `amount_minor` | `bigint` | no | — | Check `> 0`. A budget of zero is a deleted budget |
| `currency` | `char(3)` | no | — | See decision 7 |
| `period` | `budget_period` | no | `'monthly'` | Spec §22 `period` |
| `period_start` | `date` | no | — | **Additive infrastructure, not a product change.** Spec §22 has `period` but no period *instance*, which makes "this month's Food budget" unrepresentable and "budget progress" (§11) uncomputable. Constrained to the first day of a month while `period` is `monthly` |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Trigger |

Budgets are per-period rows, not a single row edited each month. That keeps
history: "did I stay within budget in July?" is answerable, and spec §16's
monthly comparison and V2's forecasting both need past targets.

### `goals`

Spec §13. `current_amount` is **not** a column — see
[decision 6](#6-goal_contributions-is-a-new-table).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `auth.users(id) on delete cascade` |
| `name` | `text` | no | — | Check `length between 1 and 80` |
| `target_amount_minor` | `bigint` | no | — | Check `> 0`. Spec §22 `target_amount` |
| `currency` | `char(3)` | no | — | See decision 7 |
| `target_date` | `date` | yes | `null` | Spec §13 "set target date". Nullable — "save ₱100,000 eventually" is a real goal. With no target date, projected completion is computed from contribution rate alone |
| `status` | `goal_status` | no | `'active'` | **Additive infrastructure, not a product change.** See [Enums](#enums) |
| `account_id` | `uuid` | yes | `null` | FK → `accounts(id) on delete set null`. **Additive infrastructure, not a product change.** Optionally links a goal to the account holding the money, so spec §9's planned-savings deduction can avoid double-counting a savings account that is both excluded from Safe to Spend and backing a goal |
| `achieved_at` | `timestamptz` | yes | `null` | **Additive infrastructure, not a product change.** Set when contributions first reach the target. Stored rather than derived because it is a moment in time, not a running total — and a later withdrawal should not erase the fact that the goal was reached |
| `display_order` | `smallint` | no | `0` | **Additive infrastructure, not a product change** |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Trigger |

### `goal_contributions`

**New table.** Not in spec §22; required by spec §13's "Add contributions" and
"View projected completion date". See
[decision 6](#6-goal_contributions-is-a-new-table).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `auth.users(id) on delete cascade`. Denormalized from `goals` so RLS is a single-column predicate on the hot path rather than a join. The [cross-table ownership](rls-policies.md#cross-table-ownership) check still validates the `goal_id` |
| `goal_id` | `uuid` | no | — | FK → `goals(id) on delete cascade`. Contributions have no meaning without their goal |
| `amount_minor` | `bigint` | no | — | Check `> 0`. A withdrawal is a separate concern, not a negative contribution — same reasoning as decision 1 |
| `currency` | `char(3)` | no | — | See decision 7 |
| `occurred_on` | `date` | no | `current_date` | When the money was set aside. Drives the contribution-rate calculation |
| `note` | `text` | yes | `null` | Check `length <= 200` |
| `transaction_id` | `uuid` | yes | `null` | FK → `transactions(id) on delete set null`. Optional link to the ledger entry that funded this contribution. `set null` so deleting the transaction does not silently reduce goal progress |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Trigger |

### `recurring_transactions`

Spec §15 — a **V2 feature**, but the table ships in M2 alongside `transactions`.
Reason: `transactions.recurring_transaction_id` needs a target for its foreign
key, and adding both a table and a column to a populated `transactions` table
later is a strictly worse migration than shipping an empty table now. The V2
work is UI, actions, and recurrence expansion — no schema change.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `auth.users(id) on delete cascade` |
| `account_id` | `uuid` | no | — | FK → `accounts(id) on delete cascade`. `cascade`, unlike transactions: a rule is a future intention, not a historical fact |
| `category_id` | `uuid` | yes | `null` | FK → `categories(id) on delete set null` |
| `amount_minor` | `bigint` | no | — | Check `> 0` |
| `currency` | `char(3)` | no | — | See decision 7 |
| `type` | `transaction_type` | no | — | Check `type <> 'transfer'` — a recurring transfer is a V3 concern and half-supporting it is worse than not |
| `description` | `text` | yes | `null` | Spec §15 |
| `frequency` | `recurrence_frequency` | no | — | Spec §15 |
| `interval_count` | `smallint` | no | `1` | **Additive infrastructure, not a product change.** "Every 2 months" without adding enum values. Check `between 1 and 52` |
| `start_on` | `date` | no | — | Spec §15 `start_date`, renamed per the `_on` convention |
| `next_on` | `date` | yes | `null` | Spec §15 `next_date`. Nullable: `null` means the rule has ended. Indexed — this is the column the timeline and the future cron job scan |
| `end_on` | `date` | yes | `null` | **Additive infrastructure, not a product change.** A 12-month loan is a real recurring expense with a real end; without this it projects forever and corrupts the timeline |
| `day_of_month` | `smallint` | yes | `null` | **Additive infrastructure, not a product change.** Check `between 1 and 31`. "Rent on the 30th" must land on Feb 28 — the clamping rule lives in [../domain/recurrence.md](../domain/recurrence.md), and the intended day has to be stored to clamp correctly rather than drift |
| `is_paused` | `boolean` | no | `false` | **Additive infrastructure, not a product change.** Pausing a subscription is spec §18's "what if I stop a subscription" made real without deleting the rule |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Trigger |

### `audit_log` (V2 stub)

Spec §24 asks for "audit logging where appropriate". The MVP does not write to
this table; M8 creates it empty so the shape is settled and RLS is correct
before anything depends on it. Scope, retention, and the distinction from
application logs are in [observability.md](observability.md#audit-log).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `bigint` | no | `generated always as identity` | Ordered append-only log; a UUID would lose insertion order, which is the point of a log. The only non-UUID PK in the schema |
| `user_id` | `uuid` | yes | — | FK → `auth.users(id) on delete set null`. **Nullable and `set null`**: an audit record of a deleted account's actions must survive the deletion, or the log is useless for exactly the incident it exists for |
| `actor_id` | `uuid` | yes | `null` | Who performed the action. Equals `user_id` today; differs once V3 adds shared household budgets |
| `action` | `text` | no | — | `<entity>.<verb>` — `account.created`, `goal.deleted`, `auth.password_reset_requested`. Text rather than an enum: audit vocabulary grows continuously, and an `alter type` per new event is friction that discourages logging |
| `entity_type` | `text` | yes | `null` | `account`, `budget`, `goal`, `transaction` |
| `entity_id` | `uuid` | yes | `null` | Not a FK — the referenced row may be gone; that is often the event being recorded |
| `metadata` | `jsonb` | no | `'{}'` | Non-sensitive context only. **No amounts, no descriptions, no PII.** See [observability.md](observability.md#must-never-be-logged) |
| `ip_hash` | `text` | yes | `null` | Salted hash, never a raw IP. Enough to spot "logins from 40 addresses", not enough to be a location record |
| `occurred_at` | `timestamptz` | no | `now()` | No `updated_at` — an append-only log has no update path, and RLS grants no `update` or `delete` to anyone |

## Derived views

Views, not tables. Each is defined with `security_invoker = true` so the caller's
RLS applies — a view without it runs as its owner and is a straightforward RLS
bypass. See [rls-policies.md](rls-policies.md).

```sql
create view account_balances with (security_invoker = true) as
select
  a.id                       as account_id,
  a.user_id,
  a.currency,
  a.opening_balance_minor,
  a.opening_balance_minor + coalesce(sum(
    case
      when t.type = 'income'                          then  t.amount_minor
      when t.type = 'expense'                         then -t.amount_minor
      when t.type = 'transfer' and t.account_id = a.id then
        -- direction of a transfer leg is decided by the ledger row itself:
        -- the out-leg is stored on the source account, the in-leg on the
        -- destination, so a leg's own transfer_direction settles the sign.
        case when t.transfer_direction = 'out' then -t.amount_minor
             else t.amount_minor end
    end
  ), 0)                      as current_balance_minor
from accounts a
left join transactions t on t.account_id = a.id
group by a.id;
```

> [!NOTE]
> The `case` above needs one extra column on `transactions` to be
> unambiguous: `transfer_direction` (`in` / `out`, null for non-transfers).
> Two legs of a group are otherwise indistinguishable by amount and type
> alone. **Additive infrastructure, not a product change** — add it to
> `transactions` in the same migration as `transfer_group_id`, with
> `check ((type = 'transfer') = (transfer_direction is not null))`.

```sql
create view goal_progress with (security_invoker = true) as
select
  g.id   as goal_id,
  g.user_id,
  g.currency,
  g.target_amount_minor,
  coalesce(sum(c.amount_minor), 0)                      as saved_minor,
  greatest(g.target_amount_minor
           - coalesce(sum(c.amount_minor), 0), 0)       as remaining_minor,
  count(c.id)                                           as contribution_count,
  min(c.occurred_on)                                    as first_contribution_on,
  max(c.occurred_on)                                    as last_contribution_on
from goals g
left join goal_contributions c on c.goal_id = g.id
group by g.id;
```

`goal_progress` deliberately does **not** compute a projected completion date.
That is forecasting math, and forecasting math lives in `lib/core` where it is
unit-testable without a database and reusable by V2 What-If
([source-structure.md](source-structure.md#why-libcore-is-quarantined)). The
view supplies inputs; it does not make predictions.

Views not created: no `dashboard_summary` view. Dashboard composition is
`lib/core`'s job, and a view that encodes product formulas puts the most
volatile logic in the least testable layer.

## Constraints summary

Every constraint below is named explicitly. Auto-generated names produce error
messages nobody can map back to a rule, and the Server Action layer needs stable
names to translate a violation into a user-facing message
([api-and-data-access.md](api-and-data-access.md)).

| Constraint | Table | Definition | Why |
|---|---|---|---|
| `transactions_amount_positive` | `transactions` | `check (amount_minor > 0)` | Sign lives in `type`; a negative amount would make direction ambiguous |
| `budgets_amount_positive` | `budgets` | `check (amount_minor > 0)` | A zero budget is a deleted budget |
| `goals_target_positive` | `goals` | `check (target_amount_minor > 0)` | |
| `goal_contributions_amount_positive` | `goal_contributions` | `check (amount_minor > 0)` | |
| `recurring_amount_positive` | `recurring_transactions` | `check (amount_minor > 0)` | |
| — | `accounts` | *no positivity check on `opening_balance_minor`* | Deliberate exception: a credit card opens negative. Documented as a comment on the column so it does not read as an oversight |
| `budgets_unique_period` | `budgets` | `unique (user_id, category_id, period_start)` | Two budgets for Food in September is not a state the UI can render or the progress calculation can interpret. Enforced in the database because racing double-submits will otherwise create it |
| `categories_unique_name` | `categories` | `unique (user_id, lower(name), type)` | Two "Food" expense categories split a user's spending across identical-looking rows and make the breakdown chart nonsense. `lower(name)` because "food" and "Food" are the same category to a human. Same name across *different* types is allowed — an income "Other" and an expense "Other" are different things |
| `transactions_transfer_no_category` | `transactions` | `check (type <> 'transfer' or category_id is null)` | A transfer is not spending. Categorising one double-counts it in the breakdown and inflates budget usage. Enforced in the database because a Server Action bug, a CSV import, or a hand-run SQL statement would otherwise create it silently |
| `transactions_transfer_group_shape` | `transactions` | `check ((type = 'transfer') = (transfer_group_id is not null))` | A transfer without a group id is an orphan leg; a group id on a non-transfer is meaningless |
| `transactions_transfer_direction_shape` | `transactions` | `check ((type = 'transfer') = (transfer_direction is not null))` | Required for `account_balances` to sign a leg |
| `budgets_expense_categories_only` | `budgets` | Trigger-enforced: the referenced category must have `type = 'expense'` | Spec §11 budgets are spending limits. A budget on "Salary" is meaningless, and every progress calculation would need a guard. Implemented as a `before insert or update` trigger rather than a check constraint, because a check constraint cannot reference another table |
| `transactions_category_type_matches` | `transactions` | Trigger-enforced: an `income` transaction requires an `income` category (or none); `expense` requires `expense` | Prevents "Salary" appearing in the expense breakdown. Same cross-table limitation, same trigger mechanism |
| `budgets_period_start_is_month_start` | `budgets` | `check (period <> 'monthly' or date_trunc('month', period_start) = period_start)` | Makes `budgets_unique_period` meaningful. Without it, `2026-09-01` and `2026-09-15` are two distinct September budgets |
| `profiles_currency_iso` | `profiles` | `check (currency = upper(currency) and currency ~ '^[A-Z]{3}$')` | Applied to every `currency` column. Prevents `php` and `PHP` diverging |
| `recurring_no_transfers` | `recurring_transactions` | `check (type <> 'transfer')` | See the table note |
| `recurring_end_after_start` | `recurring_transactions` | `check (end_on is null or end_on >= start_on)` | |
| `goals_target_date_future_on_insert` | `goals` | *Not enforced in SQL* | A user backdating a goal target is entering valid historical data. Validated in Zod at creation time with a warning, not a database rejection — see [api-and-data-access.md](api-and-data-access.md) |

The two trigger-enforced rules are the interesting ones. Postgres check
constraints cannot see other tables, so cross-table invariants need either a
trigger or application-only enforcement. We choose triggers: application-only
enforcement means the invariant holds until the first bug, import, or manual
query, and these two invariants directly corrupt the numbers on the dashboard.

> [!NOTE]
> These triggers are **not** `security definer`. They run as the caller and
> reference only rows the caller can already see, so RLS applies normally. A
> `security definer` trigger here would be a needless privilege escalation — see
> [rls-policies.md](rls-policies.md#security-definer-functions).

## Indexes

Every index is justified by a specific query the product makes. Indexes that
exist "just in case" cost write throughput and buy nothing.

| Index | Definition | Serves |
|---|---|---|
| `transactions_user_occurred_idx` | `(user_id, occurred_on desc)` | The transaction list — spec §6's history view, sorted newest-first, and the keyset pagination in [system-architecture.md](system-architecture.md#performance-and-scale). `desc` matters: it matches the scan direction, so no sort node |
| `transactions_user_category_occurred_idx` | `(user_id, category_id, occurred_on)` | Spending-by-category (spec §8), budget progress (spec §11), category trends (spec §16). Ascending here because these are range scans over a period, not top-N |
| `transactions_user_account_occurred_idx` | `(user_id, account_id, occurred_on)` | `account_balances`, and per-account history (spec §5) |
| `transactions_transfer_group_idx` | `(transfer_group_id) where transfer_group_id is not null` | Fetching the sibling leg on edit or delete. Partial — most rows are not transfers, so a full index is mostly dead weight |
| `budgets_user_period_idx` | `(user_id, period_start)` | "This month's budgets" — every dashboard budget-health render (spec §8) |
| `recurring_next_on_idx` | `(user_id, next_on) where next_on is not null and not is_paused` | Money Timeline (spec §10) and the future materialisation job. Partial index: ended and paused rules are never scanned, so excluding them keeps it small |
| `goal_contributions_goal_occurred_idx` | `(goal_id, occurred_on)` | `goal_progress`, and the contribution-rate calculation behind spec §13's projected completion date |
| `categories_user_type_idx` | `(user_id, type) where not is_archived` | Category pickers, which always filter by transaction type |
| `accounts_user_idx` | `(user_id) where not is_archived` | Account pickers and the balance view |
| `audit_log_user_occurred_idx` | `(user_id, occurred_at desc)` | V2 audit review |

Not created, deliberately:

- **No index on `transactions(user_id)` alone.** The composite indexes above have
  `user_id` as their leading column and serve any query a single-column index
  would.
- **No full-text index on `description` yet.** Spec §6 wants search;
  `ILIKE '%term%'` over a personal ledger is fast enough at MVP scale. A GIN
  trigram index is the fix when a real dataset says so, added with the
  measurement that motivated it. Guessing now buys an index nobody validated.

## Triggers

| Trigger | On | Purpose |
|---|---|---|
| `set_updated_at` | `before update` on every table with `updated_at` | One shared `public.set_updated_at()` function. **Trigger, not application code**: `updated_at` set in the Server Action is wrong the first time anyone writes from a migration, a seed script, or the SQL editor — and it is exactly the column you need to trust while debugging |
| `on_auth_user_created` | `after insert` on `auth.users` | Creates the `profiles` row (currency `PHP`, timezone `Asia/Manila`) and seeds spec §7's default categories. See [rls-policies.md](rls-policies.md#profile-creation) — this is the one place a `security definer` function is justified, and it must `set search_path = ''` |
| `budgets_category_must_be_expense` | `before insert or update` on `budgets` | Enforces `budgets_expense_categories_only` |
| `transactions_category_type_guard` | `before insert or update` on `transactions` | Enforces `transactions_category_type_matches` |
| `goals_mark_achieved` | `after insert or delete` on `goal_contributions` | Sets `goals.achieved_at` the first time contributions reach the target. Only ever sets it; a later deletion does not clear it — the goal *was* reached |

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

Note the absence of `security definer` — this function needs no elevated
privilege, and adding it "for consistency" is how privilege sprawl starts.

## Migration ordering

One numbered migration per logical change, applied in filename order, never
edited after merge. Each row below names what a milestone's `type:contract` task
lands, so a backend task is unambiguous about which file it creates. Protocol:
[../../workflow/05-milestones-and-streams.md](../../workflow/05-milestones-and-streams.md).

| Migration | Milestone | Creates | Depends on |
|---|---|---|---|
| `0001_extensions_and_helpers.sql` | [M0](../../tasks/backlog/m0-foundation.md) | `pgcrypto` (for `gen_random_uuid`), `public.set_updated_at()`, the RLS naming convention comment block | — |
| `0002_enums.sql` | [M1](../../tasks/backlog/m1-auth-and-profile.md) | All six enums. One migration, because tables reference them and splitting them creates ordering puzzles for no gain | 0001 |
| `0003_profiles.sql` | M1 | `profiles`, its RLS policies, `set_updated_at` trigger | 0002 |
| `0004_profile_on_signup.sql` | M1 | `on_auth_user_created` trigger + its `security definer` function with `set search_path = ''`. Separate from 0003 so the table and the trigger can be reviewed independently — the trigger is the security-sensitive half | 0003 |
| `0005_accounts.sql` | [M2](../../tasks/backlog/m3-transactions-and-categories.md) | `accounts` (incl. `opening_balance_minor`, `exclude_from_safe_to_spend`, `is_archived`), RLS, indexes, trigger | 0003 |
| `0006_categories.sql` | M2 | `categories`, `categories_unique_name`, RLS, indexes, trigger | 0003 |
| `0007_seed_default_categories.sql` | M2 | Extends the sign-up function to seed spec §7's defaults. A separate migration because it *changes* 0004's function, and that change must be reviewable on its own | 0004, 0006 |
| `0008_transactions.sql` | M2 | `transactions` with every column including `transfer_group_id`, `transfer_direction`, and `recurring_transaction_id` **as a plain uuid with no FK yet** — the FK arrives in 0010 once the target table exists. All checks, all indexes, RLS with [cross-table ownership](rls-policies.md#cross-table-ownership) | 0005, 0006 |
| `0009_transactions_category_type_guard.sql` | M2 | The category-type trigger. Separate so the trigger is a reviewable unit and can be dropped independently if it proves too strict | 0008 |
| `0010_recurring_transactions.sql` | M2 | `recurring_transactions` (empty; V2 uses it), RLS, `recurring_next_on_idx`, **and the deferred FK `transactions.recurring_transaction_id → recurring_transactions(id)`**. Shipped in M2 rather than V2 so no later migration alters a populated `transactions` table | 0008 |
| `0011_account_balances_view.sql` | M2 | `account_balances` view with `security_invoker = true` | 0008, 0010 |
| `0012_budgets.sql` | [M5](../../tasks/backlog/m5-budgets.md) | `budgets`, `budgets_unique_period`, `budgets_period_start_is_month_start`, RLS, `budgets_user_period_idx` | 0006 |
| `0013_budgets_expense_only_guard.sql` | M5 | The expense-category-only trigger | 0012 |
| `0014_goals.sql` | [M6](../../tasks/backlog/m6-goals.md) | `goals` **without** `current_amount`, RLS, indexes, trigger | 0005 |
| `0015_goal_contributions.sql` | M6 | `goal_contributions`, RLS (incl. cross-table `goal_id` check), `goal_contributions_goal_occurred_idx` | 0014, 0008 |
| `0016_goal_progress_view.sql` | M6 | `goal_progress` view, `goals_mark_achieved` trigger | 0015 |
| `0017_audit_log.sql` | [M8](../../tasks/backlog/m9-mvp-hardening-and-launch.md) | `audit_log`, insert-only RLS, index. Empty in MVP | 0003 |
| `0018_performance_indexes.sql` | M8 | Any index the 5,000-transaction seed benchmark in [M4](../../tasks/backlog/m4-dashboard-core.md) proves necessary. Deliberately last, and deliberately evidence-driven | all |

Three ordering rules that are non-obvious and cost real time when broken:

1. **Enums before tables.** A table referencing a missing type fails. Adding a
   value to an existing enum in the same transaction that uses it also fails —
   `alter type ... add value` cannot be used in the same transaction in older
   Postgres, so enum changes always get their own migration.
2. **The `recurring_transaction_id` foreign key is deferred to 0010.** The
   column ships in 0008 so `transactions` is never altered after it holds data;
   the constraint waits for its target. This is the standard fix for a circular
   dependency between two tables that reference each other.
3. **Every table's RLS policies land in the same migration as the table.** Never
   a follow-up. A table that exists for even one deploy without policies is
   either wide open or entirely inaccessible, and both have shipped in real
   projects. The CI check in [rls-policies.md](rls-policies.md#ci-enforcement)
   fails the build if a table appears without RLS enabled.

Milestones M3 (dashboard shell), M4 (dashboard core), and M7 (Safe to Spend and
timeline) create **no migrations**. Every table they need exists by M2, and the
work is queries, `lib/core` math, and UI. If one of them turns out to need a
column, that is a signal this document got something wrong — record it as a
schema-change task with the reason, rather than a quiet `alter table`.

## What is deliberately absent

- **No `balance` column on `accounts`, no `current_amount` on `goals`.** Derived.
  See decisions 4 and 6. This is the single largest departure from spec §22, and
  it changes no product behaviour — both values are still shown, just computed.
- **No soft-delete `deleted_at` columns.** `is_archived` on `accounts` and
  `categories` covers the real requirement — keeping history while hiding the
  row from pickers. A general soft-delete pattern means every query needs a
  `where deleted_at is null` that someone will forget, and the one they forget
  will be the one that leaks deleted data.
- **No `tags` table or many-to-many transaction labelling.** One category per
  transaction, per spec §7. Tags are not in any roadmap tier.
- **No `attachments` / receipt storage.** Spec §23 says "Supabase Storage if
  needed". It is not needed for the MVP, and an unused storage bucket is an
  unmonitored attack surface with its own RLS to get wrong.
- **No `exchange_rates` table, no `amount_in_base_currency` column.** One
  currency per user in the MVP; mixed currency is an explicit error
  ([system-architecture.md](system-architecture.md#non-goals)). The
  denormalized `currency` columns make the eventual addition additive.
- **No materialized views.** The plain views are fast enough at MVP scale, and a
  materialized view introduces a refresh-staleness question that needs an answer
  before it introduces a benefit.
- **No database-computed Safe to Spend.** It lives in `lib/core`, because it is
  the product's most-tested math and it must run against perturbed inputs for
  V2 What-If. See
  [source-structure.md](source-structure.md#why-libcore-is-quarantined).
- **No `numeric` money columns anywhere.** See decision 1.
