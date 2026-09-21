# Money Timeline

**Shape in one sentence:** a chronological list of the money events coming at
the user, each carrying the balance they will have *after* it lands — so the
question "will I make it to payday?" has a visible answer instead of requiring
arithmetic.

The second headline differentiator (spec §10, spec §29). Where
[Safe to Spend](safe-to-spend.md) collapses the future into one number, the
Timeline expands it back out in order. Same underlying data, opposite
presentation, and the two must never disagree.

Related: [recurrence.md](recurrence.md) (expansion and dedupe — shared),
[safe-to-spend.md](safe-to-spend.md) (shares the dedupe module),
[money-and-rounding.md](money-and-rounding.md),
[../architecture/data-model.md](../architecture/data-model.md),
[../../tasks/backlog/m8-money-timeline.md](../../tasks/backlog/m8-money-timeline.md).

## Contents

- [Reference rendering](#reference-rendering)
- [Input](#input)
- [Deterministic ordering](#deterministic-ordering)
- [Projected balance](#projected-balance)
- [Shortfall detection](#shortfall-detection)
- [Day grouping](#day-grouping)
- [Filtering](#filtering)
- [Horizon and the occurrence cap](#horizon-and-the-occurrence-cap)
- [Function contract](#function-contract)
- [Edge cases](#edge-cases)
- [Invariants for property tests](#invariants-for-property-tests)
- [Canonical unit-test fixture](#canonical-unit-test-fixture)

## Reference rendering

Spec §10's example, verbatim. This is the target visual (task `M8-F01`):

```text
TODAY
│
├── Sep 10
│   Salary              +₱35,000
│
├── Sep 12
│   Rent                -₱15,000
│
├── Sep 15
│   Credit Card         -₱8,500
│
├── Sep 20
│   Freelance           +₱12,000
│
└── Sep 25
    Internet             -₱1,800
```

The same data as the structure the function returns, with the projected balance
the spec's tree leaves implicit — starting from an opening balance of ₱42,000:

| Date | Label | Amount | Projected balance after |
|---|---|---|---|
| — | *(today, opening)* | — | ₱42,000 |
| Sep 10 | Salary | +₱35,000 | ₱77,000 |
| Sep 12 | Rent | −₱15,000 | ₱62,000 |
| Sep 15 | Credit Card | −₱8,500 | ₱53,500 |
| Sep 20 | Freelance | +₱12,000 | ₱65,500 |
| Sep 25 | Internet | −₱1,800 | ₱63,700 |

**The projected balance column is the feature.** A list of upcoming bills is a
calendar; a list of upcoming bills with a running balance is a forecast. It is
what makes the shortfall visible before it happens.

## Input

Four things, all resolved before the pure function sees them:

1. **Opening balance at `today`** — the same spendable-accounts sum
   `CurrentBalance` uses in [safe-to-spend.md](safe-to-spend.md#currentbalance).
   Excludes accounts flagged `exclude_from_safe_to_spend`, counts credit-card
   balances as the negative liability they are, and excludes future-dated
   transactions (those are timeline *events*, not balance).
2. **Scheduled one-off transactions** — future-dated rows in `transactions`.
3. **Recurring definitions** — expanded to occurrences over the horizon by
   [`expandOccurrences`](recurrence.md#function-contract), then
   **deduplicated against actuals** by the shared
   [`dedupeMaterialized`](recurrence.md#deduplication).
4. **Horizon** — 30 days by default, user-selectable 7 / 30 / 60 / 90.

> [!IMPORTANT]
> The dedupe module is **shared verbatim** with Safe to Spend, not
> reimplemented. If the two diverged, the timeline would show a bill the Safe to
> Spend figure had already discounted (or vice versa), and the user would be
> looking at two contradictory answers on the same dashboard. One module, one
> behaviour, one set of tests.

## Deterministic ordering

Events sort by a **total order** with no ties possible:

```text
1. date                    ascending    (earliest first)
2. direction               income before expense on the same date
3. amountMinor             descending   (larger first)
4. sourceId                ascending    (lexicographic — the final tiebreak)
```

**Why a total order rather than just sorting by date.** Two reasons, one
technical and one about honesty:

- **Snapshot tests need it.** With ties broken arbitrarily, the same input
  produces different output orderings across runs and platforms — `Array.sort`
  is only guaranteed stable within an engine, and the input order itself depends
  on database row order. Tests would flake, and a flaky test on money math gets
  ignored, which defeats the point of having it.
- **Income-before-expense is the honest reading.** When ₱35,000 of salary and
  ₱15,000 of rent both land on the 12th, ordering income first shows the
  balance rising then falling. Ordering expense first shows a dip that never
  actually happened and might display a spurious shortfall. Banks post credits
  before debits for the same reason.

`sourceId` as the final tiebreak guarantees the order is total: no two events
share one, since it is a row id.

## Projected balance

A running fold, seeded with the opening balance:

```text
balanceAfter[0] = openingBalanceMinor + signedAmount[0]
balanceAfter[i] = balanceAfter[i-1]   + signedAmount[i]

where signedAmount[i] = direction === 'in' ? +amountMinor : -amountMinor
```

Exact integer arithmetic throughout — no rounding, no accumulated float error.
See [money-and-rounding.md](money-and-rounding.md).

Each event carries `projectedBalanceAfterMinor`, so the UI renders the column
without doing its own arithmetic. Money math stays in `lib/core`, per
[../architecture/source-structure.md](../architecture/source-structure.md).

**Transfers between the user's own accounts are excluded entirely.** Both legs
net to zero against the spendable total, so including them would render two
events that cancel — visual noise implying activity that changes nothing. The
exception is a transfer to or from an *excluded* account (moving ₱10,000 into
untouchable savings genuinely reduces spendable money); that case is a real
event and appears. This mirrors the transfer handling in
[safe-to-spend.md](safe-to-spend.md#edge-cases).

## Shortfall detection

```text
shortfallDate = the date of the FIRST event where projectedBalanceAfterMinor < 0
              = null if the balance never goes negative in the horizon
```

**This is the feature's real payoff.** Spec §32 asks for the tone of *"Good news:
future-you still has money"* — and its inverse. Knowing on the 9th that rent on
the 12th will overdraw the account is actionable; discovering it on the 12th is
not. The whole point of a projected balance column is that this becomes visible
in advance.

The result also carries:

- `minProjectedBalanceMinor` and the date it occurs — the tightest moment in the
  horizon, which is useful even when it stays positive.
- `endingBalanceMinor` — where the user lands at the end of the horizon.

Only the **first** crossing is reported. A balance that dips negative, recovers
on payday, then dips again has one `shortfallDate`: the first one is the one the
user needs to act on, and listing every crossing turns a warning into noise.

## Day grouping

Events group by calendar date for rendering, matching spec §10's tree:

- A **`TODAY` anchor row** heads the list, carrying the opening balance. Spec
  §10 shows it, and it gives the running balance a visible starting point.
- **Days with no events are collapsed**, not rendered as empty rows. A 90-day
  horizon with six bills should show six entries, not eighty-four blanks.
- Within a day, events keep the total order above.
- Each day group carries the balance as at end of that day, so the UI can show
  a per-day summary without recomputing.

## Filtering

Spec §10 lists timeline filtering. Four dimensions, all applied **before** the
projected-balance fold:

| Filter | Values |
|---|---|
| Account | one or more account ids |
| Category | one or more category ids |
| Kind | `scheduled` (one-off) / `recurring` |
| Direction | `in` / `out` |

> [!WARNING]
> **Filtering changes the projected balance, and that is correct but needs care.**
> Filtering to expenses only produces a monotonically falling line that is not
> the user's real forecast — it is "what if only money went out". The UI must
> label a filtered projection as filtered (task `M8-F02`), or the user will read
> a partial view as a prediction. The alternative — computing the balance on
> unfiltered data and displaying it against filtered rows — is worse: the
> numbers would not add up on screen.

Filter state lives in URL search params, so a filtered view is shareable and
the back button works. See
[../architecture/state-and-caching.md](../architecture/state-and-caching.md).

## Horizon and the occurrence cap

| Horizon | Use |
|---|---|
| 7 days | "Can I get through the week?" |
| **30 days** | Default — matches the monthly mental model |
| 60 / 90 days | Planning a larger purchase |

The horizon is `[today, today + N days]`, inclusive at both ends.

**The cap.** Recurrence expansion over 90 days with several weekly rules
produces a bounded but non-trivial number of occurrences, and expansion is
CPU-bound in a serverless function. `MAX_TIMELINE_EVENTS` (default 500) truncates
the result, and truncation sets `truncated: true` so the UI can say so rather
than silently lying about the end of the horizon. Rationale and the mechanism:
[recurrence.md](recurrence.md#the-occurrence-cap) and
[../architecture/system-architecture.md](../architecture/system-architecture.md#performance-and-scale).

Truncation drops the **latest** events, never the earliest — the near future is
what the user acts on.

## Function contract

```typescript
// lib/core/timeline/types.ts

type CalendarDate = string;  // 'YYYY-MM-DD', user's timezone
type Minor = number;         // integer minor units

type TimelineEventKind = 'scheduled' | 'recurring';
type Direction = 'in' | 'out';

interface TimelineEvent {
  readonly sourceId: string;
  readonly sourceKind: TimelineEventKind;
  readonly date: CalendarDate;
  readonly label: string;                     // 'Salary', 'Rent'
  readonly amountMinor: Minor;                // magnitude, always > 0
  readonly direction: Direction;
  readonly signedAmountMinor: Minor;          // + for in, − for out
  readonly projectedBalanceAfterMinor: Minor;
  readonly accountId: string;
  readonly categoryId: string | null;
  /** Set when this came from a recurring rule, for drill-through. */
  readonly recurringTransactionId: string | null;
}

interface TimelineDay {
  readonly date: CalendarDate;
  readonly events: readonly TimelineEvent[];
  readonly endOfDayBalanceMinor: Minor;
}

interface TimelineInput {
  readonly today: CalendarDate;               // injected, never the clock
  readonly horizonDays: 7 | 30 | 60 | 90;
  readonly openingBalanceMinor: Minor;        // may be negative
  readonly currency: string;
  /** Future-dated transactions ∪ deduplicated recurring occurrences. */
  readonly events: readonly Omit<
    TimelineEvent,
    'signedAmountMinor' | 'projectedBalanceAfterMinor'
  >[];
  readonly filters?: {
    readonly accountIds?: readonly string[];
    readonly categoryIds?: readonly string[];
    readonly kinds?: readonly TimelineEventKind[];
    readonly directions?: readonly Direction[];
  };
  readonly maxEvents?: number;                // default MAX_TIMELINE_EVENTS
}

interface TimelineResult {
  readonly days: readonly TimelineDay[];
  readonly openingBalanceMinor: Minor;
  readonly endingBalanceMinor: Minor;
  readonly shortfallDate: CalendarDate | null;
  readonly minProjectedBalanceMinor: Minor;
  readonly minProjectedBalanceDate: CalendarDate | null;
  readonly horizon: { readonly from: CalendarDate; readonly to: CalendarDate };
  readonly isFiltered: boolean;               // the UI must surface this
  readonly truncated: boolean;
  readonly currency: string;
}

/** Pure. No I/O, no clock, no env. */
export function buildMoneyTimeline(input: TimelineInput): TimelineResult;
```

Grouped `days` rather than a flat array because that is what the UI renders, and
because computing `endOfDayBalanceMinor` belongs with the rest of the money
math rather than in a component.

## Edge cases

| Case | Behaviour | Reasoning |
|---|---|---|
| No events in the horizon | `days: []`, `endingBalance = openingBalance`, `shortfallDate: null` | Valid and common for a new user; the UI shows an empty state, not an error |
| All income, no expenses | Monotonically rising, `shortfallDate: null` | — |
| Opening balance already negative | `shortfallDate` is the **first event's date** | The user is already overdrawn; the timeline must not hide it |
| Opening negative, first event repays it | `shortfallDate` still set at that first event | The balance *was* negative during the horizon |
| Balance crosses zero exactly to 0 | **Not** a shortfall (`< 0`, not `<= 0`) | Zero is not an overdraft |
| Multiple negative crossings | Only the **first** is reported | The one the user can still act on |
| Two events, same date, same amount, opposite direction | Income sorts first | Balance rises then falls; no phantom dip |
| Two identical events, same id | Impossible — `sourceId` is a row id | If it happens, dedupe upstream is broken |
| Event dated exactly `today` | Included | Horizon inclusive at both ends |
| Event dated exactly `today + horizonDays` | Included | Same |
| Event outside the horizon | Excluded before the fold | — |
| Own-account transfer | Excluded (both legs) | Nets to zero; noise |
| Transfer to an excluded account | **Included** as an outflow | Genuinely reduces spendable money |
| Filters match nothing | `days: []`, `isFiltered: true` | Distinguishable from "no events at all" |
| More events than `maxEvents` | Latest truncated, `truncated: true` | Near future preserved; UI discloses it |
| Recurring occurrence already paid | Dropped by shared dedupe | The rent-paid-early bug |
| Mixed currencies | **Throws** `MixedCurrencyError` | Same rule as Safe to Spend |
| `horizonDays` not in the allowed set | **Throws** `InvalidHorizonError` | Caller bug; the cap depends on a bounded set |

## Invariants for property tests

1. **Fold consistency.** For every event `i > 0`:
   `projectedBalanceAfter[i] === projectedBalanceAfter[i-1] + signedAmount[i]`.

2. **Conservation.** `endingBalanceMinor === openingBalanceMinor + Σ signedAmountMinor`
   over all included events.

3. **Order is total and stable.** Shuffling the input array produces an
   identical `days` structure. This is the anti-flake invariant.

4. **Monotonic dates.** Flattening `days` yields non-decreasing `date` values.

5. **Shortfall correctness.** `shortfallDate` is non-null **iff** some event has
   `projectedBalanceAfterMinor < 0`, and equals the date of the earliest such
   event.

6. **Minimum correctness.** `minProjectedBalanceMinor` equals the least
   `projectedBalanceAfterMinor` across all events, or `openingBalanceMinor` when
   there are none.

7. **Filter subsetting.** A filtered result's event set is a subset of the
   unfiltered one, and filtering never adds an event.

8. **Horizon boundedness.** No returned event falls outside `[from, to]`.

9. **Empty-day collapse.** No `TimelineDay` has an empty `events` array.

10. **Determinism and integrality.** Same input → same output; every amount is a
    safe integer.

11. **Agreement with Safe to Spend.** Over a month-end horizon on the same data,
    the timeline's total inflow and outflow reconcile with Safe to Spend's
    `expectedIncome` and `upcomingExpenses + debtPayments` terms. This
    cross-module invariant is what stops the dashboard contradicting itself.

## Canonical unit-test fixture

`TIMELINE_FIXTURE_SPEC_S10` — spec §10's example exactly, with `today =
2026-09-09`, `horizonDays = 30`, `openingBalanceMinor = 4_200_000` (₱42,000):

| # | Date | Label | Direction | Amount (minor) | Projected after (minor) |
|---|---|---|---|---|---|
| 1 | 2026-09-10 | Salary | `in` | `3_500_000` | `7_700_000` |
| 2 | 2026-09-12 | Rent | `out` | `1_500_000` | `6_200_000` |
| 3 | 2026-09-15 | Credit Card | `out` | `850_000` | `5_350_000` |
| 4 | 2026-09-20 | Freelance | `in` | `1_200_000` | `6_550_000` |
| 5 | 2026-09-25 | Internet | `out` | `180_000` | `6_370_000` |

```typescript
// tests/unit/timeline/spec-s10.test.ts
it('reproduces spec §10 exactly', () => {
  const r = buildMoneyTimeline(TIMELINE_FIXTURE_SPEC_S10);

  expect(r.days.map((d) => d.date)).toEqual([
    '2026-09-10', '2026-09-12', '2026-09-15', '2026-09-20', '2026-09-25',
  ]);
  expect(flatten(r.days).map((e) => e.projectedBalanceAfterMinor)).toEqual([
    7_700_000, 6_200_000, 5_350_000, 6_550_000, 6_370_000,
  ]);
  expect(r.endingBalanceMinor).toBe(6_370_000);   // ₱63,700
  expect(r.shortfallDate).toBeNull();
  expect(r.minProjectedBalanceMinor).toBe(5_350_000);
  expect(r.truncated).toBe(false);
});
```

### Required companion fixtures

| Fixture | Asserts |
|---|---|
| `TIMELINE_FIXTURE_EMPTY` | No events: empty days, ending = opening, no shortfall |
| `TIMELINE_FIXTURE_SHORTFALL` | Rent exceeds balance before payday: `shortfallDate` is the rent date |
| `TIMELINE_FIXTURE_OPENING_NEGATIVE` | Already overdrawn: shortfall at the first event |
| `TIMELINE_FIXTURE_EXACT_ZERO` | Balance hits exactly 0: **not** a shortfall |
| `TIMELINE_FIXTURE_SAME_DAY_TIE` | Salary and rent on one date: income sorts first, no phantom dip |
| `TIMELINE_FIXTURE_SHUFFLED` | Input in reverse order yields byte-identical output |
| `TIMELINE_FIXTURE_ALL_INCOME` | Monotonic rise, no shortfall |
| `TIMELINE_FIXTURE_PAID_EARLY` | Rent paid the 9th for a rule dated the 12th: appears **once** |
| `TIMELINE_FIXTURE_TRANSFER` | Own-account transfer produces no events |
| `TIMELINE_FIXTURE_TRANSFER_TO_EXCLUDED` | Transfer into excluded savings **does** appear as an outflow |
| `TIMELINE_FIXTURE_FILTERED_EMPTY` | Filters matching nothing: `isFiltered: true`, empty days |
| `TIMELINE_FIXTURE_TRUNCATED` | Over the cap: latest dropped, `truncated: true` |
| `TIMELINE_FIXTURE_MULTI_CROSSING` | Two negative crossings: only the first reported |
| `TIMELINE_FIXTURE_HORIZON_BOUNDARY` | Events on `today` and on `today + N` both included |

Coverage floor for `lib/core/timeline/**` is **95%**, matching Safe to Spend —
both are named differentiators, and both are money math.
