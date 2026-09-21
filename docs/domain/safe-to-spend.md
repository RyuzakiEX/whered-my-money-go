# Safe to Spend

**Shape in one sentence:** one number answering "how much can I spend today
without breaking a commitment I have already made", computed as current
spendable balance plus expected income minus everything already promised to
bills, savings, and debt within the current period — returned with a per-term
breakdown, because a number the user cannot interrogate is a number they will
not trust.

This is the product's headline differentiator (spec §9, spec §29). Spec §9
gives the identity and a worked example; it deliberately leaves the terms
loose. **Pinning them down is this document's job.** Every ambiguity below is
resolved here so that [M7](../../tasks/backlog/m7-safe-to-spend.md) is
implementable without inventing product decisions.

Related: [money-timeline.md](money-timeline.md) (shares the dedupe module),
[goal-projection.md](goal-projection.md) (defines `PlannedSavings`),
[recurrence.md](recurrence.md) (expands the occurrences),
[money-and-rounding.md](money-and-rounding.md) (the arithmetic rules),
[../architecture/data-model.md](../architecture/data-model.md) (the columns this
needs), [../architecture/state-and-caching.md](../architecture/state-and-caching.md)
(when the number is recomputed).

## Contents

- [The identity](#the-identity)
- [Horizon](#horizon)
- [CurrentBalance](#currentbalance)
- [ExpectedIncome](#expectedincome)
- [UpcomingExpenses](#upcomingexpenses)
- [PlannedSavings](#plannedsavings)
- [DebtPayments](#debtpayments)
- [The MVP degradation path](#the-mvp-degradation-path)
- [Status bands](#status-bands)
- [Function contract](#function-contract)
- [Edge cases](#edge-cases)
- [Invariants for property tests](#invariants-for-property-tests)
- [Canonical unit-test fixture](#canonical-unit-test-fixture)

## The identity

Spec §9, verbatim:

```text
Current Balance
+ Expected Income
- Upcoming Expenses
- Planned Savings
- Debt Payments
----------------
Safe to Spend
```

As an expression over integer minor units:

```text
safeToSpendMinor =
    currentBalanceMinor
  + expectedIncomeMinor
  - upcomingExpensesMinor
  - plannedSavingsMinor
  - debtPaymentsMinor
```

Every term is a **non-negative** magnitude except `currentBalanceMinor`, which
may be negative (an overdrawn account, a net-negative position). The signs live
in the formula, not in the values — the same rule the schema follows, where
`amount_minor` is always positive and `transaction_type` carries the direction.
See [money-and-rounding.md](money-and-rounding.md#sign-conventions).

> [!IMPORTANT]
> There is no rounding anywhere in this computation. Every input is already an
> integer minor unit and addition is exact. `PlannedSavings` is the only term
> whose *derivation* divides, and that rounding happens inside
> [goal-projection.md](goal-projection.md) before it reaches here. Safe to
> Spend itself never introduces a fractional centavo.

## Horizon

Spec §9 says "upcoming" without saying how far ahead. Unbounded lookahead makes
the number meaningless — every future bill for the rest of your life is
"upcoming" — so a window is required.

**Definition.** The horizon `H` is the inclusive calendar-date range
`[today, periodEnd]`, where `periodEnd` is the **last day of the current budget
period**. For the MVP the budget period is the calendar month (spec §11 says
monthly budgets), so:

```text
today     = 2026-09-09          (injected, never read from the clock)
periodEnd = 2026-09-30
H         = [2026-09-09, 2026-09-30]   inclusive at both ends
```

All four adjustment terms — `ExpectedIncome`, `UpcomingExpenses`,
`PlannedSavings`, `DebtPayments` — are computed over `H` and only `H`.

**Why month-end rather than a rolling 30 days.** The user's mental model is
monthly: salary arrives monthly, rent is due monthly, budgets reset monthly
(spec §11), goals contribute monthly (spec §13). A rolling window would answer
a question nobody asks and would make the number drift downward every day as
next month's rent slid into view. Month-end means the number has a clear
meaning — *spendable before this month closes* — and resets predictably.

**The cost of that choice, stated honestly.** On the 28th of the month the
horizon is three days wide, so `ExpectedIncome` is near zero while
`UpcomingExpenses` still holds whatever is left. The number gets tight at
month-end. That is arguably correct (you *are* tight at month-end), but it is a
known sharp edge; a configurable or rolling horizon is a post-MVP improvement,
and the type below already carries `horizon` explicitly so adding it is a
caller change, not a rewrite.

**Both ends inclusive.** A bill due today counts. A bill due on the last day of
the month counts. Off-by-one at a period boundary is the classic bug here, so
the contract states it rather than leaving it to the implementation.

## CurrentBalance

> The sum of balances of the user's **spendable** accounts as at `today`.

Three refinements over "add up the accounts", each of which changes the answer:

### 1. Derived, never stored

The balance comes from the `account_balances` view — opening balance plus the
signed sum of transactions — not from a stored `accounts.balance` column. See
[../architecture/data-model.md](../architecture/data-model.md#derived-views).
A stored mutable balance drifts from the transaction history, and when it does,
Safe to Spend confidently reports a number derived from a lie.

### 2. Excludes accounts flagged out

`accounts.exclude_from_safe_to_spend` (boolean, default `false`) removes an
account from this term.

**Why the flag is needed — this is a data-model addition justified by spec §9.**
Spec §5 lists "Savings account" as an account type. A user with ₱200,000 in an
emergency fund is not free to spend ₱200,000 this month; showing them a Safe to
Spend figure that includes it makes the headline feature actively misleading,
which is worse than not having it. The flag lets the user say "this money is
not in play", which is exactly the distinction Safe to Spend exists to draw.

Defaults on account creation:

| `account_type` | `exclude_from_safe_to_spend` default | Reasoning |
|---|---|---|
| `cash` | `false` | Immediately spendable |
| `bank` | `false` | Immediately spendable |
| `ewallet` | `false` | Immediately spendable (GCash, Maya) |
| `savings` | **`true`** | Set aside by intent; the user can opt it in |
| `credit_card` | `false` | Included, but as a liability — see below |
| `other` | `false` | Unknown; the user can exclude it |

The default is a suggestion, not a rule: the user may flip any account either
way, and the UI explains what the flag does.

### 3. Credit cards are liabilities, not balances

A credit card's `account_balances` row is negative when money is owed (charges
are expenses against it; payments are transfers into it). It enters
`CurrentBalance` **as that negative number**, never as available credit.

Available credit is borrowing capacity, not money the user has. A budgeting app
that counts a ₱50,000 credit limit as ₱50,000 of spendable money is not a
budgeting app, it is a trap. So:

```text
currentBalanceMinor = Σ balance_minor
                      over accounts where exclude_from_safe_to_spend = false
```

with credit-card balances contributing their (usually negative) value directly.

## ExpectedIncome

> Income the user can reasonably expect to receive within `H`, and has not
> received yet.

Two sources, unioned then deduplicated:

1. **Recurring income occurrences** falling in `H` — a monthly salary, a
   biweekly retainer — expanded from `recurring_transactions` where
   `type = 'income'`, via
   [`expandOccurrences`](recurrence.md#function-contract).
2. **Future-dated income transactions** — a one-off invoice the user has
   recorded with `occurred_on` in the future. See
   [scheduled transactions](#the-mvp-degradation-path).

Then **deduplicated against actuals**: if the September salary has already
landed as a real transaction, its recurring occurrence must not also be counted.
Same rule as `UpcomingExpenses`, same shared module —
[`dedupeMaterialized`](recurrence.md#deduplication).

Only income dated **strictly after or on `today`** and **on or before
`periodEnd`** counts. Income already received is not "expected"; it is already
sitting in `CurrentBalance`, and counting it twice is the single most likely way
to overstate this number.

> [!NOTE]
> **Expected income is a forecast, and forecasts are wrong.** A freelancer's
> "expected" invoice may not arrive. This is why the breakdown is mandatory: the
> user can see that ₱15,000 of their Safe to Spend rests on an invoice, and
> discount it themselves. The number does not pretend to certainty it lacks.

## UpcomingExpenses

> Money already committed to leave the user's spendable accounts within `H`.

Three sources, unioned then deduplicated:

1. **Recurring expense occurrences** in `H` — rent, internet, subscriptions
   (spec §15's examples) — from `recurring_transactions` where
   `type = 'expense'`.
2. **Future-dated expense transactions** — a bill the user has scheduled.
3. **Credit-card minimum payments** due in `H` — these are counted in
   [`DebtPayments`](#debtpayments), not here, to keep the breakdown legible.
   Stated explicitly so nobody double-counts them.

### The dedupe rule, and why it matters

**The failure it prevents:** rent is due on the 12th and the user pays it early
on the 9th. Now there is a real ₱15,000 expense transaction *and* a recurring
occurrence for the 12th still inside `H`. Naively summing both deducts ₱30,000
for one ₱15,000 bill, and Safe to Spend under-reports by the price of a month's
rent. The user stops trusting the number, and they are right to.

**The rule.** An expanded occurrence is dropped when an actual transaction
already exists that matches it on:

```text
(recurring_transaction_id, periodKey(occurrenceDate, frequency))
```

`periodKey` buckets by the rule's own frequency — `2026-09` for monthly,
`2026-W37` for weekly — so "the September instance of rent" matches regardless
of whether it was paid on the 9th, the 12th, or the 14th. Full definition and
the multiple-actuals case: [recurrence.md](recurrence.md#deduplication).

This module is **shared verbatim** with the Money Timeline. Two
implementations of this rule would drift, and the day they drift is the day the
timeline and the Safe to Spend card disagree in front of the user.

## PlannedSavings

> The savings contributions the user still needs to make this period to stay on
> track for their active goals.

Defined in full in [goal-projection.md](goal-projection.md#plannedsavings--the-term-safe-to-spend-consumes).
Summarised here because it is the term most likely to be implemented wrongly:

```text
plannedSavingsMinor =
  Σ over active goals of
      max(0, requiredMonthlyContributionMinor(goal) - contributedThisPeriodMinor(goal))
```

Two details that are easy to get wrong:

- **`max(0, …)` is applied per goal, not to the sum.** A goal the user has
  over-funded this month must not create a negative term that subsidises
  under-funding another goal. Over-saving on the Japan trip does not free up
  money that was earmarked for the emergency fund.
- **Remaining, not the full target.** If the goal needs ₱10,000/month and the
  user has already contributed ₱10,000, the remaining requirement is ₱0 — that
  money has already left `CurrentBalance` as a contribution, and charging it
  again would double-count.

Goals with `status != 'active'`, goals already met, and goals past their target
date contribute `0`. See [goal-projection.md](goal-projection.md#edge-cases).

## DebtPayments

> Minimum payments falling due within `H` on credit and loan accounts.

**MVP model:** debt minimums are represented as ordinary scheduled or recurring
expenses against the `credit_card` account, so this term is populated from the
same expansion machinery as `UpcomingExpenses` — filtered to those whose
account is a `credit_card`, or which the user has marked as a debt payment.

It is a **separate breakdown line** even though it is mechanically similar to
`UpcomingExpenses`, because spec §9's arithmetic shows it separately and the
user thinks about it separately. Debt is emotionally and financially distinct
from the electricity bill.

**What the MVP does not do:** amortisation, interest accrual, minimum-payment
calculation from a statement balance and an APR, or payoff scheduling. A real
debt model is V3 (`V3-M23 Debt Planner`). Until then this term is exactly as
good as the scheduled expenses the user records, and the doc says so rather
than implying more.

## The MVP degradation path

> [!IMPORTANT]
> **This section is what lets M7 ship before the V2 recurrence engine.**

`ExpectedIncome` and `UpcomingExpenses` are defined above in terms of recurring
transactions — but `recurring_transactions` is spec §15, a **V2 feature**, and
Safe to Spend is **MVP**. M7 would be blocked on V2 if the formula strictly
required it.

**The substitute:** a transaction whose `occurred_on` is in the future is a
**scheduled transaction**. It is a real row in `transactions`, it belongs to an
account and a category, and it simply has not happened yet.

That gives a clean two-stage rollout with no rewrite:

| Stage | `ExpectedIncome` / `UpcomingExpenses` source | Shipped in |
|---|---|---|
| **MVP** | Future-dated `transactions` only | [M7](../../tasks/backlog/m7-safe-to-spend.md) |
| **V2** | Future-dated transactions **∪** expanded recurring occurrences, deduplicated | `V2-M10` |

The function signature does not change between stages. `SafeToSpendInput`
carries already-resolved `ScheduledItem[]`; assembling that list from one source
or two is the *query's* problem, not the pure function's. This is the practical
payoff of keeping `lib/core` free of I/O — the algorithm cannot tell which stage
it is in, so it needs no branch for it.

Two consequences to state plainly:

- **Future-dated transactions must be excluded from every "actual" aggregate.**
  A bill scheduled for the 25th is not September spending yet. Monthly totals,
  budget progress, and cash-flow charts all filter to `occurred_on <= today`.
  This constraint is a foot-gun with a wide blast radius, so it is called out in
  [../architecture/data-model.md](../architecture/data-model.md) and in the M4
  aggregate tasks as well as here.
- **`CurrentBalance` must exclude them too.** The `account_balances` view sums
  transactions `where occurred_on <= today`. Otherwise a scheduled bill would
  reduce the balance *and* appear in `UpcomingExpenses` — double-counted, in the
  opposite direction from the dedupe bug, and just as wrong.

## Status bands

Spec §9's UX shows `🟢 Safe to spend: ₱23,500`. The colour needs a rule.

An absolute threshold cannot work: ₱5,000 is comfortable for a student and
alarming for someone with ₱80,000 of monthly outflow. So the band is relative
to the user's own income scale.

```text
periodIncomeMinor = expectedIncomeMinor + income already received this period

green  (🟢)   safeToSpend >  0.15 × periodIncomeMinor
amber  (🟡)   safeToSpend >  0                          (and not green)
red    (🔴)   safeToSpend <= 0
```

| Band | Meaning | Copy direction (spec §32) |
|---|---|---|
| 🟢 green | Comfortable buffer | *"Good news: future-you still has money."* |
| 🟡 amber | Positive but thin | Factual, gently cautionary. No alarm. |
| 🔴 red | Committed beyond available funds | **Non-judgmental**, actionable. Never scolding. |

**The 15% figure is an opinionated default, not a derived truth.** It is
documented as tunable, lives in one named constant, and has a unit test at each
boundary. It exists so the UI has a rule at all rather than a hardcoded guess
scattered across components.

**When `periodIncomeMinor` is 0** — a user with no income recorded yet — the
green threshold degenerates to `> 0`, collapsing green and amber. Handled
explicitly: with zero known income the band is amber whenever positive, because
claiming a comfortable buffer against unknown income is a claim the data does
not support.

**Red is a design responsibility, not just a colour.** Spec §32 requires a
non-judgmental tone, and this is the state where that matters most — the user is
already stressed. The state gets its own copy and its own layout treatment; see
[../architecture/frontend-architecture.md](../architecture/frontend-architecture.md)
and task `M7-F03`.

## Function contract

```typescript
// lib/core/safe-to-spend/types.ts

/** A calendar date in the user's timezone. Never a UTC instant. */
type CalendarDate = string; // 'YYYY-MM-DD' — see recurrence.md

/** Integer minor units (centavos). Never a float. */
type Minor = number;

type SafeToSpendTermKey =
  | 'currentBalance'
  | 'expectedIncome'
  | 'upcomingExpenses'
  | 'plannedSavings'
  | 'debtPayments';

/** One thing that contributed to a term — the row the UI links to. */
interface Contribution {
  readonly sourceKind: 'account' | 'transaction' | 'recurring' | 'goal';
  readonly sourceId: string;
  readonly label: string;          // 'Rent', 'BPI Savings', 'Japan Trip'
  readonly amountMinor: Minor;     // magnitude, always >= 0 except balances
  readonly date?: CalendarDate;    // when it falls, for dated items
}

interface SafeToSpendTerm {
  readonly key: SafeToSpendTermKey;
  readonly totalMinor: Minor;
  readonly sign: 1 | -1;           // how it enters the identity
  readonly contributions: readonly Contribution[];
}

interface SafeToSpendInput {
  /** Injected. lib/core never reads the clock. */
  readonly today: CalendarDate;
  readonly horizon: { readonly from: CalendarDate; readonly to: CalendarDate };
  readonly currency: string;       // single currency per user in the MVP

  readonly accounts: readonly {
    readonly id: string;
    readonly label: string;
    readonly type: AccountType;
    readonly balanceMinor: Minor;  // from account_balances, may be negative
    readonly excludeFromSafeToSpend: boolean;
  }[];

  /** Future-dated transactions ∪ deduplicated recurring occurrences. */
  readonly scheduled: readonly {
    readonly id: string;
    readonly label: string;
    readonly date: CalendarDate;
    readonly amountMinor: Minor;   // always positive
    readonly direction: 'in' | 'out';
    readonly isDebtPayment: boolean;
    readonly sourceKind: 'transaction' | 'recurring';
  }[];

  readonly goals: readonly {
    readonly id: string;
    readonly label: string;
    readonly remainingContributionMinor: Minor; // already max(0, …) per goal
  }[];

  /** Income already received this period, for the status band only. */
  readonly receivedIncomeThisPeriodMinor: Minor;
}

interface SafeToSpendResult {
  readonly totalMinor: Minor;
  readonly status: 'green' | 'amber' | 'red';
  /** Ordered exactly as spec §9's arithmetic layout. */
  readonly terms: readonly SafeToSpendTerm[];
  readonly currency: string;
  readonly horizon: { readonly from: CalendarDate; readonly to: CalendarDate };
}

/**
 * Pure. No I/O, no clock, no env. Same input always yields the same output.
 */
export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult;
```

### Why the result is a breakdown, not a number

Spec §9's whole premise is that a bare balance is unhelpful. Replacing it with a
different bare number would repeat the mistake — the user has no reason to
believe ₱23,500 rather than ₱42,000 unless they can see where the difference
went.

So the return type is a breakdown, and three things follow from that:

1. **The drawer needs no second query.** `M7-F02` renders `terms` directly,
   laid out to mirror spec §9's arithmetic.
2. **Every line is traceable.** Each `Contribution` carries `sourceId`, so the
   UI links "Rent −₱15,000" to the transaction that caused it.
3. **The invariant is checkable.** The terms must sum to the total, and a
   property test asserts it — so a UI that renders the breakdown can never
   disagree with the headline figure.

Returning a scalar and recomputing the parts in the component would put money
math in a Client Component, which
[../architecture/source-structure.md](../architecture/source-structure.md)
forbids for exactly this reason.

## Edge cases

| Case | Behaviour | Reasoning |
|---|---|---|
| No accounts at all | `total = 0`, status amber, all terms present and empty | A new user must see the card explaining itself, not a crash or a blank |
| All accounts excluded | `currentBalance = 0` | The user asked for this; respect it |
| Negative total balance | `total` is negative, status red | Truthful. Red copy handles it non-judgmentally |
| No goals | `plannedSavings = 0` with an empty contribution list | Not an error |
| Goal already met | Contributes `0` | Nothing left to set aside |
| Goal target date in the past | Contributes `0`; goal surfaces as needing attention elsewhere | Dividing by zero or negative months is meaningless |
| Income dated exactly `today` | Counted in `ExpectedIncome` if not yet actual | Horizon is inclusive at both ends |
| Expense dated exactly `today` | Counted in `UpcomingExpenses` | Same |
| Expense dated exactly `periodEnd` | Counted | Horizon inclusive |
| Recurring occurrence already paid | Dropped by dedupe | The rent-paid-early bug |
| Two actuals in one period for one rule | One occurrence dropped, both actuals stand in the balance | The second payment is real money that really left |
| `credit_card` with a positive balance | Enters as positive (the user overpaid) | Arithmetically consistent; rare but valid |
| Transfer between own accounts | **Excluded entirely** | Moving money is not spending it; both legs net to zero |
| Mixed currencies across accounts | **Throws** `MixedCurrencyError` | Silently adding ₱ to $ is the worst possible outcome. MVP is single-currency; see [money-and-rounding.md](money-and-rounding.md) |
| `horizon.to` before `horizon.from` | **Throws** `InvalidHorizonError` | A caller bug; fail loudly |
| Scheduled item outside `H` | Ignored | That is what the horizon is for |
| `receivedIncomeThisPeriodMinor = 0` | Green band unreachable; amber when positive | Cannot claim a buffer against unknown income |

## Invariants for property tests

These hold for **all** valid inputs and are the specification a property-based
test suite (fast-check) encodes. They catch the class of bug that
example-based tests miss.

1. **Breakdown sums to the total.**
   `Σ term.totalMinor × term.sign === result.totalMinor`
   The single most important invariant: the UI can never contradict the headline.

2. **Adding an expense never increases Safe to Spend.**
   For any scheduled expense `e` inside `H`:
   `compute(input + e).totalMinor <= compute(input).totalMinor`

3. **Adding income never decreases it.**
   Symmetric to (2).

4. **Monotonic in balance.** Increasing any included account's balance by `δ > 0`
   increases the total by exactly `δ`.

5. **Excluded accounts have no effect.** Changing the balance of an account with
   `excludeFromSafeToSpend = true` leaves the total unchanged.

6. **Determinism.** Same input, same output — always. No clock, no randomness.

7. **Integrality.** Every returned amount is a safe integer. No fractional
   centavo can appear, since the function only adds and subtracts integers.

8. **Horizon boundedness.** Scheduled items outside `[from, to]` never affect the
   result.

9. **Dedupe idempotence.** Computing over occurrences that were already
   deduplicated changes nothing.

10. **Band consistency.** `status === 'red'` ⟺ `totalMinor <= 0`.

## Canonical unit-test fixture

Spec §9's worked example is **the** reference case. It appears verbatim in the
product spec, in the unit test, and in the E2E test (`M7-B06`), so all three
agree on what correct means.

```text
Current balance       ₱42,000
Expected income       ₱15,000
Upcoming bills       -₱18,500
Savings target       -₱10,000
Debt payments         -₱5,000
--------------------------------
Safe to spend         ₱23,500
```

`STS_FIXTURE_SPEC_S9` — in minor units, with `today = 2026-09-09` and a
September month-end horizon:

| Term | Sign | Minor units | Composition |
|---|---|---|---|
| `currentBalance` | `+` | `4_200_000` | Cash ₱5,000 + BPI ₱37,000 |
| `expectedIncome` | `+` | `1_500_000` | Freelance invoice ₱15,000, due Sep 20 |
| `upcomingExpenses` | `−` | `1_850_000` | Rent ₱15,000 (Sep 12) + Internet ₱1,800 (Sep 25) + Electricity ₱1,700 (Sep 28) |
| `plannedSavings` | `−` | `1_000_000` | Emergency Fund, ₱10,000 remaining this month |
| `debtPayments` | `−` | `500_000` | Credit card minimum ₱5,000 (Sep 15) |
| **total** | | **`2_350_000`** | **= ₱23,500** |

```typescript
// tests/unit/safe-to-spend/spec-s9.test.ts
it('reproduces spec §9 exactly', () => {
  const result = computeSafeToSpend(STS_FIXTURE_SPEC_S9);
  expect(result.totalMinor).toBe(2_350_000);   // ₱23,500
  expect(result.status).toBe('green');         // > 0.15 × 15,000_00
  expect(sumTerms(result.terms)).toBe(result.totalMinor);
});
```

The status is green because ₱23,500 > 0.15 × ₱15,000 = ₱2,250.

### Required companion fixtures

| Fixture | Asserts |
|---|---|
| `STS_FIXTURE_EMPTY` | New user: total 0, amber, all five terms present and empty |
| `STS_FIXTURE_NEGATIVE` | Committed beyond funds: negative total, red |
| `STS_FIXTURE_AMBER_BOUNDARY` | Exactly at `0.15 × periodIncome` — green requires strictly greater |
| `STS_FIXTURE_RED_BOUNDARY` | Exactly `0` → red, not amber |
| `STS_FIXTURE_PAID_EARLY` | Rent paid on the 9th for a rule dated the 12th: counted **once** |
| `STS_FIXTURE_EXCLUDED_SAVINGS` | ₱200,000 savings account excluded: does not inflate the total |
| `STS_FIXTURE_CREDIT_CARD_DEBT` | Card balance −₱8,500 reduces `currentBalance` |
| `STS_FIXTURE_TRANSFER` | An own-account transfer changes nothing |
| `STS_FIXTURE_MIXED_CURRENCY` | Throws `MixedCurrencyError` |
| `STS_FIXTURE_MONTH_END` | `today = periodEnd`: a three-day horizon still computes correctly |

Coverage floor for `lib/core/safe-to-spend/**` is **95%** — higher than the 90%
that applies to the rest of `lib/core`. This is the number the product is named
after; see
[../../workflow/07-definition-of-ready-and-done.md](../../workflow/07-definition-of-ready-and-done.md).
