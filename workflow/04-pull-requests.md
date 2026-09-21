# Pull Requests

**One issue, one branch, one PR, squash-merged.** The PR is the unit of
completion — it is where `Closes #N` lives, where CI gates apply, and where the
[Definition of Done](07-definition-of-ready-and-done.md) is checked.

## Size

**Target ≤ 400 changed lines.** Split anything larger.

Not an arbitrary number: review quality falls off a cliff somewhere around
there. A 200-line diff gets read; a 900-line diff gets skimmed, and skimming a
PR that touches money math or an RLS policy defeats the point of reviewing it.
On a solo project the reviewer is future-you, who is even less patient.

Generated files (`types/database.types.ts`, lockfiles) do not count — they are
marked `linguist-generated` in `.gitattributes` so they collapse in review.

If a task cannot fit, the task was too big. Split it and file the follow-up
rather than growing the PR
([06-task-lifecycle.md](06-task-lifecycle.md#the-scope-rule)).

## Description

The [PR template](../.github/pull_request_template.md) prompts for all of this.
Required:

| Section | Notes |
|---|---|
| **Summary** | What changed and why. Two or three sentences. |
| **`Closes #N`** | Links and auto-closes the issue on merge. |
| **Stream** | `frontend` / `backend` / `shared` / `devops`. |
| **How I verified this** | Commands actually run, tests added. Not "tested locally". |
| **Screenshots** | **Required for any `stream:frontend` change.** Desktop and 360 px. A layout regression is invisible in a diff. |

Conditional checklists appear in the template for **database changes**,
**money math**, and **authorization**. They are conditional because they do not
always apply — not because they are optional when they do.

## The three checklists that matter

Each exists because its absence is a known failure mode for this kind of app.

### Database changes

Forward-only; backward-compatible with the deployed app; replays cleanly from
empty; RLS enabled with policies; **cross-table ownership** enforced in
`WITH CHECK` where a foreign key is user-owned; pgTAP isolation test added;
generated types regenerated and committed; `data-model.md` updated.

The cross-table item is the one people miss —
[why](../docs/architecture/rls-policies.md#cross-table-ownership).

### Money math

Integer minor units, no floats, no `parseFloat`; rounding documented;
largest-remainder where parts must sum to a whole; **a test reproducing the
canonical worked example** from the relevant [domain doc](../docs/domain/);
pure — `today` injected, no `Date.now()`, no `process.env`; ≥ 90% coverage on
touched `lib/core` files (95% for Safe to Spend and Timeline).

### Authorization

`userId` from the session, never from input; ownership of every incoming `id`
re-verified server-side **even though RLS also enforces it**; explicit column
allowlist on writes; Zod `.strict()`; cross-user access returns not-found, not
forbidden.

## Self-review first

**Read your own diff on GitHub before requesting review.** Not the local diff —
the rendered one, in the interface a reviewer uses.

It reliably catches: debug logging, commented-out code, a file staged by
accident, a `TODO` without an issue, an inconsistent name, a test that asserts
nothing. Ten minutes here saves a review round trip, and on a solo project it is
*the* review.

## Solo-dev merging

GitHub does not permit approving your own PR, so `CODEOWNERS`-required review
stays **off** while this is a one-person project
([`.github/CODEOWNERS`](../.github/CODEOWNERS) says so, with the reason).

**Self-merge is allowed only when:**

- Every CI gate is green — `ci`, `security`, `docs`, and `schema` where applicable.
- The self-review checklist is genuinely complete.
- The [Definition of Done](07-definition-of-ready-and-done.md) is met.

The rule is written this way so it *tightens* rather than changes when a second
developer arrives: flip on required review and code-owner approval, and nothing
else about the process moves.

## Review order

When reviewing — your own PR or someone else's — read in this order:

```text
1. Money math               Is the arithmetic right? Does the canonical
                            fixture pass? Any float, anywhere?

2. Authorization / RLS      Is userId from the session? Is ownership
                            re-verified? Does the policy cover the
                            cross-table case?

3. Tests                    Do they assert behaviour, or just that the
                            code ran? Are the edge cases from the domain
                            doc covered?

4. Naming and docs          Does it match the glossary? Are the docs
                            updated in this PR?

5. Style                    The linter's job. Do not spend attention here.
```

**The order is the point.** Attention is finite, and the two things that lose a
user's money or expose their data come first. A reviewer who spends their focus
on naming and reaches the RLS policy tired has reviewed the wrong PR.

Style is deliberately last and delegated: ESLint and Prettier decide it, so a
style comment in review is either a lint rule that should exist or a preference
that shouldn't be enforced.

## Merge

**Squash merge only.**

- One commit per PR on `main` — history reads as a list of completed changes,
  and `git bisect` lands on something meaningful.
- The **PR title becomes the commit message**, so it must be a valid
  [conventional commit](03-commits.md).
- Branch deletes automatically. Issue closes via `Closes #N`.

Never merge-commit (noise) and never rebase-merge (the intermediate `wip`
commits reach `main`).

## When CI is red

Do not merge. Do not disable the gate.

[08-ci-gates.md](08-ci-gates.md) lists each job, what it checks, and the local
command that reproduces it. Reproduce locally, fix, push.

The only sanctioned exception is a gate failing for a reason unrelated to the
change (a runner outage, a newly-disclosed CVE in an untouched dependency) —
and that gets a `type:chore` issue, not a bypass.

## Next

- [05-milestones-and-streams.md](05-milestones-and-streams.md) — how PRs from two streams stay conflict-free.
- [07-definition-of-ready-and-done.md](07-definition-of-ready-and-done.md) — the bar this PR has to clear.
- [08-ci-gates.md](08-ci-gates.md) — what each gate checks.
