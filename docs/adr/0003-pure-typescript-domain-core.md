# 0003 — Domain logic is pure, dependency-free TypeScript

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-09 |
| **Deciders** | @jorge |
| **Affects** | [source-structure.md](../architecture/source-structure.md), all of [../domain/](../domain/), M4–M8 |

## Context

The product's differentiators are calculations, not screens. Spec §29 lists
them: Safe to Spend, Money Timeline, forecasting, What-If, Goal Impact. Spec §9
and §10 mark two of them ⭐.

What that computation has to survive:

- **Enormous input variety.** Month boundaries, leap years, DST transitions,
  empty states, negative balances, bills paid early, month-end anchor
  preservation. [recurrence.md](../domain/recurrence.md) alone lists a dozen
  cases where a naive implementation is wrong.
- **Correctness that a user will notice.** A wrong Safe to Spend figure is not a
  rendering bug; it is financial advice based on a false number.
- **Reuse under perturbation.** What-If (spec §18) re-runs the same calculations
  with altered inputs. Goal Impact (spec §14) diffs two runs.
- **Tests that never flake.** A test whose result depends on today's date fails
  on the 31st, gets marked flaky, and stops being trusted.

## Decision

**All financial computation lives in `lib/core/`, which imports nothing outside
`lib/core` and the TypeScript standard library.**

Specifically banned, each for a reason:

| Banned | Why |
|---|---|
| React, Next | This code must not know it is in a web app |
| `supabase-js`, any I/O | A pure function takes data and returns data |
| Zod | Validation belongs at the boundary (`lib/validation`); core receives valid input |
| Any date library | Recurrence math is on *calendar dates in the user's timezone*, never UTC instants — a library invites reaching for an instant-based API |
| `process.env` | Output must depend only on arguments |
| `Date.now()`, `new Date()` | **`today` is always injected** |
| `Intl` / formatting | Formatting is `lib/utils`; `Intl` output varies by ICU version, making tests environment-dependent |

Enforced by ESLint `no-restricted-imports` (`M0-B02`) with a deliberate-violation
fixture that must fail lint.

Every core function is called from a Server Component or Server Action, which
fetches RLS-scoped data, maps rows to domain types, and passes plain values in.

## Consequences

### What this makes easier

- **Exhaustive testing is cheap.** A test is a function call. No database, no
  fixtures beyond plain objects, no setup. This is what makes ~400 unit tests and
  a 90–95% coverage floor realistic rather than aspirational.
- **Property-based testing becomes practical.** "Adding an expense never
  increases Safe to Spend" is expressible over thousands of generated inputs
  only because the function is pure.
- **Time is an input.** Leap years, month ends, and DST are ordinary test
  parameters — no clock mocking, no flake.
- **What-If costs almost nothing.** Spec §18 is a re-run with overridden inputs.
  [goal-projection.md](../domain/goal-projection.md#why-what-if-needs-no-new-math)
  makes this explicit — the expensive-sounding V2 feature needs no new math.
- **Canonical fixtures work.** Spec §9's ₱23,500 is a passing test because the
  function has no environment to disagree with.
- **Extraction stays possible.** [ADR-0001](0001-single-nextjs-app-not-monorepo.md)
  chose a single app; this keeps `lib/core` a package-in-waiting.

### What this makes harder

- **Callers do more work.** Assembling `SafeToSpendInput` means gathering
  balances, scheduled items, and goal contributions into one shape (`M7-B04`)
  rather than letting the function fetch what it needs.
- **Some calendar arithmetic is hand-written.** Month-end clamping with anchor
  preservation, DST-safe day addition — code a date library would provide.
  Written once in `lib/core/recurrence`, tested exhaustively, and small.
- **More types.** Domain types distinct from database row types, with mappers
  between them.

### What this forecloses

- **Lazy loading inside the domain layer.** A function cannot decide it needs
  another query. If it needs data, the caller provides it — which occasionally
  means over-fetching.
- **Computing money on the client.** Deliberate: see
  [frontend-architecture.md](../architecture/frontend-architecture.md#the-serverclient-boundary).

## Alternatives considered

### Postgres views and RPC functions

**What it was.** Compute Safe to Spend and aggregates in SQL — views, or
`plpgsql` functions called via RPC. Fast, always consistent with the data, no
round trip.

**Why rejected.** Two decisive problems. **Testing**: exercising a month-end
edge case means seeding a database and running SQL, so the test suite is orders
of magnitude slower and the exhaustive coverage this code needs stops being
affordable. **What-If**: spec §18 requires re-running the calculation with
*hypothetical* inputs — in SQL that means either temporary tables or a parallel
implementation, and a parallel implementation of money math will drift from the
real one.

Partially adopted: heavy *aggregation* (category rollups, cash-flow buckets)
does belong in SQL for performance (`M4-B03`), while *decision* logic stays in
TypeScript. That split is deliberate, and the boundary is that SQL sums rows
while TypeScript makes judgements.

### Domain logic inside Server Actions

**What it was.** Compute inline where the data is fetched. Fewer files, no
mapper layer.

**Why rejected.** Untestable without mocking Supabase, and mocked-database tests
assert the mock's behaviour rather than the math. Also unreusable — What-If
cannot call a Server Action with hypothetical data, and Goal Impact cannot diff
two runs.

### Pure core, but allow a date library

**What it was.** Same purity rules, with `date-fns` or Temporal permitted.

**Why rejected.** The single most common bug class in a budgeting app is
treating a calendar date as an instant
([recurrence.md](../domain/recurrence.md#the-timezone-rule)). A date library's
API surface is mostly instant-based, so it invites exactly that mistake — a
`addMonths(new Date(...))` looks correct and produces an off-by-one-day bill for
users in some timezones. Banning the category forces the calendar-date type to be
explicit. Revisit when Temporal's `PlainDate` is broadly available: it is the
right primitive, and it would remove most of the hand-written arithmetic.

## Revisit when

- **Temporal `PlainDate`** ships widely — a calendar-date type without instant
  semantics is exactly what this code wants.
- A profiler shows a core computation is genuinely too slow in a serverless
  runtime and must move to SQL. (Caching is the first answer; see
  [state-and-caching.md](../architecture/state-and-caching.md).)

## References

- Spec §9, §10, §12, §14, §18, §29 — the calculations at stake
- [../domain/](../domain/) — the specifications this structure implements
- [../ops/testing-strategy.md](../ops/testing-strategy.md) — the pyramid purity enables
- [ADR-0005](0005-money-as-integer-minor-units.md) — the arithmetic rules inside
