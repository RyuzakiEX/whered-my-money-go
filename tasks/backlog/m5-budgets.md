# M5 — Budgets

**Goal.** Monthly per-category spending limits with visible progress and
warnings, so spec §31 Q7 — "am I staying within my budget?" — is answerable at a
glance. Spec §11's four-row example is the target rendering, and note that **two
of its four rows are already over budget**: over-budget states are the normal
condition of a real budget, not an edge case to handle later. `remaining` is
allowed to be negative and is never clamped, because that negative is the
overspend and it is the thing the user most needs to see.

Budget *forecasting* (spec §12) is V2. The status bands and the module structure
are built here so V2 slots the projection in without changing the UI contract —
see [budget-forecasting.md](../../docs/domain/budget-forecasting.md).

## Exit criteria

- [ ] A user can create, edit, and delete monthly category budgets
- [ ] Progress reflects actual spend and updates immediately after a matching expense
- [ ] Spec §11's four-row example renders faithfully, including the two over-budget rows
- [ ] Only expense-type categories can be budgeted, enforced in the database
- [ ] One budget per category per period, enforced by a unique constraint
- [ ] pgTAP proves a user cannot budget against another user's category
- [ ] Warning thresholds fire and surface on the dashboard in spec §32's voice
- [ ] "Copy last month's budgets" works
- [ ] Spec §31 Q7 answerable in the UI

## Progress

| Done | ID | Title |
|---|---|---|
| [ ] | M5-B01 | `[M5][BE] Create budget_period enum and budgets table` |
| [ ] | M5-B02 | `[M5][BE] Add RLS with category ownership for budgets` |
| [ ] | M5-B03 | `[M5][SH] Define budget Zod schemas and domain types` |
| [ ] | M5-B04 | `[M5][BE] Implement budget progress computation in lib/core` |
| [ ] | M5-B05 | `[M5][BE] Implement budget queries and Server Actions` |
| [ ] | M5-B06 | `[M5][BE] Implement copy-last-month and period rollover` |
| [ ] | M5-F01 | `[M5][FE] Build the budget page with progress bars` |
| [ ] | M5-F02 | `[M5][FE] Build the create and edit budget dialog` |
| [ ] | M5-F03 | `[M5][FE] Build the dashboard budget-health widget` |
| [ ] | M5-B07 | `[M5][DO] Add the budget progress E2E test` |

## Tasks

