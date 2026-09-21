# Budget Progress and Forecasting

**Shape in one sentence:** given what a user has spent so far this month against
a category budget, say where they will finish — using a blend of their current
rate and their historical shape, because rate alone is nonsense on the 2nd of
the month and history alone ignores what is happening right now.

> [!NOTE]
> **Forecasting is a V2 feature** (spec §12). Budget *progress* — spent,
> remaining, percent used, status — is MVP (spec §11,
> [M5](../../tasks/backlog/m5-budgets.md)). Both live here because they share
> the same period arithmetic and the same status bands, and specifying the
> forecast now stops M5 from shipping a progress model the forecast cannot
> extend.

Related: [money-and-rounding.md](money-and-rounding.md),
[safe-to-spend.md](safe-to-spend.md),
[../architecture/data-model.md](../architecture/data-model.md),
[../../tasks/backlog/m5-budgets.md](../../tasks/backlog/m5-budgets.md).

## Contents

- [Period arithmetic](#period-arithmetic)
- [Progress (MVP)](#progress-mvp)
- [The three estimators](#the-three-estimators)
- [Why blend](#why-blend)
- [Status bands](#status-bands)
- [Confidence](#confidence)
- [Copy hooks](#copy-hooks)
- [Function contract](#function-contract)
- [Edge cases](#edge-cases)
- [Invariants for property tests](#invariants-for-property-tests)
- [Canonical unit-test fixtures](#canonical-unit-test-fixtures)

## Period arithmetic

```text
periodStart   = first day of the budget period      (calendar month, MVP)
periodEnd     = last day of the budget period
daysInPeriod  = inclusive day count                 (28 | 29 | 30 | 31)
daysElapsed   = inclusive days from periodStart to today
daysRemaining = daysInPeriod - daysElapsed
```

Two definitions stated because both are easy to get wrong:

- **`daysElapsed` is inclusive and counts today.** On September 1st it is `1`,
  not `0`. A zero would divide by zero in the run-rate estimator, and treating
  the first day as "no time has passed" understates a day of real spending.
- **`daysInPeriod` is the real length of the real month.** Not 30. February
  budgets are ~7% shorter than January ones, and a hardcoded 30 makes every
  February projection over-forecast by that much.

All arithmetic on calendar dates in the user's timezone, never UTC instants —
[recurrence.md](recurrence.md#the-timezone-rule) explains why that distinction
is load-bearing.

**Only actuals count.** `spentToDate` sums transactions with
`occurred_on <= today`. Future-dated (scheduled) transactions are Safe to Spend
and Timeline inputs, not spending that has happened. See
[safe-to-spend.md](safe-to-spend.md#the-mvp-degradation-path) — this constraint
has a wide blast radius and is repeated wherever it applies.

## Progress (MVP)

Spec §11's four-row example is the MVP requirement:

```text
Food              ₱7,200 / ₱10,000
Transportation    ₱4,800 / ₱4,000
Entertainment     ₱2,100 / ₱3,000
Shopping          ₱5,400 / ₱5,000
```

```text
spentMinor      = Σ expense amounts in this category, this period, occurred_on <= today
remainingMinor  = budgetMinor - spentMinor              (may be negative)
percentUsed     = spentMinor / budgetMinor × 100        (may exceed 100)
```

`percentUsed` is a display value: computed in `lib/core`, rounded for
presentation only, never fed back into further arithmetic. `remainingMinor` is
exact and may be negative — that negative *is* the overspend, and clamping it to
zero would hide the thing the user most needs to see.

Note rows 2 and 4 of the spec's example are already over budget. The MVP must
render over-budget states correctly from day one; it is not an edge case, it is
the normal condition of a real budget.

## The three estimators

All three answer: **how much will this category total by `periodEnd`?**

```text
Given:
  spentToDate   = actual spending so far this period
  daysElapsed   >= 1
  daysInPeriod  = real length of this month
  history       = same category's totals for prior periods (may be empty)

A) LINEAR RUN-RATE
   dailyRate = spentToDate / daysElapsed
   projected = dailyRate × daysInPeriod

B) HISTORICAL SHAPE
   For each remaining day d, take that day-of-month's average share of the
   monthly total across available history:
     share(d) = mean over prior periods of (spend on day d / period total)
   projected  = spentToDate + historicalMonthlyMean × Σ share(d) for remaining d

C) BLENDED  ← DEFAULT
   w         = min(1, daysElapsed / 10)
   projected = w × A + (1 − w) × B
```

**Estimator B in plain terms:** it asks "in past months, how much of this
category's spending happened *after* this point in the month?", then adds that
proportion to what has been spent so far. It captures rhythm that a flat rate
cannot — groceries cluster at weekends, rent-like charges land on fixed days,
subscriptions renew mid-month.

## Why blend

The blend is the opinionated core of this document.

**Run-rate alone is unusable early in the period.** One ₱3,000 grocery run on
day 2 of a 30-day month:

```text
dailyRate = ₱3,000 / 2   = ₱1,500/day
projected = ₱1,500 × 30  = ₱45,000
```

Against a ₱10,000 food budget that projects a 350% overrun from a single normal
shop. Show that to a user and they learn to ignore the forecast — and an
ignored forecast is worse than none, because it also erodes trust in the
numbers that *are* reliable.

**Historical shape alone cannot start.** It needs at least two prior periods.
A new user has none, and a user with one month has a sample size of one.

**So `w = min(1, daysElapsed / 10)` ramps trust toward the current period as
evidence accumulates:**

| `daysElapsed` | `w` | Reading |
|---|---|---|
| 1 | 0.1 | Almost entirely historical — one day proves nothing |
| 3 | 0.3 | Mostly historical |
| 5 | 0.5 | Even split |
| 10 | 1.0 | Ten days is a real sample; trust the current period |
| 20 | 1.0 | Pure run-rate |

The `/10` denominator is a judgement call: ten days is roughly when a monthly
spending pattern becomes visible above day-to-day noise. It is **one named
constant**, documented as tunable, with a unit test at each boundary. It is not
derived from anything, and the doc says so rather than dressing it up.

**Fallback.** With fewer than two prior periods, estimator B is unavailable and
the blend degenerates to pure A — with `confidence: 'low'` set, so the UI can
present it as the rough guess it is.

## Status bands

```text
on_track    projected <  0.9 × budget
at_risk     projected >= 0.9 × budget   AND  projected <= budget
over        projected >  budget         AND  spent <= budget
exceeded    spent     >  budget
```

| Band | Meaning | Based on |
|---|---|---|
| `on_track` | Comfortably inside | Forecast |
| `at_risk` | Heading for the limit | Forecast |
| `over` | Forecast to exceed, but hasn't yet | Forecast |
| `exceeded` | **Already** over | Fact |

**`exceeded` outranks everything**, because it is the only band based on what
has actually happened rather than a projection. Once real spending passes the
budget, no forecast can make that untrue, and the UI must not soften it.

The MVP (progress only, no forecast) uses just `on_track` / `exceeded`, with
`at_risk` triggered by `percentUsed >= 90` instead of by a projection. Same
band vocabulary, so V2 slots the forecast in without changing the UI contract
or the copy.

## Confidence

A projection carries `confidence`, and the UI must respect it:

| Confidence | When | UI treatment |
|---|---|---|
| `low` | `daysElapsed < 5`, **or** fewer than 2 prior periods | Show as a range or hedge the wording; never a bare precise figure |
| `medium` | `daysElapsed` 5–9 with history | Show, worded as an estimate |
| `high` | `daysElapsed >= 10` with ≥2 prior periods | Show plainly |

> [!IMPORTANT]
> **A precise-looking number implies precision it does not have.** "You may
> exceed your budget by ₱1,400" on day 3 reads as a calculation; it is closer to
> a guess. Rendering a low-confidence projection as a hard figure is how a
> forecasting feature loses credibility permanently. This is a UI requirement,
> not a suggestion — task `M5-F03` and the V2 forecasting tasks both carry it.

## Copy hooks

Spec §32's voice — playful, non-judgmental — applied per band. The result
exposes the band and the amounts; the copy lives in the UI layer, never in
`lib/core`.

| Band | Direction | Example (spec §32's voice) |
|---|---|---|
| `on_track` | Light, no praise-inflation | "Food's looking healthy." |
| `at_risk` | Warn without alarm | *"Hala. You're getting close to your shopping budget."* |
| `over` | Forecast framing, keeps agency | "At this rate you'll pass your food budget by about ₱1,400." |
| `exceeded` | Factual, **never** scolding | *"You spent ₱2,400 on food. We won't judge."* |

`exceeded` is the state where tone matters most. The user already knows they
overspent; the app's job is to be useful about it, not to add guilt. Spec §33's
principle applies: clarity over commentary.

## Function contract

```typescript
// lib/core/budgets/types.ts

type CalendarDate = string;  // 'YYYY-MM-DD'
type Minor = number;         // integer minor units

type BudgetStatus = 'on_track' | 'at_risk' | 'over' | 'exceeded';
type Confidence = 'low' | 'medium' | 'high';
type Estimator = 'run_rate' | 'historical' | 'blended';

interface BudgetPeriodHistory {
  readonly periodStart: CalendarDate;
  readonly totalMinor: Minor;
  /** Day-of-month → spend. Absent days are zero. Enables estimator B. */
  readonly dailyMinor?: Readonly<Record<number, Minor>>;
}

interface BudgetProgressInput {
  readonly today: CalendarDate;               // injected, never the clock
  readonly periodStart: CalendarDate;
  readonly periodEnd: CalendarDate;
  readonly budgetMinor: Minor;                // > 0
  readonly spentToDateMinor: Minor;           // actuals only, >= 0
  /** Prior periods, newest first. Empty is valid. */
  readonly history?: readonly BudgetPeriodHistory[];
  /** Day-of-month → spend, this period. Required for estimator B. */
  readonly dailySpendThisPeriod?: Readonly<Record<number, Minor>>;
}

interface BudgetProgress {
  readonly budgetMinor: Minor;
  readonly spentMinor: Minor;
  readonly remainingMinor: Minor;             // may be negative
  readonly percentUsed: number;               // may exceed 100
  readonly status: BudgetStatus;
  readonly daysElapsed: number;
  readonly daysRemaining: number;
  readonly daysInPeriod: number;
}

interface BudgetForecast extends BudgetProgress {
  readonly projectedMinor: Minor;
  readonly projectedOverrunMinor: Minor;      // max(0, projected − budget)
  readonly confidence: Confidence;
  readonly estimatorUsed: Estimator;
  readonly blendWeight: number;               // w, for explainability
}

/** MVP. Progress only — no projection. Pure. */
export function computeBudgetProgress(input: BudgetProgressInput): BudgetProgress;

/** V2. Progress plus projection. Pure. */
export function forecastBudget(input: BudgetProgressInput): BudgetForecast;
```

Two notes on the shape:

- **`BudgetForecast extends BudgetProgress`** so M5's UI binds to the progress
  fields and V2 adds the projection without a breaking change to the components
  already shipped.
- **`blendWeight` is returned** because a forecast the user cannot interrogate
  is a forecast they will not trust — the same principle that makes
  [Safe to Spend](safe-to-spend.md#why-the-result-is-a-breakdown-not-a-number)
  return a breakdown. It also makes the estimator debuggable from a failing
  test's output.

Rounding: division appears in `dailyRate`, `share(d)`, and the blend. Each
rounds half-up to the nearest minor unit at the point of division, per
[money-and-rounding.md](money-and-rounding.md#division-and-rounding). Projected
totals are therefore exact integers, and `percentUsed` is the only non-integer
value returned — display-only by contract.

## Edge cases

| Case | Behaviour | Reasoning |
|---|---|---|
| `budgetMinor = 0` | **Throws** `InvalidBudgetError` | A zero budget makes `percentUsed` undefined; the schema forbids it |
| `budgetMinor < 0` | **Throws** | Meaningless |
| `spentToDateMinor = 0` | `projected = 0`, `on_track`, `confidence: 'low'` | Nothing spent yet ≠ nothing will be |
| `daysElapsed = 1` | `w = 0.1`; heavy historical weighting | The day-2-grocery-run problem |
| No history at all | Estimator A only, `confidence: 'low'`, `estimatorUsed: 'run_rate'` | Cannot fabricate a shape |
| One prior period | Still A only | A sample of one is not a shape |
| `today = periodEnd` | `projected === spentToDate`, `confidence: 'high'` | The period is over; the forecast is the fact |
| `today` after `periodEnd` | Clamp to `periodEnd`; treat as closed | Viewing a past period |
| `today` before `periodStart` | **Throws** `InvalidPeriodError` | Caller bug |
| Already over budget | `status: 'exceeded'`, `remaining` negative, forecast still computed | The forecast still answers "how much worse?" |
| Spending stops mid-period | Run-rate keeps projecting the old pace | Known limitation of A; the blend softens it, history softens it further |
| February | `daysInPeriod = 28` or `29` | Never hardcode 30 |
| Category with no transactions | `spent = 0`, `on_track` | Valid |
| Budget created mid-period | `periodStart` is still the month start | Budgets are per calendar period (schema: unique on `period_start`) |
| Transfers in the category | **Excluded** | Not spending |
| Future-dated transaction | **Excluded** from `spentToDate` | Not yet actual |
| Refund making spend negative | Clamp `spentToDate` at `0` for the projection | A negative rate would project negative spending |

## Invariants for property tests

1. **Progress identity.** `remainingMinor === budgetMinor − spentMinor`, always,
   including when negative.
2. **Percent consistency.** `percentUsed === spentMinor / budgetMinor × 100`
   within display tolerance.
3. **`exceeded` dominance.** `spentMinor > budgetMinor` ⟹
   `status === 'exceeded'`, regardless of the projection.
4. **Projection floor.** `projectedMinor >= spentToDateMinor` — money already
   spent cannot be un-spent by a forecast. **The most important invariant here.**
5. **Monotonic in spending.** Increasing `spentToDateMinor` never decreases
   `projectedMinor`.
6. **Blend bounds.** `projectedMinor` lies between the A and B estimates
   (inclusive) whenever both are available.
7. **Weight bounds.** `0 < blendWeight <= 1`, and `blendWeight === 1` exactly
   when `daysElapsed >= 10`.
8. **End-of-period convergence.** When `today === periodEnd`,
   `projectedMinor === spentToDateMinor` for every estimator.
9. **Overrun definition.** `projectedOverrunMinor === max(0, projectedMinor − budgetMinor)`.
10. **Determinism and integrality.** Same input → same output; every `Minor`
    value is a safe integer.

## Canonical unit-test fixtures

### `BUDGET_FIXTURE_SPEC_S11` — the MVP progress requirement

Spec §11's four rows, at `today = 2026-09-20` (`daysElapsed = 20`,
`daysInPeriod = 30`):

| Category | Budget | Spent | Remaining | % used | Status |
|---|---|---|---|---|---|
| Food | `1_000_000` | `720_000` | `280_000` | 72.0 | `on_track` |
| Transportation | `400_000` | `480_000` | `−80_000` | 120.0 | `exceeded` |
| Entertainment | `300_000` | `210_000` | `90_000` | 70.0 | `on_track` |
| Shopping | `500_000` | `540_000` | `−40_000` | 108.0 | `exceeded` |

Renders as spec §11 shows it. Two of four are over budget — the fixture proves
over-budget rendering works from M5, not as a later fix.

### `BUDGET_FIXTURE_SPEC_S12` — the V2 forecast requirement

Spec §12: spent ₱7,200, budget ₱10,000, **projected ₱11,400**, overrun ₱1,400.

Working backwards to inputs that produce exactly `₱11,400`:

```text
today        = 2026-09-19    →  daysElapsed  = 19
periodEnd    = 2026-09-30    →  daysInPeriod = 30
spentToDate  = 720_000       (₱7,200)
budget       = 1_000_000     (₱10,000)

daysElapsed >= 10  →  w = 1.0  →  pure run-rate (estimator A)

dailyRate = 720_000 / 19        = 37_894.7...  → 37_895 (half-up)
projected = 37_895 × 30         = 1_136_850    ≈ ₱11,368.50
```

Run-rate lands at ₱11,368.50 — close to but not exactly the spec's ₱11,400. The
spec's figure is a plausible illustration, not a derivation, so the fixture
pins the **arithmetic**, and asserts the spec's number to the nearest hundred
pesos:

```typescript
// tests/unit/budgets/spec-s12.test.ts
it('reproduces spec §12 within rounding', () => {
  const r = forecastBudget(BUDGET_FIXTURE_SPEC_S12);

  expect(r.estimatorUsed).toBe('run_rate');
  expect(r.blendWeight).toBe(1);
  expect(r.projectedMinor).toBe(1_136_850);            // ₱11,368.50
  expect(Math.round(r.projectedMinor / 10_000)).toBe(114);  // ≈ ₱11,400
  expect(r.status).toBe('over');
  expect(r.confidence).toBe('high');
  expect(r.projectedOverrunMinor).toBe(136_850);       // ≈ ₱1,400 overrun
});
```

> [!NOTE]
> Spec §12's ₱11,400 is illustrative. Rather than reverse-engineering inputs to
> hit a round number, the fixture asserts the documented arithmetic and shows it
> agrees with the spec's example to within rounding. If the exact figure ever
> becomes a requirement, the estimator constants — not the test — are what
> should change.

### Required companion fixtures

| Fixture | Asserts |
|---|---|
| `BUDGET_FIXTURE_DAY_2_GROCERY` | ₱3,000 on day 2: the blend keeps the projection sane; pure run-rate would say ₱45,000 |
| `BUDGET_FIXTURE_NO_HISTORY` | New user: estimator A, `confidence: 'low'` |
| `BUDGET_FIXTURE_ONE_PRIOR_PERIOD` | Still A only — one month is not a shape |
| `BUDGET_FIXTURE_WITH_HISTORY` | Three prior periods on day 5: `blended`, `w = 0.5` |
| `BUDGET_FIXTURE_W_BOUNDARY_9` / `_10` | `w < 1` at day 9, exactly `1` at day 10 |
| `BUDGET_FIXTURE_PERIOD_END` | `today = periodEnd`: projected === spent, `high` |
| `BUDGET_FIXTURE_FEBRUARY` | 28-day period: not 30 |
| `BUDGET_FIXTURE_LEAP_FEBRUARY` | 29-day period |
| `BUDGET_FIXTURE_ZERO_SPEND` | Nothing spent: projected 0, `on_track`, `low` |
| `BUDGET_FIXTURE_AT_RISK_BOUNDARY` | Projected exactly `0.9 × budget` → `at_risk` |
| `BUDGET_FIXTURE_EXCEEDED_DOMINANCE` | Spent > budget while projection says `at_risk` → `exceeded` wins |
| `BUDGET_FIXTURE_REFUND` | Net-negative spending clamps to 0 |
| `BUDGET_FIXTURE_ZERO_BUDGET` | Throws `InvalidBudgetError` |

Coverage floor for `lib/core/budgets/**` is **90%**, the standard `lib/core`
floor — this module informs decisions but, unlike Safe to Spend and the
Timeline, does not itself report a headline figure.
