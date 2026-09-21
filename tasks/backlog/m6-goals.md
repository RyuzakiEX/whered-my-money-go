# M6 — Savings Goals

**Goal.** Create goals, contribute to them, and see both progress and a
projected completion date — making spec §31 Q8 and Q9 answerable. Two design
decisions carry weight: **`current_amount` is derived from contributions rather
than stored** (spec §22 lists it as a column; a stored running total drifts from
the contribution ledger exactly as a stored account balance does), and the
projection must handle the honest-but-awkward case where the observed
contribution rate is zero — *"at this rate, never"* — rather than showing a date
far in the future or crashing.

M6 also produces the `PlannedSavings` term that [M7](m7-safe-to-spend.md)
consumes, so its contract matters beyond this milestone.

## Exit criteria

- [ ] A user can create, edit, and delete goals, and add contributions
- [ ] `current_amount` is derived from contributions, never stored
- [ ] Spec §13's `₱35,000 / ₱100,000` format renders faithfully
- [ ] Required monthly contribution updates live while editing a goal
- [ ] Projected completion date is shown, including the "never at this rate" case
- [ ] pgTAP proves contribution policies check goal ownership transitively
- [ ] `PlannedSavings` is exported in the shape [M7](m7-safe-to-spend.md) needs
- [ ] Goals widget appears on the dashboard per spec §8
- [ ] Spec §31 Q8 and Q9 answerable in the UI

## Progress

| Done | ID | Title |
|---|---|---|
| [ ] | M6-B01 | `[M6][BE] Create goals and goal_contributions tables` |
| [ ] | M6-B02 | `[M6][BE] Add RLS with transitive goal ownership for contributions` |
| [ ] | M6-B03 | `[M6][SH] Define goal Zod schemas and domain types` |
| [ ] | M6-B04 | `[M6][BE] Implement goal progress and projection in lib/core` |
| [ ] | M6-B05 | `[M6][BE] Implement PlannedSavings for Safe to Spend` |
| [ ] | M6-B06 | `[M6][BE] Implement goal queries and Server Actions` |
| [ ] | M6-F01 | `[M6][FE] Build the goals page with progress cards` |
| [ ] | M6-F02 | `[M6][FE] Build the create and edit goal dialog` |
| [ ] | M6-F03 | `[M6][FE] Build the contribution flow and dashboard widget` |
| [ ] | M6-B07 | `[M6][DO] Add the goal creation and contribution E2E test` |

## Tasks

