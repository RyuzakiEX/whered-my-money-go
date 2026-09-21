# Testing Strategy

**Shape in one sentence:** thousands of fast unit tests on the money math,
enough integration tests to prove authorization actually works, and a thin
browser suite covering only the nine questions the product exists to answer.

Related: [../adr/0004-testing-stack-vitest-playwright.md](../adr/0004-testing-stack-vitest-playwright.md),
[../domain/](../domain/) (each doc names its canonical fixtures),
[../../workflow/07-definition-of-ready-and-done.md](../../workflow/07-definition-of-ready-and-done.md),
[../../workflow/08-ci-gates.md](../../workflow/08-ci-gates.md).

## The shape of the pyramid

```text
        ╱ E2E ╲          ~15 tests    Playwright, Chromium
       ╱───────╲                      The 9 spec §31 questions
      ╱ Integr. ╲        ~60 tests    Vitest + local Supabase
     ╱───────────╲                    Actions, queries, RLS
    ╱    Unit     ╲      ~400 tests   Vitest, pure
   ╱───────────────╲                  lib/core money math
  ╱     pgTAP       ╲     ~40 tests   In-database
 ╱───────────────────╲                Row Level Security isolation
```

Deliberately bottom-heavy. The money math has enormous input variety and no
dependencies, so it is cheap to test exhaustively — and it is where a bug costs
the user money. The browser suite is expensive and flaky by nature, so it stays
thin and covers only end-to-end truths nothing else can.

## The four layers

| Layer | Tool | Runs against | Speed | Answers |
|---|---|---|---|---|
| **Unit** | Vitest | Nothing — pure functions | ms | Is the math right? |
| **pgTAP** | `supabase test db` | Local Postgres | seconds | Can a user reach another's rows? |
| **Integration** | Vitest | Local Supabase | seconds | Do actions validate, authorize, and persist? |
| **E2E** | Playwright | Running app + DB | minutes | Can a user actually do this? |

### Unit — `tests/unit/`

Everything in `lib/core`, plus `lib/utils`. No database, no network, no clock.