| ID | Stream | Title | Acceptance criteria | Issue |
|---|---|---|---|---|
| M5-B01 | backend | `[M5][BE] Create budget_period enum and budgets table` | Migration creates enum `budget_period` with `monthly` — the only MVP value, but an enum rather than a boolean so weekly and yearly can be added without a type change; `public.budgets` has `id`, `user_id` (FK cascade), `category_id uuid not null references categories(id) on delete cascade`, `amount_minor bigint not null check (amount_minor > 0)` — a zero budget is rejected because it makes `percentUsed` undefined, per [../../docs/domain/budget-forecasting.md](../../docs/domain/budget-forecasting.md#edge-cases), `period budget_period not null default 'monthly'`, `period_start date not null`, `created_at`, `updated_at` with trigger; a unique index enforces `(user_id, category_id, period_start)` so a category cannot be budgeted twice in one period; a **database-level check enforces that the referenced category is expense-type** — implemented as a trigger or a validating constraint, since a plain FK cannot express it — with a test asserting an attempt to budget an income category fails; `period_start` is constrained to the first day of a month while `period` is `monthly`; index on `(user_id, period_start)`; migration replays cleanly twice and [data-model.md](../../docs/architecture/data-model.md) is updated in the same PR | — |
| M5-B02 | backend | `[M5][BE] Add RLS with category ownership for budgets` | RLS enabled and forced; four `*_own` policies; `insert` and `update` `with check` assert **both** `user_id = auth.uid()` **and** `exists (select 1 from categories c where c.id = category_id and c.user_id = auth.uid())` — the cross-table ownership case from [rls-policies.md](../../docs/architecture/rls-policies.md#cross-table-ownership), because a policy checking only `user_id` would let a user budget against a stranger's category; `supabase/tests/rls/budgets_test.sql` calls `assert_user_isolated` from [M1-B03](m1-auth-and-profile.md) and adds the explicit case: user B inserting a budget with their own `user_id` but user A's `category_id` **must fail**; a test also asserts that an update cannot re-point a budget at a foreign category; pgTAP passes in CI | — |
| M5-B03 | shared | `[M5][SH] Define budget Zod schemas and domain types` | **`type:contract`, blocks M5-F01..F03.** `lib/validation/budgets.ts` exports `.strict()` schemas; the amount accepts decimal text and parses to integer minor units via the shared parser from [M3-B05](m3-transactions-and-categories.md), rejecting zero and negative values with messages the UI can show against the field; `period_start` is validated as the first day of a month; domain types `Budget`, `BudgetProgress`, and `BudgetStatus` are added to `lib/core/types.ts`, with `BudgetProgress` shaped so [budget-forecasting.md](../../docs/domain/budget-forecasting.md#function-contract)'s `BudgetForecast` can extend it in V2 without a breaking change to components shipped here; unit tests cover the boundary cases | — |
| M5-B04 | backend | `[M5][BE] Implement budget progress computation in lib/core` | `lib/core/budgets/progress.ts` exports `computeBudgetProgress` per [budget-forecasting.md](../../docs/domain/budget-forecasting.md#progress-mvp): returns `budgetMinor`, `spentMinor`, `remainingMinor`, `percentUsed`, `status`, `daysElapsed`, `daysRemaining`, `daysInPeriod`; **`remainingMinor` may be negative and is never clamped**, with a test; `daysElapsed` is **inclusive and is 1 on the first of the month**, never 0, with a test — a zero would divide by zero in the V2 estimator and understates a day of real spending; `daysInPeriod` is the **real length of the real month**, with tests for a 28-, 29-, 30-, and 31-day month, because a hardcoded 30 over-forecasts every February by ~7%; MVP statuses are `on_track`, `at_risk` (at `percentUsed >= 90`), and `exceeded` (actual over budget), with `exceeded` **outranking** everything since it is the only status based on fact rather than projection; **a unit test reproduces spec §11's four-row example exactly** — Food 720000/1000000 `on_track`, Transportation 480000/400000 `exceeded`, Entertainment 210000/300000 `on_track`, Shopping 540000/500000 `exceeded` — as the canonical fixture `BUDGET_FIXTURE_SPEC_S11`; transfers and future-dated transactions excluded from `spentMinor`, each with a test; a zero budget throws `InvalidBudgetError`; pure with `today` injected; coverage ≥ 90% | — |
| M5-B05 | backend | `[M5][BE] Implement budget queries and Server Actions` | `lib/server/queries/budgets.ts` lists budgets for a period **with their computed progress**, gathering the per-category spend in a single query set rather than one query per budget — a test asserts constant query count regardless of budget count; `createBudget`, `updateBudget`, `deleteBudget` in `lib/server/actions/budgets.ts` each derive `user_id` from the session, Zod-parse input, and **re-verify server-side that the category belongs to the session user and is expense-type** even though the database also enforces both; the unique-constraint violation is mapped to a friendly "you already have a budget for this category this month" rather than a constraint name; writes use an explicit column allowlist; mutations revalidate `budgets` and `dashboard` — and **not** `sts`, because Safe to Spend's `PlannedSavings` term comes from goals rather than budgets, per the matrix in [state-and-caching.md](../../docs/architecture/state-and-caching.md#invalidation-matrix); integration tests cover the happy path, the duplicate rejection, the income-category rejection, and a cross-user `category_id` attempt returning **not-found rather than forbidden** | — |
| M5-B06 | backend | `[M5][BE] Implement copy-last-month and period rollover` | A `copyBudgetsFromPeriod(fromPeriodStart, toPeriodStart)` action duplicating the source period's budgets into the target, **skipping any category already budgeted in the target** rather than failing the whole operation, and returning a count of copied and skipped so the UI can report it; runs in a single database transaction; ownership verified; idempotent — running it twice copies nothing the second time, with a test; the query layer resolves the "current period" from the user's **timezone**, not the server's, so a user in `Asia/Manila` sees the new month begin at their midnight rather than UTC's — with a test at a timezone boundary, per [recurrence.md](../../docs/domain/recurrence.md#the-timezone-rule); viewing a past period is read-only in the query layer's contract and a test asserts a budget cannot be created for a period more than one month ahead | — |
| M5-F01 | frontend | `[M5][FE] Build the budget page with progress bars` | `(app)/budget` renders one row per budgeted category in **spec §11's exact format** — `₱7,200 / ₱10,000` — with a progress bar; status is conveyed by **both** a semantic colour token and text, never colour alone; **over-budget rows render correctly from day one**, with the bar visually capped but the figures showing the true overspend and `remaining` shown as a negative — two of spec §11's four example rows are over budget, so this is the normal case; a period switcher allows viewing past periods, with past periods read-only; a total row sums budgets and spend; unbudgeted categories with spending this period are listed separately with a prompt to budget them, so the page does not silently omit spending; empty state in spec §32's voice; components receive computed progress as props and perform no arithmetic; AA contrast both themes; 360 px verified | — |
| M5-F02 | frontend | `[M5][FE] Build the create and edit budget dialog` | One dialog serving both modes so there is a single form implementation; the category picker lists **only expense-type categories** and **excludes categories already budgeted for the selected period**, so the unique-constraint error is unreachable through normal use — with the server error still handled for the race; the amount input accepts decimal text parsed by the shared [M5-B03](#tasks) schema; **suggests last month's amount for that category** when one exists, shown as a prefilled value the user can accept or change; shows the category's current period spend inline so the user is choosing a limit with context; delete offers confirmation naming the category and period; errors surface against the relevant field; keyboard accessible with focus trapped and restored, and axe passes | — |
| M5-F03 | frontend | `[M5][FE] Build the dashboard budget-health widget` | Fills the slot reserved by [M4-F05](m4-dashboard-core.md); lists categories that are `at_risk` or `exceeded`, ordered by severity, each linking to the budget page; shows nothing more than a compact "all budgets on track" line when none are at risk, so the widget is quiet when there is no news; copy follows spec §32's voice per band — at-risk uses the spec's own *"Hala. You're getting close to your shopping budget."*, and **exceeded is factual and never scolding**, in the register of *"You spent ₱2,400 on food. We won't judge."*; the exceeded state gets the most care because the user already knows they overspent, per [frontend-architecture.md](../../docs/architecture/frontend-architecture.md#brand-voice); a user with no budgets sees a prompt to create one rather than an empty box | — |
| M5-B07 | devops | `[M5][DO] Add the budget progress E2E test` | Playwright `tests/e2e/budget-progress.spec.ts` against the [M4-B04](m4-dashboard-core.md) seed: create a ₱10,000 Food budget → assert the row shows `₱0.00 / ₱10,000.00` and `on_track` → add a ₱9,200 Food expense → assert the row shows `₱9,200.00 / ₱10,000.00` and `at_risk` and that the dashboard widget now lists Food → add a further ₱1,000 expense → assert `exceeded`, that `remaining` displays as negative, and that the status text (not only the colour) changed; a second test asserts an income category is not offered in the picker, and a third asserts copy-last-month skips an already-budgeted category; **proves spec §31 Q7**, recorded in [../../docs/product/success-criteria.md](../../docs/product/success-criteria.md); flake-free over three consecutive runs | — |

## Demo script

Run on a preview deployment:

1. Open `(app)/budget`. Create budgets matching spec §11: Food ₱10,000,
   Transportation ₱4,000, Entertainment ₱3,000, Shopping ₱5,000.
2. Show the page rendering in the spec's `spent / limit` format.
3. Add expenses to reach spec §11's figures — including pushing Transportation
   and Shopping over budget.
4. Show the two over-budget rows with negative remaining and `exceeded` status.
5. Go to the dashboard; show the budget-health widget listing the at-risk and
   exceeded categories with the brand-voice copy.
6. Switch to last month; show it read-only.
7. Use "copy last month's budgets" and show the skipped-duplicate count.

## Notes

- **Over budget is the normal case.** Spec §11's own example has two of four
  categories over. Any design or test that treats it as an edge case is wrong.
- **`remaining` is never clamped to zero.** The negative is the information.
- The status band vocabulary here is deliberately the same one
  [budget-forecasting.md](../../docs/domain/budget-forecasting.md#status-bands)
  defines for V2, so adding the projection later changes no component contract
  and no copy.
- M5 is independent of [M4](m4-dashboard-core.md) and [M6](m6-goals.md) once
  [M3](m3-transactions-and-categories.md) lands, except for the dashboard widget
  slot.
