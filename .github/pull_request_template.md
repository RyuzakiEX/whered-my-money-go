<!--
Every section below exists because its absence caused a problem. Delete a
section only when it genuinely does not apply — do not leave it blank.

Rules that are easy to skip and should not be:
  · Acceptance Criteria — mark each one. Do not invent results.
  · Test Results — baseline captured BEFORE implementation, not estimated.
  · Test Recipes — one per AC. If a recipe cannot be written, the AC is not
    ready to ship.
-->

## Summary

<!--
What changed, why, what behaviour is affected, and the key technical
decisions. Be specific. "Updated logic", "fixed issue", and "improved
handling" say nothing a diff does not already show.
-->

## Related issues / dependency context

<!-- Include only real relationships. Delete the rest. -->

Closes #

- Related: #
- Blocked by / Blocks: #
- Upstream / Downstream: #

Task: <!-- e.g. M0-B04 in tasks/backlog/m0-foundation.md -->

## Acceptance criteria validation

<!--
Derived from the task's backlog row and any clarifying discussion. Mark each
PASS / FAIL / PARTIAL with a reason. Call out intentional deviations
explicitly — a criterion you chose not to meet is a PARTIAL with an
explanation, never an omission. Do not invent results.
-->

| Acceptance criteria | Status | Notes |
|---|---|---|
|  | PASS |  |
|  | PARTIAL |  |

## Test results

<!--
Baseline is captured BEFORE implementation and reported against the run after.
Numbers come from actual runs — never estimated, never re-run afterwards to
make them agree. Explain every delta in failures or skips, including failures
unrelated to this work.

No test runner until M0-B04. Until then write "no suite yet (M0-B04)" rather
than inventing numbers.
-->

| Suite | Baseline (before) | After implementation | Delta | Notes |
|---|---|---|---|---|
| Unit (`npm run test`) |  |  |  |  |
| Integration (`npm run test:integration`) |  |  |  |  |
| E2E (`npm run test:e2e`) |  |  |  |  |
| Schema drift (`supabase db diff`) |  |  |  |  |
| RLS isolation (`supabase test db`) |  |  |  |  |
| `npm run verify` |  |  |  |  |
| `npm audit --omit=dev` |  |  |  |  |

## Test recipes

<!--
One numbered recipe per acceptance criterion. Required for QA handoff.

If fixtures are needed (JSON payloads, seed records, CSV samples), they must be
COMMITTED under tests/fixtures/<scope>/ — do not describe them in prose.
-->

### 1. <!-- AC this covers -->

- **Setup** — preconditions, seed data, environment state
- **Action** — step by step: clicks, API calls, commands
- **Expected** — what happens, including UI state, DB row, cache invalidation
- **Negative cases** — what must fail, listed explicitly

## Misalignments / requirement clarifications

<!--
Required if any exist. For each conflict between the task, the docs, the spec,
and the implementation: what conflicted, how it was resolved, why.

Deviating from the backlog is allowed — it was written in advance. But the
task's acceptance criteria must be updated in THIS PR so the doc never
contradicts the code.
-->

None.

## Technical notes

<!-- Lead with the most important. Only meaningful items. -->

### Database changes

<!-- Delete if no `supabase/**` file changed. -->

- [ ] Migration is **forward-only** (no down-migration on financial data)
- [ ] **Backward-compatible** with the deployed app (expand/contract)
- [ ] `supabase db reset` replays cleanly from empty
- [ ] RLS enabled on every new table, with policies
- [ ] **Cross-table ownership** enforced in `WITH CHECK` where a foreign key is
      user-owned ([why](../docs/architecture/rls-policies.md#cross-table-ownership))
- [ ] pgTAP test added proving cross-user access returns nothing
- [ ] `types/database.types.ts` regenerated and committed
- [ ] [`data-model.md`](../docs/architecture/data-model.md) updated

### Money math

<!-- Delete if no `lib/core/**` or amount handling changed. -->

- [ ] **Integer minor units** — no floats, no `parseFloat`
- [ ] Rounding documented; largest-remainder where parts must sum to a whole
- [ ] A test reproduces the canonical worked example from the relevant
      [domain doc](../docs/domain/)
- [ ] Pure — `today` injected, no `Date.now()`, no `process.env`
- [ ] Coverage on touched `lib/core` files ≥ 90% (95% for safe-to-spend, timeline)

### Authorization

<!-- Delete if no Server Action or query changed. -->

- [ ] `user_id` from the **session**, never from client input
- [ ] Ownership of every incoming `id` re-verified server-side, even though RLS
      also enforces it
- [ ] Explicit column allowlist on writes; no spreading of client input
- [ ] Zod `.strict()` — unknown keys rejected
- [ ] Cross-user access returns **not-found**, not forbidden (no existence leak)

## Risks / reviewer focus areas

<!--
Sensitive areas, possible regressions, concurrency or state risks, API
compatibility, anything needing careful review.

Review order for this repo: money math → authorization/RLS → tests → naming →
style. Style is the linter's job.
-->

## Screenshots or recording

<!-- REQUIRED for any `stream:frontend` change. Desktop and 360px. -->

## Self-review checklist

- [ ] I reviewed my own rendered diff before requesting review
- [ ] No secrets, tokens, or real financial data committed
- [ ] No stray `console.log` or commented-out code
- [ ] No `TODO` without a tracking reference
- [ ] `.env.example` updated if a new environment variable appeared
- [ ] Docs updated **in this PR** if behaviour or schema changed
- [ ] Backlog acceptance criteria updated if I deviated from them
- [ ] PR title is a valid [conventional commit](../workflow/03-commits.md)
- [ ] All CI gates green — `ci`, `security`, `docs`, `e2e`, `schema`
- [ ] [Definition of Done](../workflow/07-definition-of-ready-and-done.md) met
