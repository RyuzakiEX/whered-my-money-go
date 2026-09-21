<!--
Every checklist item below exists because something went wrong without it.
Delete the sections that genuinely do not apply — don't leave them unchecked.
-->

## Summary

<!-- What changed and why. Two or three sentences. -->

Closes #

## Stream

- [ ] `frontend` — `app/**`, `components/**`
- [ ] `backend` — `lib/core/**`, `lib/server/**`, `supabase/**`
- [ ] `shared` — contracts, types, validation
- [ ] `devops` — CI, workflows, deploy config

## Type of change

- [ ] Feature — new user-facing capability
- [ ] Fix — corrects a defect
- [ ] Contract — schema/types/validation that unblocks another stream
- [ ] Refactor — no behaviour change
- [ ] Docs
- [ ] Chore / CI

## Screenshots or recording

<!--
REQUIRED for any `stream:frontend` change. Include mobile (360px) alongside
desktop. A written description is not a substitute — layout regressions are
invisible in a diff.
-->

## How I verified this

<!--
Commands actually run, tests added. Not "tested locally".
e.g. `npm run verify`; added `computeSafeToSpend` spec §9 fixture; manually
checked the breakdown drawer against the seeded dataset.
-->

---

## Database changes

<!-- Delete this section if no `supabase/**` file changed. -->

- [ ] Migration is **forward-only** (no down-migration on financial data)
- [ ] Migration is **backward-compatible** with the currently deployed app
      (expand/contract — see [workflow/10-release.md](../workflow/10-release.md))
- [ ] `supabase db reset` replays cleanly from empty
- [ ] RLS enabled on every new table, with policies
- [ ] Cross-table ownership enforced in `WITH CHECK` where a foreign key is
      user-owned (see [rls-policies.md](../docs/architecture/rls-policies.md#cross-table-ownership))
- [ ] pgTAP isolation test added proving cross-user access returns nothing
- [ ] `types/database.types.ts` regenerated and committed
- [ ] [`docs/architecture/data-model.md`](../docs/architecture/data-model.md) updated

## Money math

<!-- Delete this section if no `lib/core/**` or amount handling changed. -->

- [ ] All amounts are **integer minor units** — no floats, no `parseFloat`
- [ ] Rounding behaviour is documented, and allocation uses largest-remainder
      where parts must sum to a whole
- [ ] A unit test reproduces the canonical worked example from the relevant
      [`docs/domain/`](../docs/domain/) doc
- [ ] Function is pure — `today` injected, no `Date.now()`, no `process.env`
- [ ] Coverage on touched `lib/core` files is ≥ 90%

## Authorization

<!-- Delete this section if no Server Action or query changed. -->

- [ ] `user_id` derived from the **session**, never from client input
- [ ] Ownership of every incoming `id` re-verified server-side (RLS is not the
      only check — see [security-model.md](../docs/security/security-model.md))
- [ ] Explicit column allowlist on writes; no spreading of client input
- [ ] Cross-user access returns not-found, not forbidden (no existence leak)

---

## Self-review checklist

- [ ] I reviewed my own diff before requesting review
- [ ] No secrets, tokens, or real financial data committed
- [ ] No stray `console.log` or commented-out code
- [ ] No `TODO` without a linked issue number
- [ ] `.env.example` updated if a new environment variable appeared
- [ ] Docs updated **in this PR** if behaviour or schema changed
- [ ] PR title is a valid [conventional commit](../workflow/03-commits.md)
      (it becomes the squash commit message)
- [ ] All CI gates green — `ci`, `security`, `docs`, and `schema` where applicable
- [ ] [Definition of Done](../workflow/07-definition-of-ready-and-done.md) met
