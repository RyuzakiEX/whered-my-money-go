# Success Criteria

**The bar:** spec §31 lists nine questions. If a user can answer all nine
quickly in the running app, the MVP succeeded. This document turns each into a
testable criterion, names the milestone that delivers it, and names the E2E test
that proves it.

Spec §31 closes with: *"If the application can answer these questions clearly,
the MVP is successful."* That is the definition of done for the whole MVP, so it
gets to be checkable rather than aspirational.

## The nine questions

| # | Question | Answered by | Milestone | E2E test |
|---|---|---|---|---|
| 1 | How much money do I have? | Accounts list total + dashboard balance tile | M2 → M4 | `accounts.spec.ts` |
| 2 | How much did I earn this month? | Monthly income tile | M3 → M4 | `dashboard-metrics.spec.ts` |
| 3 | How much did I spend? | Monthly expenses tile | M3 → M4 | `dashboard-metrics.spec.ts` |
| 4 | Where did my money go? | Spending breakdown by category | M4 | `spending-breakdown.spec.ts` |
| 5 | **How much can I safely spend?** | **Safe to Spend hero card + breakdown** | **M7** | `safe-to-spend.spec.ts` |
| 6 | What bills are coming up? | Money Timeline + upcoming expenses widget | M8 | `timeline.spec.ts` |
| 7 | Am I staying within my budget? | Budget page progress bars | M5 | `budget-progress.spec.ts` |
| 8 | How much have I saved? | Goals page progress | M6 | `goals.spec.ts` |
| 9 | Am I on track for my savings goal? | Goal projected completion date | M6 | `goals.spec.ts` |

`M9-B05` completes the suite and holds it to a hard bar: **every question
covered by an assertion, under 10 minutes, flake-free over three consecutive
runs.**

## Criteria in detail

### 1. How much money do I have?

- [ ] Accounts page lists every non-archived account with its current balance
- [ ] A total across spendable accounts is shown
- [ ] Balances are **derived** from transactions, not a stored column
- [ ] Credit-card balances display as negative (owed), never as available credit
- [ ] Excluded accounts are visibly distinguished from spendable ones
- [ ] Dashboard balance tile agrees with the accounts page total

**Reachable in:** one click from the dashboard.

### 2. How much did I earn this month?

- [ ] Monthly income tile shows the current period's income
- [ ] Transfers between own accounts are **excluded**
- [ ] Scheduled (future-dated) transactions are **excluded**
- [ ] A month-over-month delta is shown
- [ ] Correct on the 1st of the month (a single day elapsed, not a divide-by-zero)

**Reachable in:** zero clicks — on the dashboard.

### 3. How much did I spend?

- [ ] Monthly expenses tile shows the current period's spending
- [ ] Transfers and scheduled transactions **excluded**
- [ ] Month-over-month delta shown
- [ ] Savings tile equals income − expenses (spec §8)

**Reachable in:** zero clicks.

### 4. Where did my money go?

- [ ] Spending breakdown by category for the period
- [ ] Category colours come from the user's own category records
- [ ] Percentage shares sum to **exactly 100%** (largest-remainder rounding)
- [ ] Clicking a category opens the transactions list filtered to it
- [ ] An accessible fallback table carries the same numbers
- [ ] Empty state guides a user with no transactions yet

**Reachable in:** zero clicks. This is the question the product is named after.

### 5. How much can I safely spend? ⭐

The differentiator. Spec §9.

- [ ] Hero card at the top of the dashboard, the most prominent element
- [ ] Status band 🟢 / 🟡 / 🔴, **stated in text as well as colour**
- [ ] Breakdown drawer shows all five terms in spec §9's arithmetic layout
- [ ] Each breakdown line lists its contributing items, linked to source records
- [ ] Terms **sum to** the headline figure — asserted by a property test
- [ ] Recomputes when a transaction, account, goal, or budget changes
- [ ] Spec §9's example reproduces exactly: ₱42,000 + ₱15,000 − ₱18,500 − ₱10,000 − ₱5,000 = **₱23,500**
- [ ] Negative state uses non-judgmental copy and offers a next step
- [ ] Breakdown is a real `<table>` with headers, screen-reader navigable

