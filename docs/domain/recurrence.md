# Recurrence

**One sentence:** `expandOccurrences` turns a recurring rule into the list of
**calendar dates** it fires on inside a half-open window, using the rule's
original anchor day for every step so a month-end rule clamps without drifting,
and `dedupeMaterialized` removes the occurrences a user has already recorded as
real transactions so no bill is ever counted twice.

Recurring transactions are spec §15 (a V2 feature), but this module is spec'd
now and built early because [safe-to-spend.md](safe-to-spend.md) and
[money-timeline.md](money-timeline.md) — both **MVP** differentiators — need
the dedupe contract and the calendar-date discipline the moment they handle a
future-dated transaction. The recurrence *engine* can ship in V2; the *rules on
this page* cannot wait, because getting them wrong later means rewriting both
MVP features.

Related: [money-timeline.md](money-timeline.md),
[safe-to-spend.md](safe-to-spend.md),
[goal-projection.md](goal-projection.md),
[../architecture/source-structure.md](../architecture/source-structure.md#why-libcore-is-quarantined)
for why no date library is permitted here, and
[../../tasks/backlog/m8-money-timeline.md](../../tasks/backlog/m8-money-timeline.md)
for the MVP slice.

## The timezone rule

> [!IMPORTANT]
> **All recurrence math operates on calendar dates in the user's timezone. Never
> on UTC instants. Never on a JavaScript `Date`.**

This is the single most common bug class in budgeting applications, and it is
worth spending a screen on because every other rule on this page assumes it.

A `Date` in JavaScript is an instant — a count of milliseconds since the epoch.
"The 15th of September" is not an instant; it is a *label on a day*, and which
instant it corresponds to depends on where the user is. Mix the two and bills
move.

### How a UTC instant produces an off-by-one-day bill

A user in Manila (`Asia/Manila`, UTC+08:00, no DST) has rent due on the 15th.
The rule is stored, someone writes `new Date('2026-09-15')`, and JavaScript
parses a bare date string **as UTC midnight**:

```text
Stored intent:      2026-09-15  (a calendar date in Asia/Manila)

new Date('2026-09-15')
  -> 2026-09-15T00:00:00Z          the instant
  -> in Asia/Manila, that is       2026-09-15 08:00  ✓ looks fine

.getDate()   on a server in UTC     -> 15   ✓
.getDate()   on a server in UTC-05  -> 14   ✗   rent moved to the 14th
.toISOString().slice(0,10)          -> '2026-09-15'  ✓ by luck

Now the reverse direction. The user opens the app at 09:00 Manila time on
the 15th and the server does `new Date()` to get "today":

  instant                            2026-09-15T01:00:00Z
  .getDate() on a UTC server      -> 15   ✓
  but at 07:00 Manila:
  instant                            2026-09-14T23:00:00Z
  .getDate() on a UTC server      -> 14   ✗   "today" is yesterday

Consequences the user actually sees:
  - Rent appears twice in the timeline (14th and 15th) across a deploy
    that changed the server region.
  - Safe to Spend jumps by ₱15,000 at 08:00 every morning as the UTC
    date rolls over mid-morning Manila time.
  - A bill due today is excluded from [today, H] because today is
    computed as yesterday.
  - A yearly rule anchored Dec 31 fires on Dec 30 for users west of UTC.
```

None of these are hypothetical; they are the classic failure mode, and they
are invisible in local development where the developer's machine and the user
are in the same timezone.

### The rule, precisely

- `lib/core` never constructs, receives, or returns a `Date`. Not once.
- Dates are a **`CalendarDate`** value: an explicit `{ year, month, day }`
  triple with no time and no zone, or its ISO-8601 date string form
  `YYYY-MM-DD` at persistence and serialization boundaries.
- The **conversion happens exactly once**, at the server edge: `lib/server`
  resolves "now" into the user's calendar date using `profiles.timezone`
  (spec §4.1, §22 — seeded `Asia/Manila`) and passes that in as `today`.
- Postgres stores `date` for `transactions.date`, `start_date`, `end_date`, and
  `next_date` — **not** `timestamptz`. A `date` column has no zone to get
  wrong. `created_at` / `updated_at` stay `timestamptz`, because those *are*
  instants and nobody does arithmetic on them.
- **DST is therefore irrelevant to this module**, which is the point. Calendar
  dates have no 23-hour or 25-hour days. `Asia/Manila` has no DST anyway, but
  a user in `Europe/Berlin` or `America/Santiago` must be equally safe, and
  they are — because there is no clock arithmetic to skew.

This is also the reason
[source-structure.md](../architecture/source-structure.md#why-libcore-is-quarantined)
bans date libraries from `lib/core` outright. Nearly every one of them is
instant-based at the core, and having one in scope means somebody eventually
calls `addMonths(new Date(...), 1)` and reintroduces the whole class.

### `CalendarDate`

```typescript
/** A calendar date. No time, no timezone. `month` is 1-12. */
export interface CalendarDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;   // 1-31, must be valid for (year, month)
}

export type IsoDate = string; // 'YYYY-MM-DD'

export function toIso(d: CalendarDate): IsoDate;
export function fromIso(s: IsoDate): CalendarDate;      // throws on invalid
export function compareDates(a: CalendarDate, b: CalendarDate): -1 | 0 | 1;
export function addDays(d: CalendarDate, n: number): CalendarDate;
export function daysBetween(a: CalendarDate, b: CalendarDate): number; // b - a
export function daysInMonth(year: number, month: number): number;
export function isLeapYear(year: number): boolean;
export function endOfMonth(d: CalendarDate): CalendarDate;
```

`compareDates` on the ISO string form is lexicographically identical to
chronological order, which is why `YYYY-MM-DD` is the wire format and why
sorting in [money-timeline.md](money-timeline.md) is cheap and exact.

## Frequencies

Five, exactly as spec §15 lists them. No `RRULE`, no custom intervals, no
"every 3rd Tuesday" in the MVP or V2 — the field is a closed enum so the test
matrix stays exhaustible.

| `frequency` | Step | Anchor | Notes |
|---|---|---|---|
| `weekly` | +7 days | `start_date` | Same weekday forever; no clamping possible |
| `biweekly` | +14 days | `start_date` | **Anchored on `start_date`**, see below |
| `monthly` | +1 month | `start_date`'s day-of-month | Clamps at month end |
| `quarterly` | +3 months | `start_date`'s day-of-month | Clamps at month end |
| `yearly` | +1 year | `start_date`'s month + day | Clamps only for Feb 29 |

### Biweekly is anchored, not "every other calendar week"

`biweekly` means **`start_date + 14k` days** for integer `k ≥ 0`. It does *not*
mean "the same weekday in even-numbered ISO weeks", and the difference is
visible about once a year.

```text
start_date = 2026-01-02 (Friday)

Anchored (correct):     Jan 2, Jan 16, Jan 30, Feb 13, Feb 27, Mar 13, ...
                        strictly every 14 days, forever

"Even ISO weeks" :      Jan 2 (W01), Jan 16 (W03), Jan 30 (W05), ...
                        identical until a 53-week ISO year, then a
                        14-day gap silently becomes 7 or 21 days
```

Anchoring also makes the function trivially testable and closed-form:
`occurrence(k) = addDays(start_date, 14 * k)`, so the first occurrence at or
after `from` is computable directly rather than by iteration — see
[Algorithm](#algorithm).

A user paid every second Friday is paid every 14 days. That is what they mean,
and it is what the payroll system does.

## Month-end clamping with anchor preservation

The hard case, and the one that separates a correct implementation from a
plausible one.

**Two rules, both required:**

1. **Clamp, never roll forward.** A monthly rule on the 31st, in a month with
   fewer days, fires on the **last day of that month** — not on the 1st or 3rd
   of the following month. Rent due "the 31st" in February is due February 28,
   because the user's landlord wants it in February.
2. **Preserve the anchor.** The clamped date is *not* the new anchor. Each
   occurrence is computed from the rule's **original** day-of-month, so the
   sequence returns to 31 whenever the month allows.

Rule 2 is what naive implementations get wrong. Repeatedly calling
`addOneMonth(previousOccurrence)` clamps once and then stays clamped — a
"pay on the 31st" rule silently becomes "pay on the 28th" for the rest of the
user's life.

```text
WRONG — iterate from the previous occurrence:
  Jan 31 -> Feb 28 -> Mar 28 -> Apr 28 -> May 28 ...
                       ^^^^^^ the anchor was lost in February

RIGHT — compute from the anchor day (31) every time:
  Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31 -> Jun 30 -> Jul 31 ...
```

Formally, for `monthly` with anchor day `A` from `start_date`:

```text
occurrence(k):
  (y, m) = advanceMonths(start.year, start.month, k)
  day    = min(A, daysInMonth(y, m))
  -> { year: y, month: m, day }
```

`A` never changes. `k` indexes months, not occurrences-since-the-last-one, so
there is no state to carry and no drift to accumulate. The same closed form
covers `quarterly` (`advanceMonths(..., 3k)`) and `yearly`
(`advanceMonths(..., 12k)`, where clamping only ever bites on Feb 29).

### Worked table — anchor day 31, monthly, from 2026-01-31

| `k` | Target month | Days in month | `min(31, days)` | Occurrence | Clamped? |
|---|---|---|---|---|---|
| 0 | 2026-01 | 31 | 31 | **2026-01-31** | — |
| 1 | 2026-02 | 28 | 28 | **2026-02-28** | yes |
| 2 | 2026-03 | 31 | 31 | **2026-03-31** | — |
| 3 | 2026-04 | 30 | 30 | **2026-04-30** | yes |
| 4 | 2026-05 | 31 | 31 | **2026-05-31** | — |
| 5 | 2026-06 | 30 | 30 | **2026-06-30** | yes |
| 6 | 2026-07 | 31 | 31 | **2026-07-31** | — |
| 7 | 2026-08 | 31 | 31 | **2026-08-31** | — |
| 8 | 2026-09 | 30 | 30 | **2026-09-30** | yes |
| 9 | 2026-10 | 31 | 31 | **2026-10-31** | — |
| 10 | 2026-11 | 30 | 30 | **2026-11-30** | yes |
| 11 | 2026-12 | 31 | 31 | **2026-12-31** | — |
| 12 | 2027-01 | 31 | 31 | **2027-01-31** | — |
| 13 | 2027-02 | 28 | 28 | **2027-02-28** | yes |

Note rows 2, 4, 6 — the anchor comes back every time. And note that the
sequence is **not** monotone in day-of-month, which is the property that breaks
any implementation storing `next_date` as the sole source of truth.

### Anchor day 29, monthly, across a leap boundary

| `k` | Month | Days | Occurrence | Note |
|---|---|---|---|---|
| 0 | 2027-12 | 31 | 2027-12-29 | — |
| 1 | 2028-01 | 31 | 2028-01-29 | — |
| 2 | 2028-02 | **29** | **2028-02-29** | Leap year — no clamp needed |
| 3 | 2028-03 | 31 | 2028-03-29 | — |
| 14 | 2029-02 | **28** | **2029-02-28** | Non-leap — clamps |
| 15 | 2029-03 | 31 | 2029-03-29 | Anchor restored |

### Anchor Feb 29, yearly

| `k` | Year | Feb days | Occurrence |
|---|---|---|---|
| 0 | 2028 | 29 | **2028-02-29** |
| 1 | 2029 | 28 | **2029-02-28** |
| 2 | 2030 | 28 | **2030-02-28** |
| 3 | 2031 | 28 | **2031-02-28** |
| 4 | 2032 | 29 | **2032-02-29** |

Four consecutive clamps and then the anchor returns. An implementation that
mutated the anchor would have permanently moved an annual insurance premium to
the 28th after one non-leap year.

### The `next_date` field is a cache, not the truth

Spec §22 gives `recurring_transactions` a `next_date` column. Treat it as a
**denormalized cache for cheap querying** ("which rules fire in the next 7
days?"), never as the sequence state:

- The truth is `(start_date, frequency)`. Occurrence `k` is a pure function of
  those two plus `k`.
- `next_date` is recomputed as `firstOccurrenceOnOrAfter(rule, today)` whenever
  it is read for scheduling, and may be stale without causing wrong output.
- **Never advance `next_date` by mutating it.** That is the anchor-loss bug in
  database form, and it is worse there because it is *persisted* — the anchor
  is gone and cannot be recovered.

A migration comment should say this on the column, because the column name
invites exactly the wrong implementation.

## The window: inclusivity, stated explicitly

`expandOccurrences(rule, from, to)` returns occurrences in
**`[from, to]` — inclusive on both ends.**

Both ends inclusive, rather than the half-open `[from, to)` that is usually the
better default, because both callers want it:

- **Safe to Spend** computes over `[today, H]` where `H` is the last day of the
  month. A bill due on the 30th of a 30-day month must be counted. With a
  half-open window, `H` would have to be "the 1st of next month", and every
  reader of the code would have to hold that in their head.
- **The timeline** shows "the next 30 days" as a span the user can see
  endpoints of. Silently dropping the last day is a bug report.

The consequences are documented rather than hidden:

| Boundary | Behaviour |
|---|---|
| Occurrence exactly on `from` | **Included** |
| Occurrence exactly on `to` | **Included** |
| `from > to` | Returns `[]`. Not an error — an empty horizon is a legal query |
| `from === to` | Single-day window; returns the occurrence on that day if any |
| Occurrence before `start_date` | Never generated, even if inside the window |
| Occurrence after `end_date` | Never generated. `end_date` is **inclusive** |
| `is_active === false` | Returns `[]` regardless of window |

Adjacent windows therefore **overlap on their shared endpoint**. Any caller
stitching windows together must exclude one side itself; the timeline does this
in its day-grouping fold, and the fact is called out here so it is not
rediscovered as a duplicate-event bug.

## Algorithm

```text
expandOccurrences(rule, from, to) -> CalendarDate[]

 0. If !rule.isActive            -> []
    If from > to                 -> []

 1. Effective window:
      lo = max(from, rule.startDate)
      hi = min(to,   rule.endDate ?? +infinity)
    If lo > hi                   -> []

 2. Find the first index k0 such that occurrence(k0) >= lo, in CLOSED FORM
    (never by looping from k = 0 — a weekly rule started in 2015 would
    iterate hundreds of times per render):

      weekly    k0 = max(0, ceil(daysBetween(start, lo) / 7))
      biweekly  k0 = max(0, ceil(daysBetween(start, lo) / 14))
      monthly   k0 = max(0, monthsBetween(start, lo));   then adjust +-1
      quarterly k0 = max(0, floor(monthsBetween(start, lo) / 3)); adjust +-1
      yearly    k0 = max(0, lo.year - start.year);       then adjust +-1

    The "+-1 adjust" is a bounded correction (at most one step in either
    direction) needed because clamping means occurrence(k) is monotone
    non-decreasing but not strictly aligned to month arithmetic. Correct by
    stepping while occurrence(k) < lo, then while occurrence(k-1) >= lo.
    Bounded, so it is O(1), not a search.

 3. Emit occurrence(k0), occurrence(k0+1), ... while <= hi.

 4. Cap at MAX_OCCURRENCES (see below). If the cap is hit, return the
    truncated list AND set `truncated: true` on the result.
```

Step 2's closed form is not premature optimization. `system-architecture.md`
names timeline recurrence expansion as the **second thing that breaks** under
load; a naive `while (d < from) d = next(d)` over a rule with a 2015 start date
and a 90-day window is O(years), executed per rule, per dashboard render.

### The occurrence cap

```typescript
/** Hard ceiling per rule per expansion. Weekly over 90 days is 13. */
export const MAX_OCCURRENCES_PER_RULE = 400;
```

Why a cap at all: `expandOccurrences` is reachable from a user-controlled
horizon, and a rule with a far-future `end_date` expanded over a
mis-parameterized window is an unbounded allocation in a serverless function.
400 comfortably exceeds any legitimate use (weekly over a 90-day horizon is 13;
weekly over a year is 53) while making the pathological case a bounded,
observable event rather than a timeout.

## Function contract

```typescript
// lib/core/recurrence/index.ts

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurrenceRule {
  readonly id: string;
  readonly frequency: Frequency;
  /** Anchor. Its day-of-month (or month+day) is preserved for all steps. */
  readonly startDate: CalendarDate;
  /** Inclusive last date the rule may fire. `null` = open-ended. */
  readonly endDate: CalendarDate | null;
  readonly isActive: boolean;
}

export interface ExpansionResult {
  readonly occurrences: readonly CalendarDate[];
  /** True when MAX_OCCURRENCES_PER_RULE truncated the list. */
  readonly truncated: boolean;
}

/**
 * All dates on which `rule` fires within [from, to], both ends INCLUSIVE.
 * Pure. Ascending. No duplicates. Never allocates more than
 * MAX_OCCURRENCES_PER_RULE entries.
 */
export function expandOccurrences(
  rule: RecurrenceRule,
  from: CalendarDate,
  to: CalendarDate,
): readonly CalendarDate[];

/** Same, carrying the truncation flag for callers that surface it. */
export function expandOccurrencesDetailed(
  rule: RecurrenceRule,
  from: CalendarDate,
  to: CalendarDate,
): ExpansionResult;

/** The k-th occurrence (k >= 0), ignoring endDate and isActive. */
export function occurrenceAt(rule: RecurrenceRule, k: number): CalendarDate;

/** First occurrence on or after `date`, or null if endDate precedes it. */
export function firstOccurrenceOnOrAfter(
  rule: RecurrenceRule,
  date: CalendarDate,
): CalendarDate | null;

/** The period key an occurrence belongs to. See "Period keys" below. */
export function periodKeyFor(rule: RecurrenceRule, occurrence: CalendarDate): PeriodKey;
```

Note that `expandOccurrences` returns **dates only**, not materialized
transactions. Turning a date into a projected `TimelineEvent` (label, signed
amount, account, category) is the caller's job — the timeline's, in
[money-timeline.md](money-timeline.md) — because the amount and label live on
the rule row, not in the calendar math, and keeping them out makes the
recurrence tests pure date tests.

## Deduplication

The contract shared with [safe-to-spend.md](safe-to-spend.md) and
[money-timeline.md](money-timeline.md). It lives in `lib/core/recurrence/`
rather than in either caller precisely because both need identical behaviour:
if Safe to Spend and the timeline disagree about whether a bill has been paid,
the user sees two different numbers for the same fact, and neither is
trustworthy after that.

### The problem

A recurring rule says rent is due the 12th, ₱15,000. On the 9th the user pays
it early and records an actual transaction. Now:

- The rule still projects an occurrence on the 12th.
- The actual transaction on the 9th already reduced the account balance.

Counting both makes `UpcomingExpenses` ₱15,000 too high, understating Safe to
Spend by a full rent payment, and the timeline shows rent twice. The user's
reaction is not "interesting rounding issue"; it is "this app is broken".

### The rule

**Match on `recurring_transaction_id` + period key.** One materialized actual
for a `(rule, period)` pair suppresses the projected occurrence for that same
pair — regardless of the actual's date, amount, or account.

```text
For each projected occurrence o of rule R:
  key = (R.id, periodKeyFor(R, o))
  if any actual A exists with A.recurringTransactionId === R.id
     and periodKeyFor(R, A.date) === periodKeyFor(R, o)
  then DROP o
  else KEEP o
```

Date-proximity matching (`|actual.date − occurrence| <= 3 days`) was considered
and rejected: it fails for a bill paid a week early, double-fires when two
occurrences fall inside the tolerance, and its threshold is unjustifiable. The
explicit foreign key is unambiguous, and it is the reason
`transactions.recurring_transaction_id` is a required data-model addition
(nullable, `references recurring_transactions(id) on delete set null`).

Amount is deliberately **not** matched. A ₱15,200 rent payment against a
₱15,000 rule is the same rent — the landlord raised it. Requiring an exact
amount match would resurrect the projected occurrence and double-count.

### Period keys

The period key is what makes "the same bill" well defined. It is derived from
the rule's frequency so that exactly one occurrence maps to each key.

| Frequency | Period key | Example | Rationale |
|---|---|---|---|
| `monthly` | `YYYY-MM` | `2026-09` | One occurrence per calendar month, always |
| `quarterly` | `YYYY-Qn` from the **anchor** month | `2026-Q3` | Quarters offset from `start_date`, not calendar Q1 |
| `yearly` | `YYYY` from the **anchor** month | `2026` | Anniversary year, so a Nov anchor's year runs Nov→Oct |
| `weekly` | `occurrenceIndex` (`k`) | `k=118` | Weeks have no natural calendar key; ISO weeks disagree with a Sunday anchor |
| `biweekly` | `occurrenceIndex` (`k`) | `k=59` | Same, and 14-day periods never align to a month |

For `weekly` and `biweekly` the key is the **occurrence index derived from the
actual's date**: `k = floor(daysBetween(startDate, actual.date) / step)`. So an
actual recorded up to 6 (or 13) days after the occurrence still maps to that
occurrence's period, and one recorded before it maps to the previous period —
which is the correct answer for "paid early", since the projection for the
*next* period should survive.

```typescript
export type PeriodKey = string; // '2026-09' | '2026-Q3' | '2026' | 'k=118'

export interface MaterializedActual {
  readonly id: string;
  readonly recurringTransactionId: string | null;
  readonly date: CalendarDate;
  readonly amountMinor: number;
}

export interface ProjectedOccurrence {
  readonly ruleId: string;
  readonly date: CalendarDate;
}

export interface DedupeResult<T extends ProjectedOccurrence> {
  /** Occurrences with no matching actual — these are still upcoming. */
  readonly remaining: readonly T[];
  /** Occurrences suppressed, with the actual that suppressed each. */
  readonly suppressed: readonly {
    readonly occurrence: T;
    readonly byActualId: string;
    readonly periodKey: PeriodKey;
  }[];
}

/**
 * Remove projected occurrences already recorded as real transactions.
 * Pure. Order-independent in `actuals`. Preserves `occurrences` order in
 * `remaining`.
 */
export function dedupeMaterialized<T extends ProjectedOccurrence>(
  occurrences: readonly T[],
  actuals: readonly MaterializedActual[],
  rules: readonly RecurrenceRule[],
): DedupeResult<T>;
```

The `suppressed` half of the result is not diagnostic padding. Safe to Spend's
breakdown must be able to say "rent is not in Upcoming Expenses because you
already paid it on the 9th" — see
[safe-to-spend.md](safe-to-spend.md#function-contract), where explaining the
number is a stated UX requirement (spec §9).

`rules` is passed in because `periodKeyFor` needs each rule's frequency and
anchor to key an actual's date. Callers already have the rules loaded.

### Multiple actuals for one period

If two actuals map to the same `(ruleId, periodKey)` — the user recorded rent
twice — the occurrence is suppressed **once** (it can only be suppressed once)
and the *first actual by `(date, id)`* is reported as the suppressor.
`dedupeMaterialized` does **not** try to detect or repair the duplicate: that
is a data-quality concern for V2's duplicate detection, and silently hiding one
of the user's own transactions would be worse than showing both.

## Edge cases

| Case | Behaviour | Why |
|---|---|---|
| `isActive === false` | `[]` | Paused rules project nothing; the row is kept for history |
| `from > to` | `[]` | Empty horizon is a legal query, not an error |
| `from === to`, occurrence that day | `[that date]` | Both ends inclusive |
| `startDate` after `to` | `[]` | Rule has not begun inside the window |
| `endDate` before `from` | `[]` | Rule already finished |
| `endDate` exactly on an occurrence | **Included** | `end_date` is inclusive |
| `endDate` one day before an occurrence | Excluded | — |
| `startDate` inside the window | First occurrence is `startDate` itself | `k = 0` |
| `startDate` before the window | Closed-form `k0`, no iteration from `k=0` | Performance; see [Algorithm](#algorithm) |
| Monthly, anchor 31, February | 28 (or 29 in a leap year) | Clamp, never roll into March |
| Monthly, anchor 31, month after February | **31**, not 28 | Anchor preservation |
| Monthly, anchor 30, February | 28 / 29 | Same clamp |
| Monthly, anchor 29, leap February | **29** — no clamp | `daysInMonth(2028, 2) === 29` |
| Monthly, anchor 29, non-leap February | 28 | Clamp |
| Yearly, anchor Feb 29, non-leap year | Feb 28 | Clamp; anchor still 29 for the next leap year |
| Yearly, anchor Dec 31 | Dec 31 every year | No clamping needed; December always has 31 |
| Quarterly, anchor Nov 30 | Nov 30 → Feb 28 → May 30 → Aug 30 → Nov 30 | Clamp in Feb only, anchor preserved |
| Weekly across a DST transition | Exactly +7 calendar days | No clock arithmetic exists to skew — [the timezone rule](#the-timezone-rule) |
| Weekly across a year boundary | +7 days, ignores ISO week numbering | Anchored, not week-numbered |
| Biweekly in a 53-ISO-week year | Still exactly +14 days | Anchored, not week-numbered |
| Horizon spanning >400 occurrences | Truncated at `MAX_OCCURRENCES_PER_RULE`, `truncated: true` | Bounded allocation |
| `startDate` day 29/30/31 with `frequency: 'weekly'` | Day-of-month is irrelevant; +7 days | Only month-stepping frequencies clamp |
| Actual with `recurringTransactionId === null` | Never suppresses anything | Only an explicit link dedupes |
| Actual linked to a rule not in `rules` | Ignored, no throw | A deleted rule's orphaned actual must not crash a dashboard |
| Actual dated outside the window | **Still suppresses** if its period key matches | A bill paid on the 9th suppresses the 12th's occurrence even when the window starts on the 10th |
| Two actuals, same period | Occurrence suppressed once; first by `(date, id)` reported | Deterministic; no silent repair |
| Actual for period `k`, occurrence for `k+1` | `k+1` **survives** | Paying this fortnight does not pay the next one |
| Occurrence list empty | `{ remaining: [], suppressed: [] }` | Identity |
| Actuals list empty | `{ remaining: occurrences, suppressed: [] }` | Identity — MVP's normal case |
| Invalid `CalendarDate` (`2026-02-30`) | `fromIso` throws | Validated at the `lib/validation` edge; core assumes well-formed |

## Invariants for property tests

Over generated rules (all five frequencies, anchors 1–31, start dates spanning
2020–2035 including every leap year) and generated windows.

| # | Invariant | Statement |
|---|---|---|
| **R1** | Ascending | `expandOccurrences` output is strictly increasing by `compareDates` |
| **R2** | No duplicates | consecutive outputs are never equal |
| **R3** | In window | every output `d` satisfies `from ≤ d ≤ to` |
| **R4** | In rule bounds | every output satisfies `startDate ≤ d` and (`endDate === null ∨ d ≤ endDate`) |
| **R5** | Window monotonicity | widening the window never removes an occurrence: `[f2,t2] ⊇ [f1,t1] ⇒ expand(f1,t1) ⊆ expand(f2,t2)` |
| **R6** | Window additivity | `expand(a,b) ∪ expand(addDays(b,1),c) === expand(a,c)`, disjointly |
| **R7** | Closed form agrees with iteration | `expandOccurrences` equals a naive `k = 0, 1, 2, …` filter, for windows small enough to brute-force |
| **R8** | Anchor preservation | for month-stepping rules, if `daysInMonth(occ) ≥ anchorDay` then `occ.day === anchorDay` |
| **R9** | Clamp bound | `occ.day === min(anchorDay, daysInMonth(occ.year, occ.month))` |
| **R10** | Month coverage | a `monthly` rule active all window yields exactly one occurrence per calendar month in the window's interior |
| **R11** | Fixed step | `weekly`/`biweekly` consecutive outputs differ by exactly 7 / 14 days |
| **R12** | Determinism | identical inputs yield identical output arrays, run to run and process to process |
| **R13** | Timezone independence | output is bit-identical under any `process.env.TZ` — the regression test for [the timezone rule](#the-timezone-rule) |
| **R14** | Inactive is empty | `!isActive ⇒ []` for every window |
| **R15** | `occurrenceAt` monotone | `k1 < k2 ⇒ occurrenceAt(k1) ≤ occurrenceAt(k2)` (non-strict: clamping can tie? no — see note) |
| **R16** | `firstOccurrenceOnOrAfter` consistency | it equals `expandOccurrences(rule, d, farFuture)[0] ?? null` |
| **R17** | Dedupe partition | `remaining.length + suppressed.length === occurrences.length`, and the two sets are disjoint |
| **R18** | Dedupe subset | `remaining ⊆ occurrences`, order preserved |
| **R19** | Dedupe idempotent | `dedupe(dedupe(o, a).remaining, a).remaining === dedupe(o, a).remaining` |
| **R20** | Dedupe order-independent | shuffling `actuals` does not change `remaining` |
| **R21** | Dedupe needs a link | actuals with `recurringTransactionId === null` never change the result |
| **R22** | Period key injectivity | for a fixed rule, distinct occurrences map to distinct period keys |
| **R23** | Period key stability | `periodKeyFor(rule, occ)` does not depend on the window it was expanded with |

R13 runs the whole suite twice under different `TZ` values in CI. It is cheap
and it is the only test that would have caught every historical variant of the
timezone bug.

R15's note: `occurrenceAt` is **strictly** increasing for all five frequencies.
Clamping cannot produce a tie because consecutive month-steps land in different
months, and the key includes the month.

## Canonical unit-test fixtures

`tests/unit/core/recurrence.test.ts`. The tables in this document are the
fixtures — transcribe them literally.

### `RECURRENCE_FIXTURE_MONTHEND_ANCHOR_31`

The [worked table](#worked-table--anchor-day-31-monthly-from-2026-01-31) above,
as an `it.each`. This is the headline fixture; a regression here is a
user-visible wrong bill date.

```typescript
{
  rule: {
    id: 'rule-rent',
    frequency: 'monthly',
    startDate: { year: 2026, month: 1, day: 31 },
    endDate: null,
    isActive: true,
  },
  from: { year: 2026, month: 1, day: 1 },
  to:   { year: 2027, month: 2, day: 28 },
  expectedIso: [
    '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31',
    '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
    '2027-01-31', '2027-02-28',
  ],
}
```

The assertion that matters most is `expectedIso[2] === '2026-03-31'` — the
anchor-preservation case. Name that `it` explicitly: *"returns to the 31st in
March, not 28th"*.

### `RECURRENCE_FIXTURE_LEAP_FEB_29`

Anchor `2028-02-29`, `yearly`, window `2028-01-01 … 2032-12-31`:

```typescript
expectedIso: ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']
```

### `RECURRENCE_FIXTURE_BIWEEKLY_ANCHORED`

Anchor `2026-01-02` (Friday), `biweekly`, window `2026-01-01 … 2026-04-01`:

```typescript
expectedIso: [
  '2026-01-02', '2026-01-16', '2026-01-30',
  '2026-02-13', '2026-02-27', '2026-03-13', '2026-03-27',
]
```

Every consecutive gap is exactly 14 days — assert that directly, not just the
list, so the intent survives a fixture edit.

### `RECURRENCE_FIXTURE_WEEKLY_DST`

Anchor `2026-03-01`, `weekly`, window `2026-03-01 … 2026-04-05`. Run under
`TZ=Europe/Berlin` (spring-forward 2026-03-29), `TZ=America/Santiago`
(fall-back 2026-04-04), `TZ=Asia/Manila` (no DST), and `TZ=UTC`. All four must
produce byte-identical output:

```typescript
expectedIso: [
  '2026-03-01', '2026-03-08', '2026-03-15',
  '2026-03-22', '2026-03-29', '2026-04-05',
]
```

`2026-03-29` is the spring-forward date in Berlin and `2026-04-05` is the
window's inclusive end — two boundary conditions in one fixture.

### `RECURRENCE_FIXTURE_END_DATE_INCLUSIVE`

`monthly`, anchor `2026-01-15`, `endDate: 2026-03-15`, window
`2026-01-01 … 2026-12-31`:

```typescript
expectedIso: ['2026-01-15', '2026-02-15', '2026-03-15']  // endDate included
```

And the mirror case with `endDate: 2026-03-14`, which must yield only January
and February.

### `RECURRENCE_FIXTURE_INACTIVE`

Same rule with `isActive: false` over a wide window: `[]`.

### `RECURRENCE_FIXTURE_DEDUPE_RENT_PAID_EARLY`

The canonical dedupe case, shared verbatim with
[safe-to-spend.md](safe-to-spend.md#canonical-unit-test-fixture) and
[money-timeline.md](money-timeline.md#canonical-unit-test-fixture).

```typescript
{
  today: { year: 2026, month: 9, day: 10 },
  rule: {
    id: 'rule-rent',
    frequency: 'monthly',
    startDate: { year: 2025, month: 1, day: 12 },
    endDate: null,
    isActive: true,
  },
  occurrences: [{ ruleId: 'rule-rent', date: { year: 2026, month: 9, day: 12 } }],
  actuals: [{
    id: 'txn-early-rent',
    recurringTransactionId: 'rule-rent',
    date: { year: 2026, month: 9, day: 9 },   // paid 3 days early
    amountMinor: 1_500_000,
  }],
  expected: {
    remaining: [],
    suppressed: [{
      occurrence: { ruleId: 'rule-rent', date: { year: 2026, month: 9, day: 12 } },
      byActualId: 'txn-early-rent',
      periodKey: '2026-09',
    }],
  },
}
```

Plus three variants that must **not** suppress:

| Variant | Expectation |
|---|---|
| Actual dated `2026-08-09` (previous period) | September's occurrence **survives** |
| Actual with `recurringTransactionId: null` | Occurrence **survives** |
| Actual amount `1_520_000` (landlord raised rent), same period | Occurrence **suppressed** — amount is not matched |

### `RECURRENCE_FIXTURE_TRUNCATION`

`weekly`, anchor `2020-01-01`, `endDate: null`, window
`2020-01-01 … 2035-01-01` (≈783 occurrences). Expect exactly
`MAX_OCCURRENCES_PER_RULE` entries and `truncated: true`.
