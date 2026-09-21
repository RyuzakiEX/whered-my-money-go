# V2 Roadmap — Outline

**Status: not scheduled.** These are sketches, not backlog items. Each names a
goal and representative tasks; none has acceptance criteria yet. They get
written up properly when a milestone is actually picked up — writing detailed
criteria now would be guessing at priorities that will have changed.

Source: spec §27. Ordering below is a suggestion, not a commitment.

> [!NOTE]
> **Much of V2 is cheaper than it looks**, because the MVP's domain layer was
> built for it. What-If needs no new math. Budget forecasting's estimators are
> already specified. Goal Impact is a diff of two existing function calls. That
> was the point of keeping `lib/core` pure
> ([ADR-0003](../../docs/adr/0003-pure-typescript-domain-core.md)).

---

## V2-M10 — Recurring Transactions & Upcoming Bills

**Goal.** Promote the recurrence engine built in [M8](m8-money-timeline.md) from
a timeline input to a first-class feature, and close the MVP's degradation path.

The engine, the schema, and the dedupe module already exist. What is missing is
the surrounding product.

- Bill reminders and notification hooks (feeds V2-M15)
- Mark-as-paid: materialise an occurrence into a real transaction in one tap
- Expected income as a first-class concept rather than a future-dated transaction
- Skip-this-occurrence without deleting the rule
- Rule editing that handles "from the next occurrence" versus "retroactively"
- **Retire the MVP substitution**: `ExpectedIncome` and `UpcomingExpenses` in
  [safe-to-spend.md](../../docs/domain/safe-to-spend.md#the-mvp-degradation-path)
  start reading recurring occurrences as originally specified — no signature
  change, only the query assembly

## V2-M11 — Budget Forecasting

**Goal.** Spec §12. Implement the projection specified in
[budget-forecasting.md](../../docs/domain/budget-forecasting.md).

Fully specified already, including the canonical fixture. The MVP shipped
`computeBudgetProgress`; this adds `forecastBudget` extending the same type, so
components shipped in [M5](m5-budgets.md) need no contract change.

- The blended estimator: `w × run-rate + (1 − w) × historical shape`,
  `w = min(1, daysElapsed / 10)`
- Historical shape needs ≥ 2 prior periods; fall back to run-rate
- Projected-versus-budget UI with the overrun figure
- **Confidence indicator** — a low-confidence projection must not render as a
  precise number, which is a UI requirement, not a nicety
- Forecast-aware status bands (`over` joins the MVP's `on_track` / `at_risk` /
  `exceeded`)

## V2-M12 — Goal Forecasting & Goal Impact

**Goal.** Spec §14. Connect a spending change to a goal's completion date.

Already specified in
[goal-projection.md](../../docs/domain/goal-projection.md#goal-impact) and
mostly implemented — `projectedCompletionDate` shipped in
[M6](m6-goals.md). Impact is a **diff of two calls** to the existing function.

- `goalImpact(baseline, perturbed)` returning a delta in days
- Surface it after a notable expense: *"your Japan Trip is now projected 9 days
  later"*, matching spec §14's shape
- Per-goal history of projected-date movement
- Tone care: this feature tells users their spending cost them time, and spec
  §32's non-judgmental requirement applies most sharply here

## V2-M13 — Monthly Insights

**Goal.** Spec §17. Explain what changed, automatically.

- A rule set over month-over-month aggregates: spending up, income down, a
  category shifted significantly, a budget exceeded, an unusual transaction, goal
  progress improved
- Each rule is a pure function over two periods' aggregates — testable, and it
  reuses [M4](m4-dashboard-core.md)'s aggregate module
- A monthly digest screen, and a dashboard summary line
- **Thresholds matter**: an insight that fires every month is noise. Significance
  should be relative to the user's own variance, not a fixed percentage
- Spec §17's example is the target register: a figure, then the largest
  contributor

## V2-M14 — What-If Scenarios ⭐

**Goal.** Spec §18. Simulate a financial decision before making it.

> **This needs no new math.** It is an input-override layer over the existing
> pure functions, re-run with perturbed inputs — which is exactly why
> [ADR-0003](../../docs/adr/0003-pure-typescript-domain-core.md) banned I/O from
> `lib/core`. See
> [goal-projection.md](../../docs/domain/goal-projection.md#why-what-if-needs-no-new-math).

- A scenario type describing overrides: extra monthly saving, a rent increase,
  an income change, a cancelled subscription, a one-off purchase
- Re-run `computeSafeToSpend`, `buildMoneyTimeline`, and the goal projections
  with the overridden input
- Side-by-side comparison UI — spec §18's "current plan / new plan" shape
- The `(app)/what-if` route, placeholder since [M0](m0-foundation.md), becomes real
- Spec §18's other scenarios: *can I afford this purchase?* is the highest-value
  one and should lead

## V2-M15 — Notifications

**Goal.** Spec §20.

- Preference management per notification type
- In-app notification centre
- Email delivery; push deferred to the PWA work in V3
- A scheduled evaluation job — the first background job in the system, so it
  needs its own decisions about where it runs and how it authenticates (one of
  the few legitimate `service_role` uses, per
  [security-model.md](../../docs/security/security-model.md))
- Spec §20's seven triggers, including low safe-to-spend and unusual spending
- **Restraint is the design constraint**: a finance app that notifies too often
  gets muted, and a muted app cannot warn about the thing that matters

## V2-M16 — Reports

**Goal.** Spec §16. Seven report types across six date ranges.

- Income, expenses, savings, cash flow, spending by category, monthly
  comparison, category trends
- Spec §16's six filter presets, already implemented for the transactions list
- CSV export
- The `(app)/reports` route, in the nav since [M0](m0-foundation.md), becomes real
- Largely a presentation layer over [M4](m4-dashboard-core.md)'s aggregates;
  the work is in the UI and in export formatting, not new math

## V2-M17 — CSV Import

**Goal.** Get existing history in, so a new user's dashboard is useful on day one.

- Column mapping with a preview
- **Dry-run first**: show what will be created before creating anything
- Duplicate detection against existing transactions
- Auto-create categories and accounts, or map to existing ones
- Amount parsing reusing the locale-safe parser from
  [M3-B05](m3-transactions-and-categories.md) — never `parseFloat`
- The riskiest V2 feature for data integrity: a bad import writes hundreds of
  wrong rows, so it needs an undo-the-whole-import capability

---

## Sequencing notes

- **V2-M10 unblocks V2-M11 and V2-M15.** Recurring data makes forecasting
  meaningful and notifications possible.
- **V2-M14 is cheap and high-visibility.** It is a spec §29 differentiator that
  reuses existing functions — a strong early candidate.
- **V2-M17 is high-risk.** Consider it after the notification and insight work,
  when the data model has settled.
- Nothing here changes the schema fundamentally except V2-M10's promotion of
  recurring transactions, which [M8](m8-money-timeline.md) already built.
