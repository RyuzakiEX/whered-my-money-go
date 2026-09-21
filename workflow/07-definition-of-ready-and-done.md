# Definition of Ready and Done

**Two checklists.** Ready decides whether a task can be started; Done decides
whether it can be closed. Both exist so those questions have answers rather than
opinions.

## Definition of Ready

A task gets `status:ready` only when all of these hold. The
[issue template](../.github/ISSUE_TEMPLATE/01-task.yml) asks for them at filing
time, so readiness is decided when the context is fresh rather than months later.

- [ ] **Title is `[M#][XX] <verb> <object>`** — e.g. `[M7][BE] Implement computeSafeToSpend in lib/core`
- [ ] **Acceptance criteria are checkboxes, specific and verifiable**
- [ ] **All four labels plus a milestone** — `stream:*`, `type:*`, `area:*`, `priority:*`
- [ ] **Dependencies linked, and done or in flight**
- [ ] **The contract task exists** if this is a frontend task needing data
- [ ] **Small enough for one pull request** (≤ ~400 changed lines)

### On "specific and verifiable"

The most common reason a task stalls is criteria that cannot be checked.

| Not ready | Ready |
|---|---|
| "Safe to Spend works correctly" | "Spec §9's example (₱42,000 + ₱15,000 − ₱18,500 − ₱10,000 − ₱5,000) returns exactly ₱23,500; the breakdown's terms sum to the total; property tests cover the documented invariants; coverage ≥ 95%" |
| "Add RLS to accounts" | "Four `*_own` policies exist; a pgTAP test asserts user B sees zero of user A's rows and that a cross-user insert fails" |
| "Make the dashboard fast" | "Dashboard TTFB < 600 ms and LCP < 2.5 s against the 5,000-transaction seed; the query plan shows no sequential scan on `transactions`" |

The left column requires the implementer to decide what the task means — which
is a specification decision made under time pressure, unreviewed. The right
column can be checked by someone who did not write it.

Backlog tasks in [`../tasks/backlog/`](../tasks/backlog/) are written to this
standard. If a task is not ready, label it `status:needs-info` and fix the
issue rather than starting it.

## Definition of Done — task

A PR may merge only when all of these hold.

### Always

- [ ] Every acceptance criterion checked
- [ ] No new lint or type errors
- [ ] All CI gates green — `ci`, `security`, `docs`, and `schema` where applicable
- [ ] Self-review of the rendered diff done
- [ ] **No `TODO` without a linked issue number**
- [ ] `.env.example` updated if a new environment variable appeared
- [ ] **Docs updated in this PR** if behaviour or schema changed

### Money math — any `lib/core` change

- [ ] Unit tests, including the **canonical fixture** from the relevant [domain doc](../docs/domain/)
- [ ] **≥ 90% line coverage** on touched `lib/core` files — **95%** for `safe-to-spend/**` and `timeline/**`
- [ ] Property tests for the invariants the domain doc lists
- [ ] Integer minor units only; no float, no `parseFloat`
- [ ] Pure — `today` injected, no `Date.now()`, no `process.env`

### Data access — any new Server Action or query

- [ ] Integration test against a local Supabase
- [ ] A test asserting cross-user access returns **not-found**
- [ ] Cache invalidation matches the
      [invalidation matrix](../docs/architecture/state-and-caching.md#invalidation-matrix)

### Schema — any `supabase/**` change

- [ ] Migration is forward-only and replays cleanly from empty
- [ ] Backward-compatible with the currently deployed app (expand/contract)
- [ ] RLS enabled, with policies
- [ ] **Cross-table ownership** in `WITH CHECK` where a foreign key is user-owned
- [ ] pgTAP isolation test added
- [ ] `types/database.types.ts` regenerated and committed
- [ ] [`data-model.md`](../docs/architecture/data-model.md) updated

### Frontend — any `stream:frontend` change

- [ ] **Screenshots in the PR**, desktop and 360 px
- [ ] Keyboard navigable, visible focus
- [ ] AA contrast in **both** themes
- [ ] Touch targets ≥ 44 px
- [ ] Loading and empty states handled
- [ ] No information conveyed by colour alone
- [ ] Copy matches spec §32's voice — and
      [bad-news states get the most care](../docs/architecture/frontend-architecture.md#brand-voice)

## Why docs ship in the same PR

Listed as "always" deliberately.

A follow-up documentation task is a task that will not happen. The pressure that
made it a follow-up does not disappear, and a week later the reasoning is gone —
the *why* was in your head, and heads do not persist.

The concrete failure this prevents: the horizon in
[safe-to-spend.md](../docs/domain/safe-to-spend.md#horizon) is month-end for
reasons that are written down. Change it to a rolling 30 days without updating
that doc, and the next reader has a document that confidently describes
behaviour the code no longer has. That is worse than no document — it will be
trusted.

## Definition of Done — milestone

- [ ] Every task closed
- [ ] **The demo script passes on a preview deployment**
- [ ] The [spec §31 questions](../docs/product/success-criteria.md) this
      milestone covers are answerable in the running app
- [ ] Docs and ADRs current
- [ ] Accessibility and 360 px mobile pass for frontend slices
- [ ] No open `priority:p0` or `priority:p1` bugs against the slice
- [ ] The milestone's E2E test is in the suite and passing

### The demo requirement

**On a preview deployment, not localhost.** It proves the slice works somewhere
other than the machine that built it — real environment variables, a real
Supabase project, a real build.

It is also what keeps "vertical slice" honest. A milestone that cannot be
demonstrated end to end was a phase wearing a milestone's label
([05-milestones-and-streams.md](05-milestones-and-streams.md)).

Each milestone doc in [`../tasks/backlog/`](../tasks/backlog/) carries its demo
script.

## What is deliberately not required

| Not required | Why |
|---|---|
| 100% coverage | Coverage is a floor for finding untested files, not a goal. 95% with property tests beats 100% without. |
| Tests for every component | Diminishing returns. The E2E suite covers the flows that matter. |
| Visual regression tests | High maintenance, low signal at this scale. Manual pass in `M9-F01`. |
| A second reviewer | Impossible while solo. The rule is written to tighten, not change, when that ends. |
| Perfect documentation | Docs describing *behaviour* must be current. Docs describing *plans* may lag — `M9-B07` reconciles them. |

## Next

- [06-task-lifecycle.md](06-task-lifecycle.md) — the sequence these checklists bracket.
- [08-ci-gates.md](08-ci-gates.md) — which gates enforce which items automatically.
- [`../tasks/README.md`](../tasks/README.md) — how the backlog encodes readiness.
