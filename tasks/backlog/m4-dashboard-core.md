# M4 — Dashboard Core

**Goal.** Answer spec §31's middle questions at a glance: how much did I earn,
how much did I spend, and **where did my money go** — the question the product
is named after. The work is mostly pure aggregation in `lib/core`, plus one
performance-sensitive query. Two details carry disproportionate weight:
transfers and future-dated transactions must be **excluded** from every actuals
figure, and category percentage shares must sum to **exactly 100%**, which needs
largest-remainder allocation rather than naive rounding. The Safe to Spend tile
slot is reserved here and filled in [M7](m7-safe-to-spend.md).

## Exit criteria

- [ ] Four metric tiles — balance, monthly income, monthly expenses, monthly savings — with month-over-month deltas
- [ ] Cash-flow chart over a selectable range, with an accessible fallback table
- [ ] Spending breakdown by category whose shares sum to exactly 100%
- [ ] Recent transactions widget linking to the full list
- [ ] Transfers and future-dated transactions excluded from every actuals figure
- [ ] Dashboard summary is a single N+1-free query set, measured against the 5,000-transaction seed
- [ ] A shared seed script exists and is used by integration tests, E2E, and manual QA
- [ ] First-run empty state guides a new user through spec §30's journey
- [ ] Spec §31 Q2, Q3, Q4 answerable with **zero clicks**

## Progress

| Done | ID | Title |
|---|---|---|
| [ ] | M4-B01 | `[M4][BE] Implement monthly aggregates in lib/core` |
| [ ] | M4-B02 | `[M4][BE] Implement cash-flow series and category breakdown in lib/core` |
| [ ] | M4-B03 | `[M4][BE] Implement the dashboard summary query` |
| [ ] | M4-B04 | `[M4][BE] Build the demo seed script` |
| [ ] | M4-F01 | `[M4][FE] Build the dashboard metric tiles` |
| [ ] | M4-F02 | `[M4][FE] Build the cash-flow chart` |
| [ ] | M4-F03 | `[M4][FE] Build the spending breakdown chart` |
| [ ] | M4-F04 | `[M4][FE] Build the recent transactions widget` |
| [ ] | M4-F05 | `[M4][FE] Build the dashboard layout, empty state, and onboarding nudges` |
| [ ] | M4-B05 | `[M4][DO] Add the dashboard E2E test` |

## Tasks