`lib/core` is pure by construction
([source-structure.md](../architecture/source-structure.md#why-libcore-is-quarantined)),
so a unit test is a function call with an expected value. `today` is injected,
which means month-boundary and leap-year cases are ordinary test inputs rather
than something requiring a fake clock.

**Every domain doc names its canonical fixture**, drawn from the product spec's
own worked example:

| Fixture | Asserts | Source |
|---|---|---|
| `STS_FIXTURE_SPEC_S9` | ₱23,500 | [safe-to-spend.md](../domain/safe-to-spend.md#canonical-unit-test-fixture) |
| `TIMELINE_FIXTURE_SPEC_S10` | Order + projected balances | [money-timeline.md](../domain/money-timeline.md#canonical-unit-test-fixture) |
| `BUDGET_FIXTURE_SPEC_S11` | Four-row progress | [budget-forecasting.md](../domain/budget-forecasting.md#canonical-unit-test-fixtures) |
| `BUDGET_FIXTURE_SPEC_S12` | Projection arithmetic | same |
| `RECURRENCE_FIXTURE_MONTHEND_ANCHOR_31` | Jan 31 → Feb 28 → **Mar 31** | [recurrence.md](../domain/recurrence.md) |

**Why this matters:** the same numbers appear in the product spec, the domain
doc, the unit test, and the E2E test. All four agree on what "correct" means, so
a disagreement is a test failure rather than a discussion.

**Property tests** (fast-check) encode the invariants each domain doc lists —
"adding an expense never increases Safe to Spend", "the breakdown sums to the
total", "shuffling timeline input yields identical output". These catch the
class of bug example-based tests miss, and they are cheap because the functions
are pure.

### pgTAP — `supabase/tests/rls/`

Row Level Security tested **inside the database**, where it actually runs.

`M1-B03` builds a harness with two seeded users and a reusable
"table is user-isolated" assertion that every later milestone reuses. For each
table it asserts:

- User B selecting user A's rows returns **zero rows** (not an error — zero rows,
  which is what RLS does).
- User B inserting a row with A's `user_id` **fails**.
- User B updating or deleting A's rows **affects nothing**.
- **The cross-table case**: user B inserting a transaction referencing A's
  `account_id` **fails**. This is the subtle vulnerability described in
  [rls-policies.md](../architecture/rls-policies.md#cross-table-ownership), and
  it needs its own explicit test because a naive policy passes every other check.

Tested here rather than through the app because RLS is the last line of defence
([security-model.md](../security/security-model.md#the-three-layer-rule)) — a
test that goes through application code proves the app is careful, not that the
database is safe.

### Integration — `tests/integration/`

Server Actions and queries against a real local Supabase.

Covers what unit tests cannot: does the Zod schema reject what it should, does
the ownership re-check actually run, does the write persist the right columns,
do the cache tags get invalidated, does a cross-user attempt return not-found.

Each test runs in a transaction rolled back afterwards, so tests are order-
independent. Two users are always seeded, because "does this work" and "does
this work *only* for the owner" are the same test.

Mandatory for: every new Server Action, every new query, every mutation's cache
invalidation set.

### E2E — `tests/e2e/`

Playwright, Chromium only. A cross-browser matrix triples runtime for a suite
whose job is catching broken flows, not rendering differences.

**The suite is scoped to spec §31's nine questions.** Each gets one assertion,
and each is owned by the milestone that makes it answerable:

| Question | Milestone |
|---|---|
| How much money do I have? | M2 |
| How much did I earn this month? | M3 → M4 |
| How much did I spend? | M3 → M4 |
| Where did my money go? | M4 |
| **How much can I safely spend?** | **M7** |
| What bills are coming up? | M8 |
| Am I staying within my budget? | M5 |
| How much have I saved? | M6 |
| Am I on track for my savings goal? | M6 |

`M9-B05` completes the suite and holds it to a hard bar: **under 10 minutes,
flake-free over three consecutive runs.** A flaky E2E suite gets ignored, and an
ignored suite is worse than none — it provides false confidence while consuming
CI minutes.

## Coverage thresholds

Enforced in `vitest.config.ts`, not in CI — so `npm run test` fails identically
on a developer's machine and in the pipeline.

| Scope | Floor | Why |
|---|---|---|
| `lib/core/safe-to-spend/**` | **95%** | The product is named after this number |
| `lib/core/timeline/**` | **95%** | The second named differentiator |
| `lib/core/**` (rest) | **90%** | All money math |
| Global | 60% | UI coverage has diminishing returns |

Coverage is a floor, not a goal. 95% on Safe to Spend with no property tests is
worse than 90% with them — the threshold catches untested files, while the
invariants catch untested *behaviour*.

## Fixtures and factories

`tests/fixtures/` holds builders with sensible defaults and overrides:

```typescript
const txn = aTransaction({ amountMinor: 150_000, type: 'expense' });
const user = aUserWithAccounts(['cash', 'bank']);
```

Rules:

- **Factories, not shared mutable fixtures.** A shared object one test mutates
  breaks another, and the failure is order-dependent and maddening.
- **Amounts always in minor units**, always integers. A factory that accepts
  `150.00` teaches the wrong habit.
- **The spec fixtures are frozen.** `STS_FIXTURE_SPEC_S9` reproduces spec §9
  exactly and is never adjusted to make a test pass — if it fails, the code is
  wrong.
- **`M4-B04`'s seed script is shared** across integration, E2E, and manual QA:
  six months of plausible transactions for a demo user, ~5,000 rows, which is
  also the performance baseline for `M9-B03`.

## What is not tested

Stated so the gaps are deliberate:

- **Visual regression.** No screenshot diffing. High maintenance, low signal at
  this scale; accessibility and responsive checks are manual passes in
  `M9-F01`/`M9-F02`.
- **Supabase's own behaviour.** We test our policies, not that Postgres enforces
  RLS correctly.
- **Cross-browser rendering.** Chromium only.
- **Load and stress testing.** Performance budgets are measured against the 5k
  seed (`M9-B03`), not under synthetic load.
