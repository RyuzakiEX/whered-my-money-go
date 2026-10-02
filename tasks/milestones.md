# Milestones

**Ten milestones from empty repository to production MVP, each ending in
something you can demo to a person who does not read code.** If a milestone
cannot be demonstrated, it was scoped wrong.

| | |
|---|---|
| **Scope authority** | [../docs/product/product-spec.md](../docs/product/product-spec.md) §26 |
| **Success authority** | [../docs/product/product-spec.md](../docs/product/product-spec.md) §31 |
| **Tracking** | GitHub Milestones (not labels) — see [labels.md](labels.md#milestones-are-not-labels) |

## Progress

> [!NOTE]
> Generated from the checkbox tables in each backlog file — tick a task there and regenerate, so this summary cannot drift from its source.

| ID | Milestone | | Tasks | | Status |
|---|---|---|---|---|---|
| **M0** | [Foundation & Toolchain](backlog/m0-foundation.md) | `█░░░░░░░░░` | 2/14 | 14% | in progress |
| **M1** | [Auth & Profile](backlog/m1-auth-and-profile.md) | `░░░░░░░░░░` | 0/13 | 0% | not started |
| **M2** | [Accounts](backlog/m2-accounts.md) | `░░░░░░░░░░` | 0/11 | 0% | not started |
| **M3** | [Transactions & Categories](backlog/m3-transactions-and-categories.md) | `░░░░░░░░░░` | 0/15 | 0% | not started |
| **M4** | [Dashboard Core](backlog/m4-dashboard-core.md) | `░░░░░░░░░░` | 0/10 | 0% | not started |
| **M5** | [Budgets](backlog/m5-budgets.md) | `░░░░░░░░░░` | 0/10 | 0% | not started |
| **M6** | [Savings Goals](backlog/m6-goals.md) | `░░░░░░░░░░` | 0/10 | 0% | not started |
| **M7** | [Safe to Spend ⭐](backlog/m7-safe-to-spend.md) | `░░░░░░░░░░` | 0/10 | 0% | not started |
| **M8** | [Money Timeline ⭐](backlog/m8-money-timeline.md) | `░░░░░░░░░░` | 0/13 | 0% | not started |
| **M9** | [MVP Hardening & Launch](backlog/m9-mvp-hardening-and-launch.md) | `░░░░░░░░░░` | 0/10 | 0% | not started |
| | **MVP total** | `░░░░░░░░░░` | **2/116** | **2%** | |

## Contents

- [Master table](#master-table)
- [Dependency graph](#dependency-graph)
- [The nine success questions](#the-nine-success-questions)
- [Exit criteria](#exit-criteria)
- [V2 and V3](#v2-and-v3)

## Master table

| ID | Milestone | Goal | Demoable outcome | Backlog |
|---|---|---|---|---|
| **M0** | Foundation & Toolchain | Repo runs, CI is real, gates enforce | `npm run dev` serves a shell; all CI jobs execute for real | [backlog/m0-foundation.md](backlog/m0-foundation.md) |
| **M1** | Auth & Profile | A user can exist, sign in, and own data | Sign up → empty dashboard → log out → log back in | [backlog/m1-auth-and-profile.md](backlog/m1-auth-and-profile.md) |
| **M2** | Accounts | Money has somewhere to live | Create Cash + Bank + GCash, see balances, edit, delete | [backlog/m2-accounts.md](backlog/m2-accounts.md) |
| **M3** | Transactions & Categories | The core data of the app exists | Add income + expense, categorize, search/filter, edit, delete | [backlog/m3-transactions-and-categories.md](backlog/m3-transactions-and-categories.md) |
| **M4** | Dashboard Core | The user can see where money went | Metric tiles, cash-flow chart, spending breakdown, recent transactions | [backlog/m4-dashboard-core.md](backlog/m4-dashboard-core.md) |
| **M5** | Budgets | The user can set and track limits | Monthly category budgets with progress bars and warnings | [backlog/m5-budgets.md](backlog/m5-budgets.md) |
| **M6** | Savings Goals | The user can save toward something | Create goal, contribute, see progress and projected date | [backlog/m6-goals.md](backlog/m6-goals.md) |
| **M7** | Safe to Spend ⭐ | Answer the question the product exists for | Prominent STS number with an explainable breakdown | [backlog/m7-safe-to-spend.md](backlog/m7-safe-to-spend.md) |
| **M8** | Money Timeline ⭐ | Show what happens to money next | Future events, projected balance, shortfall warning | [backlog/m8-money-timeline.md](backlog/m8-money-timeline.md) |
| **M9** | MVP Hardening & Launch | Ship it without regret | A11y, mobile, perf, security review, E2E suite, production deploy | [backlog/m9-mvp-hardening-and-launch.md](backlog/m9-mvp-hardening-and-launch.md) |

M7 and M8 are the differentiators (spec §29). Everything before them is table
stakes that exists so they can be built; everything in M9 exists so they can be
trusted.

## Dependency graph

```text
                                    ┌──────────────────┐
                                    │  M4  Dashboard   │
                                    └────────┬─────────┘
                                             │
  ┌────┐   ┌────┐   ┌────┐   ┌────┐   ┌──────┴───────┐   ┌────┐   ┌────┐
  │ M0 │──▶│ M1 │──▶│ M2 │──▶│ M3 │──▶│  M5 Budgets  │──▶│ M7 │──▶│ M9 │
  └────┘   └────┘   └────┘   └─┬──┘   └──────┬───────┘   └────┘   └─┬──┘
   base     auth    accounts   │      ┌──────┴───────┐    STS       │
                               │      │  M6  Goals   │              │
                               │      └──────────────┘              │
                               │                                    │
                               │      ┌──────────────┐              │
                               └─────▶│ M8  Timeline │─────────────▶┘
                                      └──────────────┘
                                       needs only M2 + M3

  M0 → M1 → M2 → M3 → { M4, M5, M6 } → M7 → M9
  M3 → M8 → M9                    (M8 does NOT depend on M7)
```

Three things this graph is saying:

- **M4, M5, and M6 run concurrently** once M3 lands. They read the same
  transaction data and write to disjoint tables, so there is no ordering
  constraint between them. Sequence them by whoever is free, not by ID.
- **M7 depends on M5 and M6** because Safe to Spend subtracts planned savings
  (goal contributions, spec §9) and reads budget context. It cannot be
  computed honestly before those exist.
- **M8 does not depend on M7.** The Money Timeline needs accounts (M2) and
  transactions (M3) and nothing else. Both differentiators are therefore
  **parallelizable across streams** — one backend engineer can build the
  recurrence engine for M8 while another builds the Safe to Spend computation
  for M7, and the two share only `lib/core/recurrence`'s occurrence-dedupe
  module ([M8-B03](backlog/m8-money-timeline.md)). That module is the one
  coordination point; agree its signature early and the milestones stay
  independent.

The hard serialization is only at the front: M0 → M1 → M2 → M3 is a chain
because each one's schema is the next one's foreign key.

## The nine success questions

Spec §31 defines MVP success as nine questions a user can answer quickly. Each
one is claimed by exactly one milestone and proven by exactly one E2E test, so
"is the MVP done?" reduces to "does the critical-path suite pass?"

| # | Question (spec §31) | Answerable after | E2E test that proves it |
|---|---|---|---|
| 1 | How much money do I have? | **M2** | `tests/e2e/accounts.spec.ts` — create three accounts with opening balances, assert each card's balance and the total ([M2-B07](backlog/m2-accounts.md)) |
| 2 | How much did I earn this month? | **M3** → **M4** | `tests/e2e/transactions.spec.ts` — record income, assert it appears in the list; `tests/e2e/dashboard.spec.ts` asserts the Monthly Income tile ([M3-B10](backlog/m3-transactions-and-categories.md), [M4-B05](backlog/m4-dashboard-core.md)) |
| 3 | How much did I spend? | **M3** → **M4** | `tests/e2e/transactions.spec.ts` — record expense, assert it appears; dashboard Monthly Expenses tile matches the sum ([M3-B10](backlog/m3-transactions-and-categories.md), [M4-B05](backlog/m4-dashboard-core.md)) |
| 4 | Where did my money go? | **M3** → **M4** | `tests/e2e/dashboard.spec.ts` — spending breakdown shows the seeded categories with shares summing to 100%, click-through lands on the filtered transaction list ([M4-B05](backlog/m4-dashboard-core.md)) |
| 5 | How much can I safely spend? | **M7** | `tests/e2e/safe-to-spend.spec.ts` — seed spec §9's scenario, assert ₱23,500, add an expense, assert the number drops ([M7-B06](backlog/m7-safe-to-spend.md)) |
| 6 | What bills are coming up? | **M8** | `tests/e2e/timeline.spec.ts` — assert event order, per-event projected balance, and the shortfall banner ([M8-B07](backlog/m8-money-timeline.md)) |
| 7 | Am I staying within my budget? | **M5** | `tests/e2e/budgets.spec.ts` — set a budget, record spending, assert the progress bar and status band update ([M5-B06](backlog/m5-budgets.md)) |
| 8 | How much have I saved? | **M6** | `tests/e2e/goals.spec.ts` — create a goal, add a contribution, assert saved amount and progress ([M6-B06](backlog/m6-goals.md)) |
| 9 | Am I on track for my savings goal? | **M6** | `tests/e2e/goals.spec.ts` — assert the projected completion date against the target date ([M6-B06](backlog/m6-goals.md)) |

[M9-B05](backlog/m9-mvp-hardening-and-launch.md) is the gate: it requires each
of these nine to be covered by an explicit assertion, the suite to run under
ten minutes, and three consecutive flake-free runs.

## Exit criteria

A milestone closes when every task issue in its GitHub Milestone is closed
**and** these hold. Per-task acceptance criteria live in the backlog files;
these are the milestone-level checks.

### M0 — Foundation & Toolchain

- [ ] `npm run verify` passes locally from a clean clone with no manual steps beyond `npm install` and `supabase start`
- [ ] Every CI job runs real work — no job is a placeholder or an unconditional `exit 0`
- [ ] The import-boundary lint fixture importing `lib/server` from `components/` fails lint, proving the rules are enforced and not aspirational
- [ ] `npm run dev` serves the authenticated shell with all nine sidebar items (spec §25)
- [ ] Branch protection blocks a direct push to `main`

### M1 — Auth & Profile

- [ ] Sign up → dashboard → log out → log back in works end-to-end against local Supabase and a preview deployment
- [ ] `profiles` has RLS with a passing pgTAP isolation test; the reusable "table is user-isolated" assertion exists and is used
- [ ] Auth error messages are uniform and do not reveal whether an email is registered
- [ ] Unauthenticated `(app)/**` redirects to `/login?next=…`; authenticated `(auth)/**` redirects to `/dashboard`; both directions have integration tests

### M2 — Accounts

- [ ] A user can create, view, edit, archive, and delete accounts; deleting an account with transactions is blocked and offers archive
- [ ] `account_balances` returns correct balances including both legs of transfers
- [ ] pgTAP proves user B cannot read or write user A's accounts
- [ ] Spec §31 Q1 is answerable in the UI

### M3 — Transactions & Categories

- [ ] Income, expense, and transfer all record correctly and move balances as expected
- [ ] Default categories from spec §7 are seeded exactly, idempotently, on profile creation
- [ ] The cross-table ownership pgTAP test passes: attaching a transaction to a **foreign** account fails
- [ ] Search, filter, and sort work with URL-reflected state and keyset pagination
- [ ] Spec §31 Q2, Q3, Q4 are answerable (Q4 partially — the breakdown lands in M4)

### M4 — Dashboard Core

- [ ] All four metric tiles render correct values with month-over-month deltas; the STS tile slot is reserved and visibly placeholdered
- [ ] Spending-breakdown shares sum to exactly 100% under largest-remainder rounding
- [ ] Dashboard aggregation is N+1-free and measured against the 5,000-transaction seed
- [ ] Transfers are excluded from income, expense, and savings aggregates

### M5 — Budgets

- [ ] Spec §11's four-row example reproduces exactly in a unit test and on screen in `₱7,200 / ₱10,000` form
- [ ] Budget status bands and warning copy match the brand voice (spec §32)
- [ ] Only expense-type categories can be budgeted, enforced in the database
- [ ] Spec §31 Q7 is answerable

### M6 — Savings Goals

- [ ] Create a goal, contribute, see progress and a projected completion date
- [ ] `current_amount` is derived from contributions, never stored — decision documented
- [ ] Contribution RLS checks goal ownership transitively, proven by pgTAP
- [ ] Spec §31 Q8, Q9 are answerable

### M7 — Safe to Spend ⭐

- [ ] Spec §9's worked example (₱42,000 + ₱15,000 − ₱18,500 − ₱10,000 − ₱5,000 → ₱23,500) passes as a fixture
- [ ] `lib/core/safe-to-spend` is pure with `today` injected, has property tests for the documented invariants, and ≥95% coverage
- [ ] The hero card shows the 🟢/🟡/🔴 band and the breakdown drawer explains every term with links to source records
- [ ] The number changes after a mutation, proven by an integration test on the cache tags
- [ ] Copy for the ≤ 0 state is non-judgmental (spec §32)
- [ ] Spec §31 Q5 is answerable

### M8 — Money Timeline ⭐

- [ ] All five frequencies (spec §15) expand correctly, including month-end clamping with anchor preservation, Feb 29, and DST-transition dates
- [ ] Spec §10's example timeline reproduces exactly as a fixture
- [ ] A bill paid early is counted once, proven by a dedupe test in the module shared with Safe to Spend
- [ ] Timeline renders day-grouped events with a running projected balance and a shortfall warning
- [ ] Spec §31 Q6 is answerable

### M9 — MVP Hardening & Launch

- [ ] Security review complete against [../docs/security/security-model.md](../docs/security/security-model.md); every `type:security` p0/p1 closed; the "no client-side ownership trust" audit performed on every Server Action
- [ ] Every user table has RLS and a pgTAP isolation test, plus a CI check that **fails** when a new table lacks RLS
- [ ] axe clean in CI across all nine routes; keyboard navigable; AA contrast
- [ ] Every route usable at 360px with ≥44px touch targets
- [ ] Dashboard TTFB and LCP budgets met with the 5,000-transaction seed; bundle budget enforced
- [ ] All nine spec §31 questions covered by E2E assertions; suite under 10 minutes; flake-free over three consecutive runs
- [ ] Production Supabase provisioned, migrations applied, smoke checks pass, `v1.0.0` tagged with a changelog
- [ ] Every doc matches shipped behaviour; `source-structure.md` no longer says "planned"

## V2 and V3

Deliberately lighter — goals and representative tasks, no acceptance criteria.
Writing detailed criteria for work a quarter away is waste, because the criteria
will be wrong by the time anyone reads them.

- [backlog/v2-outline.md](backlog/v2-outline.md) — V2-M10 through V2-M17:
  recurring transactions, budget forecasting, goal forecasting, insights,
  What-If, notifications, reports, CSV import.
- [backlog/v3-outline.md](backlog/v3-outline.md) — V3-M18 through V3-M27:
  financial health, AI features, subscription detection, debt planner,
  investments, shared households, bank integrations, PWA.

How to file any of this as issues: [README.md](README.md#how-to-file-these-as-github-issues).
Stream mechanics: [../workflow/05-milestones-and-streams.md](../workflow/05-milestones-and-streams.md).