**Reachable in:** zero clicks, and it is the first thing the eye lands on.

### 6. What bills are coming up? ⭐

Spec §10.

- [ ] Timeline page lists upcoming events chronologically from a `TODAY` anchor
- [ ] Each event shows its projected balance after
- [ ] Ordering is deterministic; income sorts before expense on the same date
- [ ] Shortfall date highlighted when the projection goes negative
- [ ] Horizon selector: 7 / 30 / 60 / 90 days
- [ ] Filters by account, category, and direction, reflected in the URL
- [ ] A filtered projection is **labelled as filtered**
- [ ] Dashboard widget shows the next few commitments, linking to the timeline
- [ ] A bill paid early appears **once**, not twice

**Reachable in:** one click, plus a dashboard widget.

### 7. Am I staying within my budget?

Spec §11.

- [ ] Budget page shows one row per budgeted category as `spent / limit`
- [ ] Progress bar coloured by status, with status also in text
- [ ] Over-budget rows render correctly (two of spec §11's four examples are over)
- [ ] `remaining` may be negative and is never clamped to zero
- [ ] Period switcher for viewing past periods
- [ ] Dashboard budget-health widget lists at-risk and exceeded categories
- [ ] At-risk copy matches spec §32's voice
- [ ] Progress updates immediately after a matching expense

**Reachable in:** zero clicks for the warning, one for the detail.

### 8. How much have I saved?

Spec §13.

- [ ] Goals page shows each goal as `saved / target` (spec §13's format)
- [ ] Progress bar or ring per goal
- [ ] Current amount is **derived** from contributions, not stored
- [ ] Contributions are addable from the goal card
- [ ] Dashboard widget shows active goals (spec §8)

**Reachable in:** one click, plus a dashboard widget.

### 9. Am I on track for my savings goal?

- [ ] Each goal shows its **projected completion date**
- [ ] Required monthly contribution shown, and updates live while editing a goal
- [ ] Projected vs target date compared visibly
- [ ] *"At this rate, never"* handled explicitly when the contribution rate is not positive
- [ ] A goal already met, and one past its target date, both render sensibly

**Reachable in:** one click.

## Cross-cutting requirements

Spec §31 says *"quickly"* and *"clearly"*, which are requirements too.

### Quickly

| Requirement | Where |
|---|---|
| Questions 2, 3, 4, 5 answerable with **zero clicks** from the dashboard | Dashboard layout |
| Every other question within **one click** | Sidebar nav, spec §25 |
| Dashboard TTFB < 600 ms, LCP < 2.5 s against the 5,000-transaction seed | `M9-B03` |
| `+ Add Transaction` reachable from anywhere | `M3-F01` |

### Clearly

| Requirement | Where |
|---|---|
| Every figure formatted with the profile currency, `₱` default | `lib/utils/money.ts` |
| No figure conveyed by colour alone | `M9-F01` |
| AA contrast, both themes | `M9-F01` |
| Every route usable at 360 px, touch targets ≥ 44 px | `M9-F02` |
| Charts carry an accessible fallback table | `M4-F02`, `M4-F03` |
| Empty states explain what to do next, in spec §32's voice | Per feature |
| Bad news is non-judgmental and actionable | [frontend-architecture.md](../architecture/frontend-architecture.md#brand-voice) |

## The real test

Spec §33 sets a different kind of bar:

> Build the smallest product that makes the user say: *"Ohhh. Now I know where
> my money is going."*

The nine questions are checkable; that sentence is not. It is worth keeping in
view anyway, because a product could pass every checkbox above and still fail
it — nine correct numbers arranged badly do not produce that reaction. Question
4 and question 5, on one screen, understood without effort, are what do.
