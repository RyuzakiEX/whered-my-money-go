# M8 — Money Timeline ⭐

**Goal.** The second differentiator: what happens to my money next. Spec §10's
tree is the target rendering, but the column the spec leaves implicit — the
**projected balance after each event** — is what turns a list of upcoming bills
into a forecast. From it falls the feature's real payoff: the **shortfall
date**, the first day the balance goes negative, visible in advance rather than
discovered on the day.

This milestone also builds the **recurrence engine** (spec §15), which is where
the hardest correctness work in the project lives: month-end clamping with
anchor preservation, and calendar-date arithmetic that never touches a UTC
instant. Both are specified in
[recurrence.md](../../docs/domain/recurrence.md).

**M8 does not depend on [M7](m7-safe-to-spend.md).** It needs accounts and
transactions only, so the two ⭐ features are independently shippable.

## Exit criteria

- [ ] Chronological event list from a `TODAY` anchor with a running projected balance
- [ ] **Spec §10's example reproduces exactly**, order and balances
- [ ] Shortfall date detected and surfaced
- [ ] Ordering is deterministic — shuffled input yields identical output
- [ ] Recurrence handles all five frequencies with **anchor-preserving month-end clamping**
- [ ] All calendar math in the user's timezone; no UTC instants
- [ ] A bill paid early appears **once** — dedupe shared with [M7](m7-safe-to-spend.md)
- [ ] Horizon 7/30/60/90 with an occurrence cap and truncation disclosed
- [ ] Coverage on `lib/core/timeline/**` and `lib/core/recurrence/**` is **≥ 95%**
- [ ] Spec §31 Q6 answerable in the UI

## Progress

| Done | ID | Title |
|---|---|---|
| [ ] | M8-B01 | `[M8][BE] Implement recurrence expansion in lib/core` |
| [ ] | M8-B02 | `[M8][BE] Implement buildMoneyTimeline in lib/core` |
| [ ] | M8-B03 | `[M8][BE] Implement shared occurrence dedupe` |
| [ ] | M8-B04 | `[M8][BE] Create recurring_transactions table and RLS` |
| [ ] | M8-B05 | `[M8][SH] Define recurring transaction schemas and domain types` |
| [ ] | M8-B06 | `[M8][BE] Implement the TimelineInput assembly query` |
| [ ] | M8-B07 | `[M8][BE] Implement recurring transaction Server Actions` |
| [ ] | M8-F01 | `[M8][FE] Build the timeline page` |
| [ ] | M8-F02 | `[M8][FE] Build timeline filters and horizon selector` |
| [ ] | M8-F03 | `[M8][FE] Build the shortfall warning and projected-balance chart` |
| [ ] | M8-F04 | `[M8][FE] Build the recurring transactions management screen` |
| [ ] | M8-F05 | `[M8][FE] Build the upcoming expenses dashboard widget` |
| [ ] | M8-B08 | `[M8][DO] Add the timeline E2E test` |

## Tasks