| ID | Stream | Title | Acceptance criteria | Issue |
|---|---|---|---|---|
| M6-B01 | backend | `[M6][BE] Create goals and goal_contributions tables` | Migration creates enum `goal_status` with `active`, `completed`, `abandoned`; `public.goals` has `id`, `user_id` (FK cascade), `name text not null` with a non-empty check and max length, `target_amount_minor bigint not null check (target_amount_minor > 0)`, `target_date date` (nullable — a goal without a deadline is valid), `status goal_status not null default 'active'`, `priority integer not null default 0` for ordering, `created_at`, `updated_at` with trigger; `public.goal_contributions` has `id`, `goal_id uuid not null references goals(id) on delete cascade`, `user_id` (FK cascade, denormalised so RLS can filter without a join on the hot path), `amount_minor bigint not null check (amount_minor > 0)`, `occurred_on date not null`, `transaction_id uuid references transactions(id) on delete set null` — nullable, because a contribution may be recorded without a matching money movement; **`goals.current_amount` is deliberately absent** — it is derived as `sum(amount_minor)` over contributions, and a migration comment records why, matching the [account balance decision](../../docs/architecture/data-model.md#derived-views); unique index on `(user_id, lower(name))`; indexes on `(user_id, status)` and `goal_contributions(goal_id, occurred_on)`; migration replays cleanly twice and [data-model.md](../../docs/architecture/data-model.md) is updated in the same PR | — |
| M6-B02 | backend | `[M6][BE] Add RLS with transitive goal ownership for contributions` | RLS enabled and forced on both tables; `goals` gets four `*_own` policies on `user_id = auth.uid()` with matching `with check`; `goal_contributions` policies assert **both** `user_id = auth.uid()` **and** `exists (select 1 from goals g where g.id = goal_id and g.user_id = auth.uid())` — the transitive case of the [cross-table ownership rule](../../docs/architecture/rls-policies.md#cross-table-ownership); where a contribution carries a `transaction_id`, the policy also asserts that transaction belongs to the session user, so a contribution cannot be linked to a stranger's transaction; `supabase/tests/rls/goals_test.sql` calls `assert_user_isolated` from [M1-B03](m1-auth-and-profile.md) for both tables and adds the explicit cases: user B contributing to user A's goal **must fail**, and user B linking a contribution to user A's transaction **must fail**; pgTAP passes in CI | — |
| M6-B03 | shared | `[M6][SH] Define goal Zod schemas and domain types` | **`type:contract`, blocks M6-F01..F03.** `lib/validation/goals.ts` exports `.strict()` schemas for goal create/update and contribution create; amounts parse from decimal text to integer minor units via the shared parser from [M3-B05](m3-transactions-and-categories.md); `target_date` is optional and, when present, validated as a calendar date within a sane bound; a target date in the past is **accepted** — a user may legitimately be behind — and is surfaced by the projection rather than rejected at the boundary; domain types `Goal`, `GoalProgress`, `GoalProjection`, and `PlannedSavingsEntry` are added to `lib/core/types.ts`, with `GoalProjection` shaped to carry the "never at this rate" outcome explicitly rather than as a magic date, per [goal-projection.md](../../docs/domain/goal-projection.md); unit tests cover the boundaries | — |
| M6-B04 | backend | `[M6][BE] Implement goal progress and projection in lib/core` | `lib/core/goals/` implements [goal-projection.md](../../docs/domain/goal-projection.md): `currentAmountMinor` as the contribution sum, `percentComplete`, `remainingMinor`, `requiredMonthlyContributionMinor = (target − current) / monthsUntil(targetDate)` rounding half-up per [money-and-rounding.md](../../docs/domain/money-and-rounding.md), and `projectedCompletionDate` from the observed average contribution rate over a trailing window; **the four outcomes are modelled explicitly** — on track, behind, already complete, and *"at this rate, never"* when the observed rate is not positive, which returns `null` rather than a far-future date, with a test; unit tests cover a zero contribution rate, a goal already at or past its target, a target date in the past, a goal with no target date (required monthly contribution is `null`, projection still computable from the rate), a single contribution, a target of exactly the current amount, and the month-boundary case where `monthsUntil` would round to zero (guarded, no division by zero); pure with `today` injected; coverage ≥ 90% | — |
| M6-B05 | backend | `[M6][BE] Implement PlannedSavings for Safe to Spend` | `lib/core/goals/planned-savings.ts` exports the term [M7](m7-safe-to-spend.md) consumes: for each active goal, `max(0, requiredMonthlyContributionMinor − contributedThisPeriodMinor)`; **the `max(0, …)` is applied per goal, not to the sum** — a test asserts that over-funding one goal does not reduce the requirement of another, because that money is earmarked separately, per [safe-to-spend.md](../../docs/domain/safe-to-spend.md#plannedsavings); goals that are completed, abandoned, already met, or past their target date contribute exactly `0`, each with a test; a goal with no target date contributes `0`, since there is no monthly requirement to derive — documented, because the alternative (inventing one) would silently reduce the user's Safe to Spend; returns per-goal entries carrying the goal id and label so [M7-F02](m7-safe-to-spend.md)'s breakdown drawer can attribute each line to its source; unit tests cover the empty case, a single goal, mixed statuses, and the over-funded case; coverage ≥ 90% | — |
| M6-B06 | backend | `[M6][BE] Implement goal queries and Server Actions` | `lib/server/queries/goals.ts` lists goals **with derived current amounts and projections** in a single query set — a test asserts constant query count regardless of goal or contribution count; `createGoal`, `updateGoal`, `deleteGoal`, and `addContribution` in `lib/server/actions/goals.ts`; each derives `user_id` from the session and re-verifies ownership server-side; `addContribution` optionally links a `transaction_id` and **verifies that transaction belongs to the session user** even though RLS also enforces it; reaching or exceeding the target sets `status = 'completed'` automatically, with a test, and a later negative adjustment reopens it; deleting a goal cascades its contributions, and the confirmation surfaces how many will be removed; mutations revalidate `goals`, `dashboard`, and **`sts`** — because `PlannedSavings` feeds Safe to Spend — plus `accounts` and `transactions` when a contribution is linked to a transaction, per the matrix in [state-and-caching.md](../../docs/architecture/state-and-caching.md#invalidation-matrix); integration tests cover the happy paths, the auto-complete transition, and a cross-user goal id returning **not-found rather than forbidden** | — |
| M6-F01 | frontend | `[M6][FE] Build the goals page with progress cards` | `(app)/goals` renders one card per goal in **spec §13's exact format** — `₱35,000 / ₱100,000` — with a progress ring or bar; shows the target date and the **projected completion date** side by side so being ahead or behind is visible without arithmetic; the *"at this rate, never"* outcome gets its own explicit copy rather than a blank or a nonsense date, in spec §32's non-judgmental register; percent complete shown numerically as well as graphically; completed goals are visually distinct and can be collapsed; goals ordered by `priority` then creation; a quick-contribute control on each card; empty state prompting the first goal in spec §32's voice; components receive computed progress and projections as props and perform no arithmetic; AA contrast both themes; 360 px verified with touch targets ≥ 44 px | — |
| M6-F02 | frontend | `[M6][FE] Build the create and edit goal dialog` | One dialog for both modes; fields for name, target amount, optional target date, and priority; **the required monthly contribution updates live as the user types** the amount or changes the date, so the user sees the commitment they are taking on before saving — this is the dialog's main value and it reads from [M6-B04](#tasks) via a server call or a client-safe pure helper, never by recomputing money math in the component; a target date in the past is accepted with an inline explanation that the goal will show as behind rather than being rejected; the duplicate-name constraint error surfaces against the name field; delete confirmation names the goal and its contribution count; keyboard accessible, focus trapped and restored, axe passes | — |
| M6-F03 | frontend | `[M6][FE] Build the contribution flow and dashboard widget` | A quick-contribute sheet from the goal card taking an amount, a date defaulting to today, and an **optional account** — selecting one records a linked transaction so the money movement is real rather than notional, and the copy makes that distinction clear; without an account it records a contribution only; optimistic insert shows the contribution immediately and rolls back preserving input on failure, while the derived progress ring shows a skeleton rather than an optimistic guess, per [state-and-caching.md](../../docs/architecture/state-and-caching.md#optimistic-ui); the dashboard widget fills the slot reserved by [M4-F05](m4-dashboard-core.md), showing active goals with progress per spec §8 and linking to the goals page; reaching a target shows a celebratory state in spec §32's playful register — this is the one place unreserved warmth is appropriate | — |
| M6-B07 | devops | `[M6][DO] Add the goal creation and contribution E2E test` | Playwright `tests/e2e/goals.spec.ts`: create a goal named "Japan Trip" with a ₱120,000 target and a date six months out → assert the card shows `₱0.00 / ₱120,000.00` and a required monthly contribution of ₱20,000 → add a ₱42,000 contribution → assert the card shows `₱42,000.00 / ₱120,000.00`, that percent complete is 35%, and that a projected completion date is displayed → assert the dashboard widget lists the goal with the same figures; a second test creates a goal, adds no contributions, and asserts the "at this rate, never" copy appears rather than a date; a third asserts contributing past the target marks the goal completed; **proves spec §31 Q8 and Q9**, recorded in [../../docs/product/success-criteria.md](../../docs/product/success-criteria.md); flake-free over three consecutive runs | — |

## Demo script

Run on a preview deployment:

1. Open `(app)/goals`. Create spec §13's three goals: Emergency Fund ₱100,000,
   Japan Trip ₱120,000, New Laptop ₱70,000.
2. While typing the Japan Trip target and date, point out the required monthly
   contribution updating live.
3. Add contributions to reach spec §13's figures — ₱35,000, ₱42,000, ₱25,000.
4. Show the cards in the spec's `saved / target` format with progress rings and
   projected dates.
5. Create a fourth goal, add nothing, and show the "at this rate, never" copy.
6. Contribute past a small goal's target; show it auto-complete.
7. Go to the dashboard; show the goals widget.
8. Note that Safe to Spend will consume these goals' remaining contributions in
   [M7](m7-safe-to-spend.md).

## Notes

- **`current_amount` is derived, not stored.** Spec §22 lists it as a column;
  storing it would drift from the contribution ledger the same way a stored
  account balance drifts from the transaction ledger. Same decision, same
  reasoning — [data-model.md](../../docs/architecture/data-model.md#derived-views).
- **[M6-B05](#tasks) is a dependency of [M7](m7-safe-to-spend.md).** Its
  per-goal `max(0, …)` behaviour is easy to get subtly wrong by applying the
  floor to the sum, and the consequence is a Safe to Spend figure that is quietly
  too high.
- The *"at this rate, never"* case is not an error state. It is the honest answer
  for a goal receiving no contributions, and spec §32's non-judgmental
  requirement applies — the user does not need to be told off for it.
- M6 is independent of [M4](m4-dashboard-core.md) and [M5](m5-budgets.md) once
  [M3](m3-transactions-and-categories.md) lands.
