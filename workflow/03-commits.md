# Commits

**Format:** [Conventional Commits](https://www.conventionalcommits.org/). The PR
title must be one too, because squash-merging makes it the commit message on
`main`.

Enforced by `commitlint` from [`M0-B11`](../tasks/backlog/m0-foundation.md).
Until that lands, the convention is manual — which is exactly why the initial
commit series follows it.

## Shape

```text
<type>(<scope>): <subject>

<body — why, not what. Wrap at 72.>

<footer — Refs #N, BREAKING CHANGE:>
```

Real example:

```text
feat(sts): add safe-to-spend breakdown computation

Implements computeSafeToSpend with a per-term breakdown so the dashboard
card can explain the number rather than just assert it. Spec §9's worked
example (₱23,500) is a passing fixture.

The breakdown is returned rather than recomputed in the component, because
lib/core is server-only and a client-side recomputation would disagree with
the headline figure.

Refs #42
```

## Types

| Type | Use |
|---|---|
| `feat` | New user-facing capability |
| `fix` | Corrects a defect |
| `docs` | Documentation only |
| `chore` | Maintenance, dependencies, config |
| `refactor` | No behaviour change |
| `test` | Tests only |
| `perf` | Performance |
| `ci` | Workflows, CI config |
| `build` | Build system, tooling |
| `revert` | Reverts a previous commit |

## Scopes

Scopes mirror the `area:*` labels ([`../tasks/labels.md`](../tasks/labels.md)),
so an issue's area label tells you the scope without thinking:

```text
auth · accounts · transactions · categories · budgets · goals
timeline · sts · dashboard · reports · db · rls · ci · docs · ui · a11y
```

`sts` is Safe to Spend. Short because it is typed often.

Omit the scope when a change genuinely spans everything —
`chore: bump dependencies`. Prefer a scope otherwise; `git log --grep` on a
scope is how you reconstruct a feature's history later.

## Rules

| Rule | Why |
|---|---|
| **Imperative mood** — "add", not "added" or "adds" | Matches `git revert`/`git merge`'s own generated messages |
| **Subject ≤ 72 characters** | Longer truncates in `git log --oneline` and GitHub's UI |
| **No trailing period** | It is a title, not a sentence |
| **Lowercase after the colon** | Consistency; the type already capitalises the line visually |
| **Body explains *why*** | The diff already shows what. The reasoning is the part that gets lost |
| **`Refs #N` on every commit** | Threads the work back to the issue |
| **`Closes #N` on the PR only** | See below |

### `Refs` on commits, `Closes` on the PR

`Closes #42` in an intermediate commit closes the issue the moment that commit
reaches `main` — which, with squash merge, is when the whole PR lands anyway.
But if the branch is ever partially cherry-picked, or the PR is split, the issue
closes while work remains.

More practically: the PR is the unit of completion. `Refs #42` on each commit
gives traceability; `Closes #42` in the PR description closes the issue when the
PR actually merges.

### `BREAKING CHANGE:`

Required for any schema change that is **not** backward-compatible with the
deployed app:

```text
feat(db)!: drop transactions.legacy_amount

BREAKING CHANGE: removes the column deprecated in v0.4.0. Requires the
expand/contract sequence to have completed — no deployed code reads it.

Refs #91
```

The `!` and the footer are both conventional. See
[09-database-changes.md](09-database-changes.md#expand--contract) — a breaking
migration should be rare, and only ever the *contract* step of a sequence whose
earlier steps have already shipped.

## Commit granularity

**One logical change per commit.** Not one file, and not a whole day's work.

Good sequence on a branch:

```text
test(sts): add spec §9 fixture for computeSafeToSpend
feat(sts): implement computeSafeToSpend with term breakdown
feat(sts): add status band thresholds
docs(sts): note the horizon decision in safe-to-spend.md
```

That reads as a story, and each commit is independently revertible. The
test-first ordering is deliberate for `lib/core` — see
[06-task-lifecycle.md](06-task-lifecycle.md).

Avoid: `wip`, `fix typo`, `address review comments`, `more changes`. Squash
merge collapses them anyway, but they are noise in review, and review is where
they cost something. Rebase to tidy before pushing.

## AI-assisted commits

Add the trailer:

```text
Co-Authored-By: Claude <noreply@anthropic.com>
```

Attribution rules and what AI must not author unreviewed:
[11-agent-and-ai-usage.md](11-agent-and-ai-usage.md).

## Local check

`commitlint` runs on `commit-msg` once [`M0-B11`](../tasks/backlog/m0-foundation.md)
lands. To check the last commit manually:

```bash
npx commitlint --from HEAD~1 --to HEAD --verbose
```

## Next

- [04-pull-requests.md](04-pull-requests.md) — the PR title is a commit message too.
- [06-task-lifecycle.md](06-task-lifecycle.md) — where commits fit in the sequence.