| ID | Stream | Title | Acceptance criteria | Issue |
|---|---|---|---|---|
| M8-B01 | backend | `[M8][BE] Implement recurrence expansion in lib/core` | `lib/core/recurrence/expand.ts` implements [recurrence.md](../../docs/domain/recurrence.md): `expandOccurrences(rule, from, to): CalendarDate[]`, pure, with **inclusivity stated and tested at both bounds**; all five spec §15 frequencies — weekly, biweekly, monthly, quarterly, yearly; **month-end clamping with anchor preservation**: an anchor of 31 yields Jan 31 → Feb 28 → **Mar 31**, not Mar 28, asserted by the canonical fixture `RECURRENCE_FIXTURE_MONTHEND_ANCHOR_31` — the anchor is preserved rather than degraded, which is the detail a plausible implementation gets wrong; **biweekly is anchored to `start_date`**, not "every other calendar week", with a test; **all arithmetic is on calendar dates in the user's timezone and never on UTC instants** — no `Date` object is constructed from a timestamp anywhere in the module, per [ADR-0003](../../docs/adr/0003-pure-typescript-domain-core.md), with a test that a rule evaluated for a `UTC+8` user does not shift by a day; exhaustive tests cover Feb 29 in leap and non-leap years, an anchor of 29 and 30 across February, a **DST-transition date** in a timezone that observes it, `end_date` inclusivity, and `is_active = false` producing no occurrences; the **occurrence cap** bounds output and sets a truncation flag; coverage ≥ 95% | — |
| M8-B02 | backend | `[M8][BE] Implement buildMoneyTimeline in lib/core` | `lib/core/timeline/build.ts` implements [money-timeline.md](../../docs/domain/money-timeline.md): `buildMoneyTimeline(input): TimelineResult`, pure, `today` injected; events sorted by a **total order** — date, then income before expense on the same date, then amount descending, then `sourceId` — so no tie is possible and shuffled input produces byte-identical output, asserted by `TIMELINE_FIXTURE_SHUFFLED`; **income-before-expense is deliberate**: it shows the balance rising then falling, avoiding a phantom dip that could display a spurious shortfall; the projected balance is a running integer fold seeded with the opening balance, exact over any number of events; `shortfallDate` is the **first** date the projection goes strictly below zero, with `TIMELINE_FIXTURE_EXACT_ZERO` asserting that hitting exactly zero is **not** a shortfall and `TIMELINE_FIXTURE_MULTI_CROSSING` asserting only the first crossing is reported; `minProjectedBalance` and `endingBalance` returned; events grouped by day with **empty days collapsed** and a `TODAY` anchor; own-account transfers excluded, **except** those into an excluded account; **the canonical fixture `TIMELINE_FIXTURE_SPEC_S10` reproduces spec §10's example exactly** — five events in the spec's order with projected balances 7_700_000, 6_200_000, 5_350_000, 6_550_000, 6_370_000 from a ₱42,000 opening; coverage ≥ 95% | — |
| M8-B03 | backend | `[M8][BE] Implement shared occurrence dedupe` | `lib/core/recurrence/dedupe.ts` exports `dedupeMaterialized(occurrences, actuals)` matching on `(recurring_transaction_id, periodKey(date, frequency))` where `periodKey` buckets by the rule's own frequency — `2026-09` monthly, `2026-W37` weekly — so "the September instance of rent" matches whether it was paid on the 9th, 12th, or 14th, per [recurrence.md](../../docs/domain/recurrence.md#deduplication); **this module is imported by both the timeline and [M7](m7-safe-to-spend.md)'s Safe to Spend input assembly, never reimplemented** — a comment in the module states why: two implementations would drift, and the day they drift the two dashboard figures contradict each other in front of the user; unit tests cover the bill-paid-early case (counted once), the multiple-actuals-in-one-period case (one occurrence dropped, both actuals stand because both are real money that really left), an actual with no matching rule (untouched), idempotence, and an occurrence outside every actual's period (retained); coverage ≥ 95% | — |
| M8-B04 | backend | `[M8][BE] Create recurring_transactions table and RLS` | Migration creates enum `recurrence_frequency` with `weekly`, `biweekly`, `monthly`, `quarterly`, `yearly` — spec §15's list exactly; `public.recurring_transactions` has `id`, `user_id` (FK cascade), `account_id` (FK restrict), `category_id` (FK set null), `amount_minor bigint not null check (amount_minor > 0)`, `currency char(3) not null`, `type transaction_type not null` restricted to `income` or `expense` by a check — a recurring transfer is out of scope and the check records that, `frequency recurrence_frequency not null`, `start_date date not null`, `next_date date not null`, `end_date date`, `is_active boolean not null default true`, `description text`, timestamps with trigger — spec §15's fields plus `end_date` and `is_active`, both marked additive infrastructure in [data-model.md](../../docs/architecture/data-model.md); a check enforces `end_date is null or end_date >= start_date`; index on `(user_id, next_date) where is_active`; RLS enabled and forced with four `*_own` policies whose `with check` also asserts **account and category ownership** per [rls-policies.md](../../docs/architecture/rls-policies.md#cross-table-ownership); `supabase/tests/rls/recurring_test.sql` uses `assert_user_isolated` and adds the foreign-account and foreign-category insert cases, both of which **must fail** | — |
| M8-B05 | shared | `[M8][SH] Define recurring transaction schemas and domain types` | **`type:contract`, blocks M8-F01..F05.** `lib/validation/recurring.ts` exports `.strict()` schemas; amount parses from decimal text to minor units via the shared parser; `start_date` and optional `end_date` validated as calendar dates with `end_date >= start_date` as a refinement; frequency constrained to the enum; a refinement rejects `type = 'transfer'`; domain types `RecurringRule`, `TimelineEvent`, `TimelineDay`, `TimelineResult`, and `CalendarDate` added to `lib/core/types.ts`, with `CalendarDate` a distinct branded string type rather than a bare `string` so a UTC instant cannot be passed where a calendar date is expected — the type system enforcing the rule [recurrence.md](../../docs/domain/recurrence.md#the-timezone-rule) describes; the horizon type is a union of `7`, `30`, `60`, `90` so an arbitrary value cannot reach the cap logic; unit tests cover the boundaries | — |
| M8-B06 | backend | `[M8][BE] Implement the TimelineInput assembly query` | `lib/server/queries/timeline.ts` assembles the input: the opening spendable balance at `today` (excluding future-dated transactions and excluded accounts, matching [M7-B03](m7-safe-to-spend.md)), future-dated transactions in the horizon, and **recurring occurrences expanded then deduplicated** via [M8-B03](#tasks); horizons 7/30/60/90 only, throwing on anything else; a **hard cap** on expanded occurrences bounds CPU — expansion is the most expensive thing the app does per request, per [system-architecture.md](../../docs/architecture/system-architecture.md#performance-and-scale) — with truncation dropping the **latest** events and never the earliest, and the flag surfaced so the UI can disclose it; the horizon resolves from the **user's timezone**; results cached under the `timeline` tag, invalidated per the [matrix](../../docs/architecture/state-and-caching.md#invalidation-matrix); a single query set with constant query count, asserted by a test; integration tests assert the assembled input and the resulting order and balances against the deterministic [M4-B04](m4-dashboard-core.md) seed, which includes a bill-paid-early case, and that a second user's data never appears | — |
| M8-B07 | backend | `[M8][BE] Implement recurring transaction Server Actions` | `createRecurring`, `updateRecurring`, `pauseRecurring`, `resumeRecurring`, `deleteRecurring`; each derives `user_id` from the session and re-verifies account and category ownership server-side even though RLS also enforces it; **`next_date` is recomputed from the rule on every create and edit** via [M8-B01](#tasks) rather than trusted from input, with a test that a client-supplied `next_date` is ignored — it is a cache of the rule, not the truth, per [recurrence.md](../../docs/domain/recurrence.md#the-next_date-field-is-a-cache-not-the-truth); pausing sets `is_active = false` and the rule produces no occurrences while paused, with a test; deleting a rule leaves already-materialised transactions intact, since they are real history — with a test, and the confirmation copy says so; writes use an explicit column allowlist; mutations revalidate `recurring`, `dashboard`, `sts`, and `timeline`; integration tests cover each action, the ignored `next_date`, and a cross-user `account_id` returning **not-found rather than forbidden** | — |
| M8-F01 | frontend | `[M8][FE] Build the timeline page` | `(app)/timeline` renders a `TODAY` anchor row carrying the opening balance, then day groups in chronological order with **empty days collapsed**, visually mirroring spec §10's tree — a vertical spine with dated nodes; each event shows its label, its signed amount with an explicit `+`/`−` **and** a semantic colour, and **the projected balance after it**, which is the column that makes this a forecast rather than a calendar; recurring events are marked distinctly from one-off scheduled ones and link to their rule; each event links to its source record; a per-day end-of-day balance is shown on the group header; truncation, when it occurs, is **disclosed** rather than silently ending the list; a Server Component receiving the computed result as props — it performs no arithmetic and does no sorting; empty state in spec §32's voice; AA contrast both themes; 360 px verified with the spine and balances still legible | — |
| M8-F02 | frontend | `[M8][FE] Build timeline filters and horizon selector` | A horizon selector offering 7/30/60/90 days, defaulting to 30; filters by account, category, and direction; **all state reflected in URL search params** so a view is shareable and the back button works, Zod-validated on read with a **fallback to the default rather than a throw** when hand-edited, per [state-and-caching.md](../../docs/architecture/state-and-caching.md#url-as-view-state); **a filtered projection is explicitly labelled as filtered** — filtering to expenses only produces a monotonically falling line that is not the user's real forecast, and presenting it unlabelled would read as a prediction, per [money-timeline.md](../../docs/domain/money-timeline.md#filtering); an active-filter summary with one-click clear; changing a filter re-queries server-side against RLS-scoped data with no client-side filtering | — |
| M8-F03 | frontend | `[M8][FE] Build the shortfall warning and projected-balance chart` | When `shortfallDate` is non-null, a prominent but **non-alarming** banner names the date and the amount by which the balance goes negative, and **offers a next step** — the largest upcoming outflow before that date, linked — because a verdict without an action is not useful, per [frontend-architecture.md](../../docs/architecture/frontend-architecture.md#the-rule-that-matters-most); the copy is non-judgmental in spec §32's register; when there is no shortfall, a quiet positive line in the register of *"Good news: future-you still has money."*; a small projected-balance line chart in `components/charts/projected-balance-chart.tsx` — the only place the chart library is imported — with the zero line marked and the shortfall point highlighted, an accessible fallback table, `role="img"` with a summarising label, and `prefers-reduced-motion` respected; the chart consumes the computed series and derives nothing | — |
| M8-F04 | frontend | `[M8][FE] Build the recurring transactions management screen` | `(app)/settings/recurring` (or a section of the timeline page) lists rules with amount, frequency, next date, account, and category; create and edit dialogs offer a frequency picker and **a preview of the next three to five occurrences computed from the rule**, so the user can confirm that "monthly on the 31st" behaves as they expect before saving — this preview is where anchor-preserving clamping becomes visible and trustworthy; pause and resume controls with the paused state clearly indicated; delete confirmation states that already-recorded transactions are kept; spec §15's examples (salary, rent, internet, Netflix, insurance) are usable as one-tap templates for common rules; keyboard accessible, focus managed, axe passes | — |
| M8-F05 | frontend | `[M8][FE] Build the upcoming expenses dashboard widget` | Fills the slot reserved by [M4-F05](m4-dashboard-core.md); shows the next few upcoming commitments per spec §8 with dates and amounts, linking to the timeline; if a shortfall falls within the default horizon, the widget surfaces it compactly rather than hiding it behind a click; excludes actuals, which belong to [M4-F04](m4-dashboard-core.md)'s recent-transactions widget; a user with nothing upcoming sees a short positive line rather than an empty box | — |
| M8-B08 | devops | `[M8][DO] Add the timeline E2E test` | Playwright `tests/e2e/timeline.spec.ts` seeded with **spec §10's exact scenario** — ₱42,000 opening, salary +₱35,000 on the 10th, rent −₱15,000 on the 12th, credit card −₱8,500 on the 15th, freelance +₱12,000 on the 20th, internet −₱1,800 on the 25th: assert the five events appear in that order and that each row shows the expected projected balance, ending at ₱63,700 → assert no shortfall banner → change the horizon to 7 days and assert only the first event remains; a second test seeds a shortfall scenario and asserts the banner names the correct date and offers the linked next step; a third asserts a bill paid early appears **once**; a fourth asserts a recurring rule anchored on the 31st previews Feb 28 and Mar 31 in the management screen; **proves spec §31 Q6**, recorded in [../../docs/product/success-criteria.md](../../docs/product/success-criteria.md); flake-free over three consecutive runs | — |

## Demo script

Run on a preview deployment seeded with spec §10's scenario:

1. Open `(app)/timeline`. Show the `TODAY` anchor and the five events in order.
2. Walk the projected balance column: ₱42,000 → ₱77,000 → ₱62,000 → ₱53,500 →
   ₱65,500 → ₱63,700.
3. Switch the horizon to 7 days, then 90. Show the list and chart change.
4. Filter to outflows only; point out the "filtered" label.
5. Show a seeded shortfall scenario: the banner, the date, the linked next step.
6. Open the recurring management screen. Create a monthly rule anchored on the
   31st; show the preview yielding Feb 28 and **Mar 31**.
7. Pause it; show it drop out of the timeline.
8. Show the dashboard upcoming-expenses widget.

## Notes

- **The projected balance column is the feature.** Spec §10's tree omits it; a
  list of upcoming bills without a running balance is a calendar, not a forecast.
- **Anchor-preserving clamping is the subtle correctness case.** Jan 31 → Feb 28
  → **Mar 31**. An implementation that degrades the anchor to 28 looks correct
  for two months and is then wrong forever —
  [recurrence.md](../../docs/domain/recurrence.md#month-end-clamping-with-anchor-preservation).
- **Calendar dates, never UTC instants.** The branded `CalendarDate` type in
  [M8-B05](#tasks) makes the type system enforce what the doc asks for. This is
  the single most common bug class in budgeting apps.
- **[M8-B03](#tasks) is shared with [M7](m7-safe-to-spend.md).** Whichever
  milestone lands first writes it; the second imports it. Do not reimplement.
- **M8 does not depend on M7.** Both ⭐ features need only accounts and
  transactions, so they are parallelizable — and if only one can ship, that is a
  real choice rather than a forced sequence.