| ID | Stream | Title | Acceptance criteria | Issue |
|---|---|---|---|---|
| M4-B01 | backend | `[M4][BE] Implement monthly aggregates in lib/core` | `lib/core/aggregates/monthly.ts` exports pure functions computing income, expenses, savings, and net for a period from an array of domain transactions; **savings = income − expenses** per spec §8, not a separate concept; `today` and the period bounds are **injected**, never read from the clock, per [ADR-0003](../../docs/adr/0003-pure-typescript-domain-core.md); **transfers are excluded** — a test asserts a ₱5,000 transfer between own accounts changes no figure; **future-dated transactions are excluded** — a test asserts a transaction dated tomorrow does not appear in this month's expenses, per [../../docs/domain/safe-to-spend.md](../../docs/domain/safe-to-spend.md#the-mvp-degradation-path); unit tests cover an empty month returning zeros rather than null, a month with income only, a month with expenses only, a transaction dated exactly `periodStart` and exactly `periodEnd` (both included), a transaction one day outside each bound (both excluded), February in a leap and non-leap year, and a month-over-month delta where the prior month is empty; all arithmetic is on integer minor units with no division, so no rounding occurs; coverage ≥ 90% | — |
| M4-B02 | backend | `[M4][BE] Implement cash-flow series and category breakdown in lib/core` | `lib/core/aggregates/cashflow.ts` produces a bucketed series — daily for ranges up to ~45 days, weekly or monthly beyond — with each bucket carrying income, expenses, and net; **buckets with no activity are present with zeros** so the chart has no gaps, asserted by a test; `lib/core/aggregates/breakdown.ts` produces category totals with **percentage shares allocated by largest remainder so they sum to exactly 100**, per [../../docs/domain/money-and-rounding.md](../../docs/domain/money-and-rounding.md) — a test with three categories at ₱33.33 each asserts the shares are 33.34/33.33/33.33 or equivalent and total exactly 100.00, and a property test asserts the sum is exactly 100 for arbitrary inputs; ordering is **deterministic** — descending by amount, then by category name, then by id — so snapshot tests cannot flake; transfers and future-dated transactions excluded; uncategorised transactions are grouped under a single explicit bucket rather than dropped, so the breakdown always accounts for all spending; unit tests cover an empty range, a single category at 100%, and a range crossing a month boundary; coverage ≥ 90% | — |
| M4-B03 | backend | `[M4][BE] Implement the dashboard summary query` | `lib/server/queries/dashboard.ts` gathers everything the dashboard needs — account balances, this period's and last period's transactions for the aggregates, and the recent-transactions slice — in a **single round-trip set**, not one query per tile; **no N+1**: a test asserts the query count is constant regardless of how many accounts or categories the user has; a SQL view or aggregate query is used where it beats fetching rows into `lib/core`, with the split following [ADR-0003](../../docs/adr/0003-pure-typescript-domain-core.md) — SQL sums rows, TypeScript makes judgements; results are mapped to domain types and passed to the [M4-B01](#tasks) and [M4-B02](#tasks) functions; results are cached under the `dashboard` tag and invalidated per the matrix in [../../docs/architecture/state-and-caching.md](../../docs/architecture/state-and-caching.md#invalidation-matrix); **measured against the [M4-B04](#tasks) 5,000-transaction seed** with the query plan pasted into the PR showing index use rather than sequential scans; integration tests assert the assembled figures match a hand-computed expectation and that a second user's data never appears | — |
| M4-B04 | backend | `[M4][BE] Build the demo seed script` | A script (or `supabase/seed.sql`) generating a plausible six-month history for a demo user: ~5,000 transactions across all seeded categories with realistic distributions — a monthly salary, weekly groceries, monthly rent and utilities, occasional larger purchases — plus several accounts including a credit card with a negative balance and a savings account flagged `exclude_from_safe_to_spend`, two or three budgets, and two goals with contributions; **deterministic** — a fixed seed so the same data is produced every run, which is what lets E2E tests assert exact figures; **idempotent** and safe to re-run; **never runs against production**, with a guard that refuses if the target is not local or preview; the dataset is **shared** by integration tests, the E2E suite, manual QA, and the performance baseline for [M9-B03](m9-mvp-hardening-and-launch.md), so it is documented in [../../docs/ops/testing-strategy.md](../../docs/ops/testing-strategy.md); includes at least one future-dated transaction and one bill-paid-early case so the [M7](m7-safe-to-spend.md) and [M8](m8-money-timeline.md) dedupe paths have data | — |
| M4-F01 | frontend | `[M4][FE] Build the dashboard metric tiles` | Four tiles — current balance, monthly income, monthly expenses, monthly savings — reading from [M4-B03](#tasks) in a Server Component; each shows the figure formatted via `lib/utils/money.ts` with the profile currency and a **month-over-month delta** with direction indicated by both an arrow and a sign, never colour alone; the balance tile agrees with the Accounts page total, asserted in [M4-B05](#tasks); **a slot is reserved for the Safe to Spend hero card** above the tiles, filled by [M7-F01](m7-safe-to-spend.md) — reserving it now avoids relaying out the dashboard later; loading shows skeletons sized to the final content so the layout does not shift; a tile with no data shows a dash and an explanation, not a zero that looks like a real figure; **components receive computed figures as props and perform no arithmetic**, per [../../docs/architecture/frontend-architecture.md](../../docs/architecture/frontend-architecture.md#the-serverclient-boundary); AA contrast in both themes; renders at 360 px | — |
| M4-F02 | frontend | `[M4][FE] Build the cash-flow chart` | A Recharts wrapper in `components/charts/cash-flow-chart.tsx` — **the only place the chart library is imported**, enforced by lint per [../../docs/architecture/frontend-architecture.md](../../docs/architecture/frontend-architecture.md#chart-isolation); shows income versus expenses over the selected range with a range selector offering spec §16's presets; colours come from the `--color-income` / `--color-expense` semantic tokens so they work in both themes; tooltips format amounts in the profile currency; **an accessible fallback table** carries the same numbers, visually hidden by default with a "view as table" toggle that is also useful to sighted users reading exact figures, and the chart carries `role="img"` with a summarising `aria-label`; the chart consumes the pre-computed series from [M4-B02](#tasks) and does no aggregation of its own; empty range renders an explanatory empty state rather than an axis with no data; respects `prefers-reduced-motion`; the client bundle only loads the chart library on routes that use it | — |
| M4-F03 | frontend | `[M4][FE] Build the spending breakdown chart` | A donut or horizontal bar in `components/charts/category-breakdown.tsx` showing spending by category for the period; **category colours come from the user's own category records**, not a hardcoded palette, so the breakdown matches the chips in the transactions list; a legend lists each category with its amount and percentage, and the percentages **sum to exactly 100%** because [M4-B02](#tasks) allocates by largest remainder — asserted in [M4-B05](#tasks); clicking a segment or legend row navigates to `(app)/transactions` **filtered to that category**, using the URL filter state from [M3-F03](m3-transactions-and-categories.md); an accessible fallback table and `aria-label` as in [M4-F02](#tasks); the uncategorised bucket is shown explicitly rather than omitted; empty state in spec §32's voice; **this chart answers spec §31 Q4** — the question the product is named after — so it gets prominent placement | — |
| M4-F04 | frontend | `[M4][FE] Build the recent transactions widget` | Shows the latest 5–10 actual transactions with date, description, category chip, and signed amount, reusing the row component from [M3-F02](m3-transactions-and-categories.md) rather than duplicating it; a "view all" link to `(app)/transactions`; excludes future-dated transactions, which belong to the timeline widget in [M8-F05](m8-money-timeline.md); empty state prompts the first transaction; keyboard navigable with each row activating the edit sheet | — |
| M4-F05 | frontend | `[M4][FE] Build the dashboard layout, empty state, and onboarding nudges` | A responsive grid placing the reserved Safe to Spend slot first, then the metric tiles, then cash flow and breakdown side by side on desktop and stacked on mobile, then recent transactions — with slots reserved for the budget-health widget ([M5-F03](m5-budgets.md)), goals widget ([M6-F03](m6-goals.md)), and upcoming expenses ([M8-F05](m8-money-timeline.md)) so later milestones add rather than rearrange; a **first-run state** for a user with no accounts guiding them through spec §30's journey — create an account, add income, add an expense — as an explicit checklist that disappears once complete; intermediate states handled, such as accounts but no transactions; all copy in spec §32's voice, warm in the empty state where there is nothing to be careful about, per [../../docs/architecture/frontend-architecture.md](../../docs/architecture/frontend-architecture.md#brand-voice); one `<h1>`, meaningful heading order, landmarks correct; verified at 360 px with no horizontal scroll | — |
| M4-B05 | devops | `[M4][DO] Add the dashboard E2E test` | Playwright `tests/e2e/dashboard-metrics.spec.ts` and `spending-breakdown.spec.ts` against the deterministic [M4-B04](#tasks) seed: assert each metric tile shows the **exact expected figure**, that the balance tile equals the Accounts page total, that a transfer in the seed has not inflated income or expenses, that a future-dated transaction in the seed is absent from this month's expenses, that the breakdown legend percentages sum to exactly 100.0, and that clicking a category segment lands on the transactions list filtered to it; **proves spec §31 Q2, Q3, and Q4**, recorded in [../../docs/product/success-criteria.md](../../docs/product/success-criteria.md); flake-free over three consecutive runs | — |

## Demo script

Run on a preview deployment with the [M4-B04](#tasks) seed applied:

1. Sign in and land on the dashboard.
2. Read out the four tiles and their month-over-month deltas.
3. Show the cash-flow chart; change the range to last 3 months.
4. Toggle the chart's "view as table" and show the same numbers.
5. Show the spending breakdown; point out the legend percentages summing to 100.
6. Click the largest category; land on the filtered transactions list.
7. Return to the dashboard; add an expense; show the tiles and breakdown update.
8. Sign in as a fresh user and show the first-run onboarding checklist.

## Notes

- **The two exclusions are the recurring bug source here.** Transfers are not
  spending; future-dated transactions have not happened. Both are asserted in
  [M4-B01](#tasks), [M4-B02](#tasks), and again in
  [M4-B05](#tasks) — deliberately repeated, because the constraint reappears in
  M5, M7, and M8.
- **M4, [M5](m5-budgets.md), and [M6](m6-goals.md) are independent** once
  [M3](m3-transactions-and-categories.md) lands, so they can be worked in any
  order or in parallel.
- [M4-B04](#tasks)'s seed is used by four different consumers. It is worth more
  care than a seed script usually gets, and its determinism is what makes exact
  E2E assertions possible.
