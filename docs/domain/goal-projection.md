# Goal Projection, Impact, and What-If

**One sentence:** one pure function projects a savings goal — the monthly
contribution it requires, the date it will actually be reached at the observed
contribution rate, and the `PlannedSavings` figure Safe to Spend consumes — and
because it is pure, Goal Impact (spec §14) and What-If (spec §18) are the *same
function called twice with different inputs* and a subtraction, which is why
both are cheap features rather than new subsystems.

Covers spec §13 (Savings Goals, MVP), spec §14 (Goal Impact, V2), and spec §18
(What-If Scenarios, V2). Progress tracking ships in the MVP; projection and the
two derived features are V2, spec'd together here because they share every
primitive.

Related: [safe-to-spend.md](safe-to-spend.md) (consumes `PlannedSavings`),
[money-and-rounding.md](money-and-rounding.md) (rounding rules — this doc has
the domain's only ceiling-rounded division),
[recurrence.md](recurrence.md) (`CalendarDate`, month arithmetic),
[budget-forecasting.md](budget-forecasting.md) (the same trailing-window
estimator pattern), and
[../../tasks/backlog/m6-goals.md](../../tasks/backlog/m6-goals.md).

## Domain model

Spec §22 gives `goals` five meaningful fields: `name`, `target_amount`,
`current_amount`, `target_date`, and the identity columns. Two additions this
document requires:

| Field | Type | Why |
|---|---|---|
| `target_amount_minor` | `bigint NOT NULL CHECK (> 0)` | Minor units per [money-and-rounding.md](money-and-rounding.md); a zero-target goal is meaningless |
| `current_amount_minor` | `bigint NOT NULL DEFAULT 0` | Denormalized sum of contributions — see below |
| `target_date` | `date NULL` | **Nullable.** "Save ₱100,000 eventually" is a real goal; a required date forces users to invent one |
| `status` | `text` — `active` / `paused` / `achieved` / `archived` | Only `active` goals contribute to `PlannedSavings`. Without this, a completed goal keeps suppressing Safe to Spend forever |
| `monthly_target_minor` | `bigint NULL` | An explicit user-set contribution, overriding the derived requirement. See [The two contribution figures](#the-two-contribution-figures) |

`goal_contributions` is a new table, not a nullable column on `transactions`:

```text
goal_contributions
├── id
├── user_id
├── goal_id
├── transaction_id      -- NULL for a manual "I moved ₱5,000" entry
├── amount_minor        -- bigint, > 0
├── date                -- date, calendar date in the user's timezone
├── created_at
└── updated_at
```

`current_amount_minor` on `goals` is the running sum, maintained by the write
path so the dashboard does not aggregate on every render. `lib/core` never
trusts it as an independent fact — [G1](#invariants-for-property-tests) asserts
it equals the contribution sum, and the integration test that seeds
contributions and re-reads the goal is the guard against drift.

Contributions carry a `date` because **every projection in this document is a
function of the contribution history, not of the current balance**. A goal at
₱35,000 that got there in two months and one that took a year need completely
different projections, and only the dated history distinguishes them.

```typescript
export interface Goal {
  readonly id: string;
  readonly name: string;
  readonly targetAmountMinor: number;
  readonly currentAmountMinor: number;
  readonly targetDate: CalendarDate | null;
  readonly status: 'active' | 'paused' | 'achieved' | 'archived';
  /** User-set monthly contribution, overriding the derived requirement. */
  readonly monthlyTargetMinor: number | null;
  readonly currency: CurrencyCode;
}

export interface Contribution {
  readonly id: string;
  readonly goalId: string;
  readonly amountMinor: number;
  readonly date: CalendarDate;
}
```

## Required monthly contribution

The forward-looking figure: what must be set aside each month to hit the target
by the target date.

```text
remainingMinor  = max(0, targetAmountMinor - currentAmountMinor)
monthsUntil     = monthsBetween(today, targetDate)      -- see definition below

requiredMonthlyContributionMinor = ceil(remainingMinor / monthsUntil)
```

### Term definitions

| Term | Definition |
|---|---|
| `remainingMinor` | `max(0, target − current)`. Floored at zero so an over-funded goal reports `0` required, never a negative "contribution" |
| `monthsUntil` | Whole months from `today` to `targetDate`, **counting the month containing `targetDate` as available**. Formally: `(targetDate.year − today.year) × 12 + (targetDate.month − today.month) + (targetDate.day >= today.day ? 1 : 0)`, floored at `0` |
| `today` | Injected `CalendarDate`. Never read from a clock — [source-structure.md](../architecture/source-structure.md#why-libcore-is-quarantined) |
| `ceil` | `divideRoundUp` from [money-and-rounding.md](money-and-rounding.md#rounding-direction-deliberately-chosen-per-site) |

`monthsUntil` needs the fiddly `+1` term because a goal due on the 30th, viewed
on the 10th, has this month available to contribute in. A naive month
difference of `0` would either divide by zero or claim the goal is impossible.
Worked:

| `today` | `targetDate` | Raw month diff | Day adjust | `monthsUntil` |
|---|---|---|---|---|
| 2026-09-09 | 2026-12-31 | 3 | +1 (31 ≥ 9) | **4** |
| 2026-09-09 | 2026-09-30 | 0 | +1 (30 ≥ 9) | **1** |
| 2026-09-09 | 2026-09-05 | 0 | +0 (5 < 9) | **0** — overdue |
| 2026-09-09 | 2027-09-09 | 12 | +1 (9 ≥ 9) | **13** |
| 2026-09-09 | 2026-08-31 | −1 | +1 | **0** — floored |

Rounding **up** rather than half-up: ₱10,000 over 3 months at half-up is
₱3,333/month, and ₱3,333 × 3 = ₱9,999 — a goal tracker that reports "on track"
while falling a centavo short is worse than one that asks for ₱3,334. The
domain's only other ceiling is nowhere; this is the exception and
[money-and-rounding.md](money-and-rounding.md) records it.

### The two contribution figures

Two different numbers, easily conflated, both needed:

| Figure | Meaning | Source |
|---|---|---|
| `requiredMonthlyContributionMinor` | What the **target date demands** | Derived: `ceil(remaining / monthsUntil)` |
| `effectiveMonthlyTargetMinor` | What the **user has committed to**, and what Safe to Spend reserves | `goal.monthlyTargetMinor ?? requiredMonthlyContributionMinor` |

They diverge constantly. A user with a ₱100,000 emergency fund and no target
date has no *required* contribution at all (`monthsUntil` is undefined) but may
have committed to ₱5,000/month. Conversely a user with an aggressive target
date may be told ₱12,000/month is required while only committing ₱5,000 — in
which case the goal is behind, `projectedCompletionDate` says so, and Safe to
Spend reserves the ₱5,000 they actually intend, not the ₱12,000 they don't.

**Safe to Spend consumes `effectiveMonthlyTargetMinor`.** Reserving the
*required* figure would silently suppress spendable money on the user's behalf
against a commitment they never made.

| Goal state | `targetDate` | `monthlyTargetMinor` | `effectiveMonthlyTarget` |
|---|---|---|---|
| Dated, no explicit target | set | `null` | derived requirement |
| Dated, explicit target | set | `500_000` | **₱5,000** (explicit wins) |
| Undated, explicit target | `null` | `500_000` | **₱5,000** |
| Undated, no explicit target | `null` | `null` | **`0`** — nothing to reserve |

That last row is the important default: an aspirational goal with no date and no
committed monthly amount must not reduce Safe to Spend. Guessing a number there
would make the headline figure inexplicable, which is the one thing spec §9's
UX cannot tolerate.

## Observed contribution rate

The backward-looking figure that drives every projection: how fast is this user
*actually* saving?

```text
Trailing window: the N most recently COMPLETED periods before today's period,
                 N = TRAILING_PERIODS (default 3), periods = calendar months.

contributedInWindowMinor = sum of contributions whose date falls in the window
periodsInWindow          = number of periods in the window that are at or
                           after the goal's first contribution
                           (never fewer than 1 when any contribution exists)

observedMonthlyRateMinor = divideRoundHalfUp(
                             contributedInWindowMinor, periodsInWindow)
```

Four decisions inside that:

- **Completed periods only.** Including the current, partial month would make
  the rate collapse on the 1st of every month and recover by the 28th, so the
  projected completion date would swing wildly for reasons that have nothing to
  do with the user's behaviour. The current month's contributions still count
  toward `currentAmountMinor` — they are just not evidence of a *rate* yet.
- **Three periods by default.** One period is noise (a bonus month reads as a
  permanent raise). Six is unresponsive — a user who doubles their saving waits
  half a year to see it. Three is the smallest window that survives one unusual
  month, and it matches [budget-forecasting.md](budget-forecasting.md)'s
  historical window so a user's two forecasts rest on the same evidence.
- **Periods are counted from the goal's first contribution**, not blindly as 3.
  A goal created last month has one period of history; dividing its ₱5,000 by 3
  would report ₱1,667/month and project a completion date years too late.
- **Zero-contribution periods inside the window count.** A user who saved
  ₱15,000 two months ago and nothing since has a rate of ₱5,000/month, not
  ₱15,000/month. Excluding empty periods would flatter every lapsed goal.

```typescript
export const TRAILING_PERIODS = 3;
```

Tunable, and exposed on the input so What-If can perturb it.

## Projected completion date

```text
if remainingMinor === 0
   -> { kind: 'already_reached', date: today }

if observedMonthlyRateMinor <= 0
   -> { kind: 'never_at_this_rate', date: null }

monthsNeeded = ceil(remainingMinor / observedMonthlyRateMinor)     -- whole months
if monthsNeeded > MAX_PROJECTION_MONTHS (600)
   -> { kind: 'beyond_horizon', date: null, monthsNeeded }

projectedCompletionDate = addMonthsClamped(endOfMonth(today), monthsNeeded)
   -> { kind: 'projected', date: <that>, monthsNeeded }
```

The date lands on a **month end** because the rate is a monthly figure: the
model is "one contribution arrives per month", and claiming precision to the
day from monthly evidence would be false confidence. `addMonthsClamped` reuses
[recurrence.md](recurrence.md#month-end-clamping-with-anchor-preservation)'s
clamping so a projection from January 31 does not skid.

`MAX_PROJECTION_MONTHS = 600` (50 years) exists so the UI never renders
"projected completion: March 2387". Past that horizon the honest statement is
the same as `never_at_this_rate`, with a different explanation.

### The four outcomes, and their copy

The result is a **discriminated union, not a nullable date**, because each case
needs different words. Handing the UI `null` and letting it guess produces
"Projected: —", which tells the user nothing. Spec §32's tone —
non-judgmental, slightly goofy, never scolding a user about money — applies
hardest here, where the honest answer is "at this rate, never".

| `kind` | Condition | UI copy |
|---|---|---|
| `already_reached` | `remaining === 0` | "Done! You hit ₱100,000. 🎉" |
| `projected` | rate > 0, within horizon | "On track for **March 2027** at ₱5,000/month." |
| `never_at_this_rate` | rate ≤ 0 | "**Not moving right now.** You haven't added to this in a while — even ₱500 a month gets it going." |
| `beyond_horizon` | `monthsNeeded > 600` | "**That's a long way off.** At ₱200 a month this takes about 42 years. Want to bump it up?" |

`never_at_this_rate` deliberately avoids "never". "Never" reads as a verdict on
the user; "not moving right now" reads as a description of the data, which is
all it is. The copy also names a concrete, small next step, because the
alternative — a red banner and no suggestion — is the pattern that makes people
close budgeting apps.

## Goal Impact

Spec §14: connect a spending decision to a goal's future.

> You spent ₱1,500 more on shopping this month.
>
> Your Japan Trip goal is now projected to be completed 9 days later.

**The whole feature is a subtraction between two calls to the same function.**

```text
baseline  = projectGoal({ ...input })
scenario  = projectGoal({ ...input, extraSpendThisPeriodMinor: 150_000 })

deltaDays = daysBetween(baseline.projectedDate, scenario.projectedDate)
```

The mechanism by which extra spending moves a goal: money spent is money not
available to contribute, so the scenario's observed rate drops by the extra
spend amortized over the trailing window.

```text
adjustedRateMinor = max(0, observedMonthlyRateMinor
                          - divideRoundHalfUp(extraSpendThisPeriodMinor,
                                              periodsInWindow))
```

Amortized over the window rather than subtracted whole because a one-off
₱1,500 overspend is not a permanent ₱1,500/month reduction. Spreading it across
the same window the rate was measured over keeps the two figures commensurable
and keeps the impact proportionate — which is the difference between a feature
that builds intuition and one that cries wolf.

### Worked example — spec §14's shape

Reproducing the *structure* of the spec's example (the spec gives the output
"9 days later" without inputs, so these are the inputs that produce it):

```text
Goal: Japan Trip
  targetAmountMinor       12_000_000   (₱120,000, spec §13)
  currentAmountMinor       4_200_000   (₱42,000,  spec §13)
  remainingMinor           7_800_000   (₱78,000)
  today                    2026-09-09

Trailing 3 completed periods: Jun, Jul, Aug 2026
  contributions            ₱6,000 + ₱6,000 + ₱6,000 = 1_800_000
  periodsInWindow          3
  observedMonthlyRate        600_000   (₱6,000/month)

BASELINE
  monthsNeeded = ceil(7_800_000 / 600_000)  = ceil(13.0)    = 13
  projectedDate = endOfMonth(2026-09) + 13 months           = 2027-10-31

SCENARIO: ₱1,500 extra shopping this month
  rateReduction = ceil? no - half-up(150_000 / 3)           =    50_000
  adjustedRate  = 600_000 - 50_000                          =   550_000
  monthsNeeded  = ceil(7_800_000 / 550_000) = ceil(14.18)   = 15
  projectedDate = endOfMonth(2026-09) + 15 months           = 2027-12-31

DELTA
  daysBetween(2027-10-31, 2027-12-31)                       = 61 days
  -> "about 2 months later"
```

Two months, not nine days — because the monthly-granularity projection can only
move in month-sized steps. That is an honest consequence of the model, and it
means **Goal Impact must express its delta in the granularity the model
supports**:

| `deltaDays` | Copy |
|---|---|
| `0` | "No change to your Japan Trip. Enjoy the shoes." |
| `1 … 45` | "…projected **about a month later**." |
| `46 … 400` | "…projected **about N months later**", `N = round(days / 30)` |
| `> 400` | "…projected **over a year later**." |
| baseline `projected`, scenario not | "…**paused** at this rate." |

To hit the spec's day-granular "9 days later" the projection would need a daily
contribution rate, which the data cannot support — contributions are monthly
events, and inventing per-day precision from them would be false confidence of
exactly the kind [budget-forecasting.md](budget-forecasting.md#confidence)
guards against. The `deltaDays` field stays in the result (it is the exact
subtraction, and V3's debt planner will want it); the *copy* rounds to the
granularity the evidence justifies.

> [!NOTE]
> If day-granular impact is later judged worth it, the change is confined to
> `projectGoal`'s date arithmetic — switch to a daily rate and a day-stepped
> projection. Goal Impact and What-If need **no** changes, because both only
> subtract two of its outputs. That is the payoff of building this as one pure
> function.

## What-If

Spec §18. The headline example:

> What if I save ₱5,000 more every month?
>
> **Current plan** — Emergency fund: ₱50,000 → ₱100,000, 8 months
> **New plan** — Emergency fund: ₱50,000 → ₱100,000, 5 months
> *Goal reached approximately 3 months earlier.*

### Worked example — spec §18 exactly

```text
Goal: Emergency Fund
  currentAmountMinor       5_000_000   (₱50,000)
  targetAmountMinor       10_000_000   (₱100,000)
  remainingMinor           5_000_000   (₱50,000)
  today                    2026-09-09

BASELINE
  observedMonthlyRate        625_000   (₱6,250/month, from the trailing window)
  monthsNeeded = ceil(5_000_000 / 625_000) = ceil(8.0)      = 8   ✓ spec's "8 months"
  projectedDate = endOfMonth(2026-09) + 8 months            = 2027-05-31

SCENARIO: contribute ₱5,000 more per month
  override monthlyContributionMinor = 625_000 + 500_000     = 1_125_000
  monthsNeeded = ceil(5_000_000 / 1_125_000) = ceil(4.44)   = 5   ✓ spec's "5 months"
  projectedDate = endOfMonth(2026-09) + 5 months            = 2027-02-28

DELTA
  8 - 5                                                     = 3 months earlier
  -> "Goal reached approximately 3 months earlier."          ✓ spec's copy
```

Both spec figures reproduce exactly. `ceil(4.44) = 5` is why the rounding
direction is specified: half-up would give 4 and break the spec's own example.

### Why What-If needs no new math

What-If is an **input-override layer** over the projection functions that
already exist:

```text
┌─────────────────────────────────────────────────────────┐
│  What-If UI (V2)                                        │
│  sliders / inputs -> ScenarioOverrides                  │
└────────────────────────┬────────────────────────────────┘
                         │
             applyOverrides(baseInput, overrides)
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
   projectGoal(baseInput)          projectGoal(overriddenInput)
   computeSafeToSpend(base)        computeSafeToSpend(overridden)
   forecastBudget(base)            forecastBudget(overridden)
        │                                 │
        └────────────► compare ◄──────────┘
                         │
              ScenarioComparison  (a diff, no new formula)
```

Every scenario in spec §18's list maps to an override on an input that already
exists:

| Scenario | Override | Function re-run |
|---|---|---|
| "What if I save ₱5,000 more every month?" | `+monthlyContributionMinor` | `projectGoal` |
| "What if rent increases?" | amount on one recurring rule | `computeSafeToSpend`, `buildTimeline` |
| "What if I earn ₱10,000 more?" | `+expectedIncomeMinor` | `computeSafeToSpend` |
| "What if I spend ₱5,000 less?" | `−extraSpendThisPeriodMinor` | `projectGoal`, `forecastBudget` |
| "What if I stop a subscription?" | drop one recurring rule | `computeSafeToSpend`, `buildTimeline` |
| "Can I afford this purchase?" | one extra dated expense | `computeSafeToSpend`, `buildTimeline` |

This is the concrete payoff of the `lib/core` purity rules
([source-structure.md](../architecture/source-structure.md#why-libcore-is-quarantined)
names What-If as the reason). A function that read the database, the clock, or
`process.env` could not be re-run on hypothetical inputs — you would need a
parallel "simulation" implementation, it would drift from the real one, and
users would get a simulation that disagreed with the dashboard. Purity is what
turns a whole spec section into a UI layer plus a subtraction.

```typescript
export interface ScenarioOverrides {
  readonly monthlyContributionDeltaMinor?: number;
  readonly extraSpendThisPeriodMinor?: number;
  readonly expectedIncomeDeltaMinor?: number;
  readonly recurringAmountOverrides?: Readonly<Record<string, number>>;
  readonly disabledRecurringIds?: readonly string[];
  readonly additionalOneOffs?: readonly ScheduledItem[];
  readonly targetDateOverride?: CalendarDate | null;
  readonly trailingPeriodsOverride?: number;
}

/** Pure input transform. Never mutates. The entire What-If backend. */
export function applyOverrides<T extends ProjectionInputs>(
  base: T,
  overrides: ScenarioOverrides,
): T;

export interface ScenarioComparison {
  readonly baseline: GoalProjectionResult;
  readonly scenario: GoalProjectionResult;
  readonly deltaMonths: number | null;
  readonly deltaDays: number | null;
  readonly direction: 'earlier' | 'later' | 'unchanged' | 'incomparable';
}

export function compareScenarios(
  input: GoalProjectionInput,
  overrides: ScenarioOverrides,
): ScenarioComparison;
```

`direction: 'incomparable'` covers the case where one side has no date
(`never_at_this_rate` on either side). Reporting a delta of `null` with a
direction the UI can branch on beats forcing it to inspect two unions.

## PlannedSavings — the term Safe to Spend consumes

[safe-to-spend.md](safe-to-spend.md) subtracts `PlannedSavings`. Defined here,
because it is a property of goals:

```text
PlannedSavingsMinor = sum over ACTIVE goals g of
    max(0, effectiveMonthlyTarget(g) - contributedThisPeriod(g))
```

| Term | Definition |
|---|---|
| ACTIVE goals | `status === 'active'` only. `paused`, `achieved`, `archived` contribute `0` |
| `effectiveMonthlyTarget(g)` | `g.monthlyTargetMinor ?? requiredMonthlyContribution(g, today)`, and `0` when the goal has neither an explicit target nor a target date |
| `contributedThisPeriod(g)` | Sum of `g`'s contributions dated within `[periodStart, today]`, where `periodStart` is the first day of `today`'s calendar month — the same period Safe to Spend's horizon `H` closes |
| `max(0, …)` | Floored per goal, **before** summing |

### Why the floor is per goal, not on the sum

This is the subtle part, and getting it wrong produces a Safe to Spend that
rewards the user for over-saving on one goal.

```text
Goal A: monthly target ₱5,000, contributed ₱8,000 this month  -> over by ₱3,000
Goal B: monthly target ₱5,000, contributed ₱1,000 this month  -> short ₱4,000

Per-goal floor (CORRECT):
   max(0, 5,000 - 8,000) + max(0, 5,000 - 1,000) = 0 + 4,000 = ₱4,000

Floor on the sum (WRONG):
   max(0, (5,000 - 8,000) + (5,000 - 1,000))     = max(0, 1,000) = ₱1,000
```

The wrong version lets Goal A's ₱3,000 surplus cancel Goal B's shortfall,
releasing ₱3,000 as "safe to spend" — money the user must still put into Goal B
this month. Goals are separate commitments; surplus in one does not discharge
another. The per-goal floor also means over-contributing can never *increase*
Safe to Spend, which is [G8](#invariants-for-property-tests).

### Why remaining, not the full monthly target

Safe to Spend reserves what is **still owed this period**, not the full monthly
figure. A user who already moved their ₱10,000 into savings on the 1st has
already had that money removed from their spendable balance — it left the
checking account. Subtracting the full ₱10,000 again on the 15th would
double-count it, and the user would watch Safe to Spend drop by ₱10,000 for
doing exactly what they planned. That is the fastest way to teach someone the
number is wrong.

## Function contract

```typescript
// lib/core/goals/index.ts

export interface GoalProjectionInput {
  readonly today: CalendarDate;
  readonly goal: Goal;
  /** All contributions to this goal. Order-independent. */
  readonly contributions: readonly Contribution[];
  /** Trailing window length in periods. Defaults to TRAILING_PERIODS. */
  readonly trailingPeriods?: number;
  /** What-If / Goal Impact: extra spend amortized over the window. */
  readonly extraSpendThisPeriodMinor?: number;
  /** What-If: replaces the OBSERVED rate outright. */
  readonly monthlyContributionOverrideMinor?: number;
  readonly currency: CurrencyCode;
}

export type ProjectedCompletion =
  | { readonly kind: 'already_reached'; readonly date: CalendarDate; readonly monthsNeeded: 0 }
  | { readonly kind: 'projected'; readonly date: CalendarDate; readonly monthsNeeded: number }
  | { readonly kind: 'never_at_this_rate'; readonly date: null }
  | { readonly kind: 'beyond_horizon'; readonly date: null; readonly monthsNeeded: number };

export interface GoalProjectionResult {
  readonly goalId: string;

  // --- position -----------------------------------------------------------
  readonly targetAmountMinor: number;
  readonly currentAmountMinor: number;
  readonly remainingMinor: number;
  /** Progress in basis points. 10_000 = 100%. Capped at 10_000. */
  readonly progressBps: number;

  // --- forward-looking ----------------------------------------------------
  readonly monthsUntilTarget: number | null;   // null when targetDate is null
  readonly requiredMonthlyContributionMinor: number | null;
  readonly effectiveMonthlyTargetMinor: number;

  // --- backward-looking ---------------------------------------------------
  readonly observedMonthlyRateMinor: number;
  readonly trailingWindow: {
    readonly periods: readonly PeriodKey[];
    readonly contributedMinor: number;
    readonly periodsCounted: number;
    readonly contributionsConsidered: readonly string[]; // contribution ids
  };

  // --- projection ---------------------------------------------------------
  readonly projectedCompletion: ProjectedCompletion;
  /** True when the projection is later than targetDate, or has no date. */
  readonly behindTarget: boolean;

  // --- the term safe-to-spend consumes ------------------------------------
  readonly contributedThisPeriodMinor: number;
  readonly plannedSavingsThisPeriodMinor: number;

  readonly confidence: 'low' | 'medium' | 'high';
  readonly currency: CurrencyCode;
}

/** Pure. `today` injected. No clock, no I/O. */
export function projectGoal(input: GoalProjectionInput): GoalProjectionResult;

/** Sums plannedSavingsThisPeriodMinor across active goals. */
export function computePlannedSavings(input: {
  readonly today: CalendarDate;
  readonly goals: readonly Goal[];
  readonly contributionsByGoalId: Readonly<Record<string, readonly Contribution[]>>;
  readonly currency: CurrencyCode;
}): {
  readonly totalMinor: number;
  readonly perGoal: readonly {
    readonly goalId: string;
    readonly goalName: string;
    readonly effectiveMonthlyTargetMinor: number;
    readonly contributedThisPeriodMinor: number;
    readonly plannedMinor: number;
  }[];
};

export function compareScenarios(
  input: GoalProjectionInput,
  overrides: ScenarioOverrides,
): ScenarioComparison;
```

`trailingWindow` and `perGoal` exist for the same reason Safe to Spend returns
a breakdown: **the UI has to explain the number.** "Projected March 2027" is
not actionable; "March 2027, based on ₱6,000/month over Jun–Aug" is, because
the user can see which assumption to argue with. `contributionsConsidered`
carries the ids so a detail view can list the exact rows.

`confidence` mirrors [budget-forecasting.md](budget-forecasting.md#confidence):
`low` when fewer than 2 completed periods have contributions, `high` at 3+ with
a coefficient of variation under 0.5, `medium` otherwise. A `low`-confidence
projected date must be rendered with hedging copy, never as a fact.

## Edge cases

| Case | Behaviour | Why |
|---|---|---|
| `targetDate === null` | `monthsUntilTarget: null`, `requiredMonthly: null`; projection still works from the observed rate | Undated goals are legitimate (spec §13 lists target date as a feature, not a requirement) |
| `targetDate` in the past, goal unmet | `monthsUntilTarget: 0`, `requiredMonthly: remainingMinor` (the whole thing, now), `behindTarget: true` | Never divide by zero; "you needed all of it by now" is the honest statement |
| `targetDate` is this month | `monthsUntilTarget: 1` | This month is still available |
| `current >= target` | `remaining: 0`, `progressBps: 10_000`, `already_reached`, `plannedSavings: 0` | An achieved goal stops reserving money |
| `current > target` | Same; `progressBps` **capped** at `10_000` | A 143% progress bar is a rendering bug |
| `targetAmountMinor === 0` | Throw `DomainError` | Guarded by a `CHECK` constraint; a zero-target goal has no meaning |
| `currentAmountMinor < 0` | Throw `DomainError` | Contributions are positive; a negative sum means the write path is broken |
| No contributions at all | `observedRate: 0`, `never_at_this_rate`, `confidence: 'low'` | Brand-new goal; copy invites a first contribution |
| Contributions only in the current month | `observedRate: 0` (window is completed periods), `confidence: 'low'`, but `contributedThisPeriod > 0` so `plannedSavings` shrinks correctly | The two figures answer different questions |
| One completed period with contributions | `periodsCounted: 1`, rate = that period's sum, `confidence: 'low'` | Never divide by the full window when history is shorter |
| Contributions predate the window | Excluded from the rate, included in `currentAmountMinor` | The rate measures recent behaviour |
| Zero-contribution month inside the window | Counted in `periodsCounted` | A lapsed goal must not read as fast |
| `observedRate` exactly `0` | `never_at_this_rate` | — |
| `observedRate` such that `monthsNeeded > 600` | `beyond_horizon` with `monthsNeeded` | UI shows years, not a date |
| `status: 'paused'` | `plannedSavings: 0`; projection still computed for display | A paused goal shows its position without reserving money |
| `status: 'achieved'` / `'archived'` | `plannedSavings: 0` | — |
| `monthlyTargetMinor: 0` (explicit) | `effectiveMonthlyTarget: 0`; the explicit `0` **wins** over the derived requirement | "Not contributing right now" is a real choice and must be respected |
| `monthlyTargetMinor` < required | `behindTarget: true`; STS reserves the committed amount | Never reserve money the user did not commit |
| `contributedThisPeriod > effectiveMonthlyTarget` | `plannedSavings: 0` for that goal, floored per goal | See [the per-goal floor](#why-the-floor-is-per-goal-not-on-the-sum) |
| Projection from Jan 31 + 1 month | Feb 28/29, clamped | [recurrence.md](recurrence.md#month-end-clamping-with-anchor-preservation) |
| `extraSpend` exceeds the observed rate | `adjustedRate` floors at `0` → `never_at_this_rate` | Rate can't go negative; the honest answer is "paused" |
| `extraSpend` on an `already_reached` goal | No impact; `direction: 'unchanged'` | Overspending cannot un-reach a met goal |
| `trailingPeriodsOverride: 0` | Throw `DomainError` | A zero-period window has no meaning; guard the divide |
| Goal currency ≠ profile currency | Throw `MixedCurrencyError` | [money-and-rounding.md](money-and-rounding.md#single-currency-per-user) |
| Empty `goals` in `computePlannedSavings` | `{ totalMinor: 0, perGoal: [] }` | `sumMinor([]) === 0`; STS still computes |
| Two goals, one over- one under-funded | Per-goal floor; no cross-cancellation | The worked example above |

## Invariants for property tests

| # | Invariant | Statement |
|---|---|---|
| **G1** | Current equals history | `currentAmountMinor === sum(contributions.amountMinor)` (integration-level guard on the denormalized column) |
| **G2** | Remaining floor | `remainingMinor === max(0, target − current)`, never negative |
| **G3** | Progress bounds | `0 ≤ progressBps ≤ 10_000`, always |
| **G4** | Required covers remaining | `requiredMonthly × monthsUntilTarget ≥ remainingMinor` — the ceiling never undershoots |
| **G5** | Required tightness | `(requiredMonthly − 1) × monthsUntilTarget < remainingMinor` — and never overshoots by a whole unit |
| **G6** | Rate monotonicity | adding a contribution inside the window never decreases `observedMonthlyRateMinor` |
| **G7** | Projection monotonicity | a higher rate never yields a later `projectedCompletion.date` |
| **G8** | Contributing never increases planned savings | adding a contribution to any goal never increases `PlannedSavings` — so it never *decreases* Safe to Spend |
| **G9** | Planned savings bounds | `0 ≤ plannedSavingsThisPeriodMinor ≤ effectiveMonthlyTargetMinor`, per goal |
| **G10** | Planned savings additivity | `computePlannedSavings.totalMinor === sum(perGoal.plannedMinor)` |
| **G11** | Inactive goals are inert | changing a non-`active` goal's amounts never changes `PlannedSavings` |
| **G12** | Order independence | shuffling `contributions` changes nothing in the result |
| **G13** | Determinism | identical input yields a deeply-equal result, run to run, under any `TZ` |
| **G14** | Purity | no `Date`, `Math.random`, or `process` reachable from `projectGoal` (enforced by lint + a module-graph test) |
| **G15** | What-If identity | `applyOverrides(base, {})` is deeply equal to `base`; `projectGoal` of it equals `projectGoal(base)` |
| **G16** | No mutation | `applyOverrides` never mutates `base` (deep-freeze the input in tests) |
| **G17** | Impact direction | `extraSpendThisPeriodMinor > 0 ⇒ scenario date ≥ baseline date` — extra spending never brings a goal closer |
| **G18** | Impact symmetry | increasing the contribution by `x` moves the date no later than decreasing it by `x` moves it earlier |
| **G19** | Comparison consistency | `direction === 'earlier' ⟺ deltaDays < 0`; `'incomparable' ⟺ either side has no date` |
| **G20** | Zero-delta stability | `extraSpendThisPeriodMinor === 0 ⇒ direction === 'unchanged'` and both results deeply equal |
| **G21** | Achieved absorbs everything | `remaining === 0` ⇒ every override yields `already_reached` |
| **G22** | Confidence monotonicity | more completed periods of history never lowers `confidence` |

G8 is the one that protects the user's trust: it is the formal statement of
"putting money into a goal must never make the app tell you you have less to
spend than before you did the right thing".

G17 is Goal Impact's soundness property, and it is worth stating because the
amortization arithmetic makes it non-obvious — a sign error there would produce
a feature that congratulates users for overspending.

## Canonical unit-test fixture

`tests/unit/core/goals.test.ts`. The spec's own two worked examples are the
canonical fixtures; neither may be adjusted to fit an implementation.

### `GOAL_FIXTURE_WHATIF_EMERGENCY_FUND` — spec §18, canonical

```typescript
{
  today: { year: 2026, month: 9, day: 9 },
  goal: {
    id: 'goal-emergency',
    name: 'Emergency Fund',
    targetAmountMinor: 10_000_000,     // ₱100,000
    currentAmountMinor:  5_000_000,    // ₱50,000
    targetDate: null,
    status: 'active',
    monthlyTargetMinor: null,
    currency: 'PHP',
  },
  contributions: [
    { id: 'c1', goalId: 'goal-emergency', amountMinor: 625_000,
      date: { year: 2026, month: 6, day: 15 } },
    { id: 'c2', goalId: 'goal-emergency', amountMinor: 625_000,
      date: { year: 2026, month: 7, day: 15 } },
    { id: 'c3', goalId: 'goal-emergency', amountMinor: 625_000,
      date: { year: 2026, month: 8, day: 15 } },
  ],
  currency: 'PHP',

  expectedBaseline: {
    remainingMinor: 5_000_000,
    progressBps: 5_000,                       // exactly 50%
    observedMonthlyRateMinor: 625_000,        // ₱6,250
    projectedCompletion: {
      kind: 'projected',
      monthsNeeded: 8,                        // <- spec §18's "8 months"
      date: { year: 2027, month: 5, day: 31 },
    },
  },

  overrides: { monthlyContributionDeltaMinor: 500_000 },   // "+₱5,000/month"

  expectedScenario: {
    observedMonthlyRateMinor: 1_125_000,      // ₱11,250
    projectedCompletion: {
      kind: 'projected',
      monthsNeeded: 5,                        // <- spec §18's "5 months"
      date: { year: 2027, month: 2, day: 28 },
    },
  },

  expectedComparison: {
    deltaMonths: -3,                          // <- spec §18's "3 months earlier"
    direction: 'earlier',
    copy: 'Goal reached approximately 3 months earlier.',
  },
}
```

Three assertions are non-negotiable and should be named in the test titles:
`monthsNeeded === 8`, `monthsNeeded === 5`, `deltaMonths === -3`. They are the
spec's own numbers, and `ceil(4.44) === 5` is why the rounding direction is
specified rather than assumed.

### `GOAL_FIXTURE_IMPACT_JAPAN_TRIP` — spec §14's shape

The [Goal Impact worked example](#worked-example--spec-14s-shape) above, with
spec §13's Japan Trip figures (₱42,000 of ₱120,000) and a ₱1,500 extra-spend
override. Asserts:

- baseline `monthsNeeded: 13`, date `2027-10-31`
- scenario `adjustedRate: 550_000`, `monthsNeeded: 15`, date `2027-12-31`
- `deltaDays: 61`, `direction: 'later'`
- copy: `"about 2 months later"`

And a documented divergence test: the spec's illustrative "9 days later" is
**not** reproducible at monthly granularity, asserted as a comment on the test
so a future reader does not treat it as a bug. If day-granular projection is
ever implemented, this fixture is where the change surfaces.

### `GOAL_FIXTURE_PLANNED_SAVINGS_STS` — the ₱10,000 in Safe to Spend

The goals that produce spec §9's ₱10,000 savings target, shared verbatim with
[safe-to-spend.md](safe-to-spend.md#canonical-unit-test-fixture):

```typescript
{
  today: { year: 2026, month: 9, day: 9 },
  goals: [
    { id: 'goal-emergency', name: 'Emergency Fund', status: 'active',
      targetAmountMinor: 10_000_000, currentAmountMinor: 3_500_000,
      targetDate: null, monthlyTargetMinor: 600_000, currency: 'PHP' },
    { id: 'goal-japan', name: 'Japan Trip', status: 'active',
      targetAmountMinor: 12_000_000, currentAmountMinor: 4_200_000,
      targetDate: null, monthlyTargetMinor: 400_000, currency: 'PHP' },
    { id: 'goal-laptop', name: 'New Laptop', status: 'paused',
      targetAmountMinor: 7_000_000, currentAmountMinor: 2_500_000,
      targetDate: null, monthlyTargetMinor: 300_000, currency: 'PHP' },
  ],
  contributionsByGoalId: {},        // nothing contributed yet this month
  currency: 'PHP',
  expected: {
    totalMinor: 1_000_000,          // ₱6,000 + ₱4,000 = ₱10,000  <- spec §9
    perGoal: [
      { goalId: 'goal-emergency', plannedMinor: 600_000 },
      { goalId: 'goal-japan',     plannedMinor: 400_000 },
      { goalId: 'goal-laptop',    plannedMinor:       0 },  // paused
    ],
  },
}
```

The paused laptop goal is in the fixture on purpose: it is the regression guard
for [G11](#invariants-for-property-tests), and it comes from spec §13's own
three-goal table.

### `GOAL_FIXTURE_PER_GOAL_FLOOR`

The [over/under-funded pair](#why-the-floor-is-per-goal-not-on-the-sum): Goal A
₱5,000 target with ₱8,000 contributed, Goal B ₱5,000 target with ₱1,000
contributed. Expect `totalMinor: 400_000` (₱4,000), **not** ₱1,000. The
one-line test that fails on the tempting wrong implementation.

### `GOAL_FIXTURE_EDGE_TABLE`

Every row of the [edge-case table](#edge-cases) as an `it.each` — undated
goals, past target dates, over-funded goals, empty history, current-month-only
contributions, `monthlyTargetMinor: 0`, and the throwing cases.
