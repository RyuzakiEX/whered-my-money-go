# M7 — Safe to Spend ⭐

**Goal.** The headline differentiator. One prominent number answering spec §31
Q5 — "how much can I safely spend?" — and, crucially, a breakdown the user can
open and interrogate. Spec §9's premise is that a bare balance is unhelpful;
replacing it with a different bare number would repeat the mistake, so
**`computeSafeToSpend` returns the per-term breakdown, not a scalar**.

The algorithm is fully specified in
[safe-to-spend.md](../../docs/domain/safe-to-spend.md) — horizon, what counts as
spendable, the dedupe rule, the status bands, and the invariants. That document
resolved every ambiguity spec §9 left open, so this milestone implements a
specification rather than inventing one.

**This milestone can ship before the V2 recurrence engine.** Future-dated
transactions substitute for recurring occurrences; the function signature is
identical either way. See
[the degradation path](../../docs/domain/safe-to-spend.md#the-mvp-degradation-path).

## Exit criteria

- [ ] **Spec §9's worked example reproduces exactly: ₱23,500** — in a unit test and in the UI with equivalent data
- [ ] The breakdown is expandable and every line links to its source record
- [ ] The terms provably sum to the headline figure (property test)
- [ ] The number updates when any transaction, account, goal, or budget changes
- [ ] Status bands 🟢 / 🟡 / 🔴 with the band stated in text, not colour alone
- [ ] Coverage on `lib/core/safe-to-spend/**` is **≥ 95%**
- [ ] Negative state uses non-judgmental copy and offers a next step
- [ ] Breakdown drawer is a real table, screen-reader navigable
- [ ] Spec §31 Q5 answerable with **zero clicks** from the dashboard

## Progress

| Done | ID | Title |
|---|---|---|
| [ ] | M7-B01 | `[M7][BE] Implement computeSafeToSpend with full breakdown` |
| [ ] | M7-B02 | `[M7][BE] Implement Safe to Spend status bands` |
| [ ] | M7-B03 | `[M7][BE] Add exclude_from_safe_to_spend and scheduled-transaction support` |
| [ ] | M7-B04 | `[M7][BE] Implement the SafeToSpendInput assembly query` |
| [ ] | M7-B05 | `[M7][BE] Implement Safe to Spend caching and revalidation` |
| [ ] | M7-B06 | `[M7][SH] Add property tests for the documented invariants` |
| [ ] | M7-F01 | `[M7][FE] Build the Safe to Spend hero card` |
| [ ] | M7-F02 | `[M7][FE] Build the Safe to Spend breakdown drawer` |
| [ ] | M7-F03 | `[M7][FE] Build the explainer and low-amount states` |
| [ ] | M7-B07 | `[M7][DO] Add the Safe to Spend E2E test` |

## Tasks

| ID | Stream | Title | Acceptance criteria | Issue |
|---|---|---|---|---|
| M7-B01 | backend | `[M7][BE] Implement computeSafeToSpend with full breakdown` | **The most important task in the MVP.** `lib/core/safe-to-spend/compute.ts` implements [safe-to-spend.md](../../docs/domain/safe-to-spend.md) exactly: `computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult`, pure, `today` **injected**, no clock, no env, no I/O; returns the total **plus each of the five terms with its contributing items**, ordered as spec §9's arithmetic layout, because the UI must explain the number; `CurrentBalance` sums only accounts with `excludeFromSafeToSpend = false`, counting credit-card balances as their **negative liability** and never as available credit, each with a test; `ExpectedIncome` and `UpcomingExpenses` cover `[today, periodEnd]` **inclusive at both ends**, with tests at each boundary; `PlannedSavings` consumes [M6-B05](m6-goals.md)'s per-goal entries unchanged; `DebtPayments` is a separate term even though mechanically similar to upcoming expenses, because spec §9 shows it separately; **the canonical fixture `STS_FIXTURE_SPEC_S9` asserts exactly `2_350_000`** — ₱42,000 + ₱15,000 − ₱18,500 − ₱10,000 − ₱5,000 = ₱23,500; the companion fixtures listed in the doc all pass, including `STS_FIXTURE_PAID_EARLY` (a bill paid early counted **once**), `STS_FIXTURE_EXCLUDED_SAVINGS`, `STS_FIXTURE_TRANSFER` (an own-account transfer changes nothing), and `STS_FIXTURE_MIXED_CURRENCY` (throws `MixedCurrencyError`); no rounding occurs anywhere, since the computation only adds and subtracts integers; **coverage ≥ 95%** | — |
| M7-B02 | backend | `[M7][BE] Implement Safe to Spend status bands` | `lib/core/safe-to-spend/bands.ts` implements the bands per [the doc](../../docs/domain/safe-to-spend.md#status-bands): green when `total > 0.15 × periodIncome`, amber when `total > 0` and not green, red when `total <= 0`; the 15% figure lives in **one named exported constant** documented as tunable, not inline; unit tests assert each boundary precisely — exactly `0.15 × periodIncome` is **amber** (green requires strictly greater), exactly `0` is **red** (not amber), and one minor unit either side of each threshold flips the band; the `periodIncome = 0` case degenerates so green is unreachable and a positive total is **amber**, with a test and a comment explaining that claiming a comfortable buffer against unknown income is unsupported by the data; the band is returned as a discriminated value the UI renders as both colour and text; coverage ≥ 95% | — |
| M7-B03 | backend | `[M7][BE] Add exclude_from_safe_to_spend and scheduled-transaction support` | The `accounts.exclude_from_safe_to_spend` column added in [M2-B01](m2-accounts.md) is activated in the UI and query layer, with the per-type defaults from [the doc](../../docs/domain/safe-to-spend.md#currentbalance) applied on account creation — `savings` defaults to `true`, everything else to `false` — as a suggestion the user can override; toggling the flag revalidates `accounts`, `dashboard`, `sts`, and `timeline`; **future-dated transactions are formally treated as scheduled**: the `account_balances` view is confirmed (or amended, with a migration) to sum only `occurred_on <= today` so a scheduled bill does not both reduce the balance **and** appear in `UpcomingExpenses` — double-counted in the opposite direction, and just as wrong — with an integration test asserting a transaction dated tomorrow affects neither the balance nor this month's expense aggregate but **does** appear in `UpcomingExpenses`; the MVP substitution for the V2 recurrence engine is documented in the migration comment and in [data-model.md](../../docs/architecture/data-model.md); an audit-log entry records changes to the exclusion flag, since it silently changes the headline figure and a user asking "why did my Safe to Spend drop?" deserves an answer, per [observability.md](../../docs/architecture/observability.md#audit-log) | — |
| M7-B04 | backend | `[M7][BE] Implement the SafeToSpendInput assembly query` | `lib/server/queries/safe-to-spend.ts` assembles the complete input in a **single round-trip set** — spendable account balances, scheduled income and expenses within the horizon, per-goal remaining contributions from [M6-B05](m6-goals.md), and debt minimums — with a test asserting constant query count regardless of account, goal, or transaction volume; the horizon is resolved from the **user's timezone**, so `periodEnd` is their month end rather than UTC's, with a test at a timezone boundary per [recurrence.md](../../docs/domain/recurrence.md#the-timezone-rule); own-account transfers are excluded, **except** transfers into an excluded account, which are genuine outflows — with a test, matching [M3-B09](m3-transactions-and-categories.md); the query maps rows to the domain input type via a mapper so no row shape reaches `lib/core`; an integration test asserts the assembled input against the deterministic [M4-B04](m4-dashboard-core.md) seed and that the resulting total matches a hand-computed expectation; a second user's data never appears | — |
| M7-B05 | backend | `[M7][BE] Implement Safe to Spend caching and revalidation` | The computed result is cached under the `user:{id}:sts` tag from `lib/server/cache/tags.ts` — a **constant, never an inline literal**, and always namespaced by a session-derived `userId`, per [state-and-caching.md](../../docs/architecture/state-and-caching.md#cache-tags); the tag is invalidated by transaction, account, goal, and goal-contribution mutations and **not** by budget mutations, matching the [invalidation matrix](../../docs/architecture/state-and-caching.md#invalidation-matrix) — because `PlannedSavings` derives from goals, not budgets; a unit test asserts the `revalidateForTransactionChange` and goal-mutation helpers contain exactly the tags the matrix specifies, so the table cannot drift from the code without a failing test; **an integration test proves the number changes after a mutation**: read Safe to Spend, add an expense, read again, assert it decreased by exactly the expense amount; a further test asserts toggling `exclude_from_safe_to_spend` changes the figure | — |
| M7-B06 | shared | `[M7][SH] Add property tests for the documented invariants` | fast-check property tests in `tests/unit/safe-to-spend/invariants.test.ts` encoding all ten invariants from [the doc](../../docs/domain/safe-to-spend.md#invariants-for-property-tests): **the breakdown's terms sum to the total** (the single most important one — the UI can never contradict the headline), adding an expense never increases the total, adding income never decreases it, monotonicity in balance by exactly `δ`, excluded accounts have no effect, determinism, integrality (no fractional centavo can appear), horizon boundedness, dedupe idempotence, and band consistency (`red` ⟺ `total <= 0`); generators produce realistic ranges including negative balances, empty account sets, and zero-goal cases; each property runs a sufficient number of cases to be meaningful and the suite completes in seconds, since the functions are pure | — |
| M7-F01 | frontend | `[M7][FE] Build the Safe to Spend hero card` | Fills the slot reserved by [M4-F01](m4-dashboard-core.md) at the **top of the dashboard**, the most prominent element on the page per spec §9's UX requirement; shows the large formatted amount via `lib/utils/money.ts` with the profile currency; the status band renders as 🟢/🟡/🔴 **and as text**, so the state survives colour blindness and greyscale per [frontend-architecture.md](../../docs/architecture/frontend-architecture.md#safe-to-spend-has-specific-requirements); a subline in spec §32's voice for the positive state, in the register of *"Good news: future-you still has money."*; the horizon is stated plainly ("through 30 September") so the number's meaning is unambiguous; a Server Component receiving the computed result as props — **it performs no arithmetic**; loading shows a skeleton sized to the final content; AA contrast both themes; 360 px verified | — |
| M7-F02 | frontend | `[M7][FE] Build the Safe to Spend breakdown drawer` | Opens from the hero card and renders **all five terms in spec §9's arithmetic layout** — current balance, plus expected income, minus upcoming expenses, minus planned savings, minus debt payments, with a rule and the total — so the drawer visually mirrors the spec's own presentation; each term expands to list its **contributing items**, and each item **links to its source record** (a transaction, an account, a goal), which is what makes the number auditable rather than merely visible; a **real `<table>` with proper headers**, because arithmetic read aloud needs structure — not a div grid; the displayed terms are the ones `computeSafeToSpend` returned, never recomputed client-side, so the drawer cannot disagree with the headline; a term with no contributions shows an explicit zero row rather than being omitted, so all five lines of spec §9's identity are always present; keyboard navigable, focus trapped and restored, and axe passes | — |
| M7-F03 | frontend | `[M7][FE] Build the explainer and low-amount states` | A first-run explainer — a dismissible tooltip or inline note — explaining what Safe to Spend means and how it differs from the balance, since the concept is the product's core idea and an unexplained number invites mistrust; **distinct copy for the `<= 0` state** that is non-judgmental and **offers a next step**, linking to the timeline so the user can see what is coming rather than only being told they are short, per [frontend-architecture.md](../../docs/architecture/frontend-architecture.md#the-rule-that-matters-most) — no jokes at the user's expense, no alarm styling, state it once clearly; the amber state is factual and gently cautionary without alarm; a user with no accounts sees an explanation of what to add rather than a zero that looks like a real figure; every state verified at 360 px and against axe | — |
| M7-B07 | devops | `[M7][DO] Add the Safe to Spend E2E test` | Playwright `tests/e2e/safe-to-spend.spec.ts` seeded with **spec §9's exact scenario** — ₱42,000 across spendable accounts, ₱15,000 expected income, ₱18,500 of upcoming bills, a goal needing ₱10,000 this period, and a ₱5,000 credit-card minimum: assert the hero card displays **₱23,500** and a green band with the band text present → open the breakdown drawer and assert all five term rows show the spec's figures → click a contributing item and assert it navigates to that record → add a ₱2,000 expense dated within the horizon → assert the figure decreased to ₱21,500; a second test seeds a negative scenario and asserts the red band, the non-judgmental copy, and the link to the timeline; a third asserts an account toggled to excluded reduces the figure; **proves spec §31 Q5**, recorded in [../../docs/product/success-criteria.md](../../docs/product/success-criteria.md); flake-free over three consecutive runs | — |

## Demo script

Run on a preview deployment seeded with spec §9's scenario:

1. Sign in. The Safe to Spend card is the first thing visible.
2. Read the figure: **₱23,500**, green, with the horizon stated.
3. Open the breakdown. Walk the five terms against spec §9's arithmetic.
4. Expand "Upcoming expenses"; click Rent; land on the transaction.
5. Add a ₱2,000 expense. Return to the dashboard; the figure is ₱21,500.
6. Toggle the savings account to excluded and back; show the figure move.
7. Show a seeded negative scenario: red band, non-judgmental copy, timeline link.

## Notes

- **The breakdown is the feature, not a detail.** Spec §9 exists because a bare
  balance is unhelpful. A bare Safe to Spend number would be the same mistake
  with a different value —
  [why the result is a breakdown](../../docs/domain/safe-to-spend.md#why-the-result-is-a-breakdown-not-a-number).
- **Coverage floor is 95%**, above the 90% that applies elsewhere in `lib/core`.
  This is the number the product is named after.
- **The dedupe module is shared with [M8](m8-money-timeline.md)**, not
  reimplemented. Two implementations would drift, and the day they drift the
  timeline and the Safe to Spend card disagree in front of the user.
- **M7 depends on M2, M3, M5, and M6** — balances, transactions, the budget
  period, and goals. It does **not** block [M8](m8-money-timeline.md), so the two
  ⭐ differentiators can be built in parallel or independently.
- The MVP degradation path means no V2 dependency: future-dated transactions
  stand in for recurring occurrences, and the pure function cannot tell the
  difference.
