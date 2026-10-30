# Commits

**Format:** [Conventional Commits](https://www.conventionalcommits.org/). The PR
title must be one too, because it becomes the title of the merge commit on
`main` — and, with merge commits, every commit on the branch reaches `main` as
well.

Enforced by `commitlint` ([`commitlint.config.mjs`](../commitlint.config.mjs))
in two places: a local `commit-msg` hook, and the **commit messages** CI job,
which checks every commit in a PR *and* the PR title. See [Hooks](#hooks).

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
timeline · sts · dashboard · reports · db · rls · ci · ui · a11y
deps · deps-dev          ← dependency bumps (Dependabot's convention)
```

`commitlint.config.mjs` **reads the list from `tasks/labels.md`**, so adding an
`area:` label adds the scope — the two cannot drift. `docs` is a *type*, not a
scope: write `docs(sts): …`, not `docs(docs): …`.

`sts` is Safe to Spend. Short because it is typed often.

Omit the scope when a change genuinely spans everything —
`chore: bump dependencies`. Prefer a scope otherwise; `git log --grep` on a
scope is how you reconstruct a feature's history later.

## Rules

| Rule | Why |
|---|---|
| **Imperative mood** — "add", not "added" or "adds" | Matches `git revert`/`git merge`'s own generated messages |
| **Subject ≤ 72 characters** — the whole header | Longer truncates in `git log --oneline` and GitHub's UI. **The merge commit title appends `(#N)`**, so keep PR titles to about 65; CI lints the title *with* that suffix |
| **No trailing period** | It is a title, not a sentence |
| **Lowercase after the colon** | Consistency; the type already capitalises the line visually |
| **Body explains *why*** | The diff already shows what. The reasoning is the part that gets lost |
| **`Refs #N` on every commit** | Threads the work back to the issue |
| **`Closes #N` on the PR only** | See below |

### `Refs` on commits, `Closes` on the PR

`Closes #42` in an intermediate commit closes the issue the moment that commit
reaches `main` — which, since PRs land whole, is when the whole PR lands anyway.
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

Avoid: `wip`, `fix typo`, `address review comments`, `more changes`. Nothing
collapses them: with merge commits, every commit on the branch is on `main`
forever. Tidy with a rebase **before the first push**; after that, a fix-up is a
normal, well-named commit.

## AI-assisted commits

Add the trailer:

```text
Co-Authored-By: Claude <noreply@anthropic.com>
```

Attribution rules and what AI must not author unreviewed:
[11-agent-and-ai-usage.md](11-agent-and-ai-usage.md).

## Hooks

Installed automatically by `npm install` (the `prepare` script runs Husky).

| Hook | Runs | Typical time |
|---|---|---|
| `commit-msg` | `commitlint` on the message | < 1 s |
| `pre-commit` | `lint-staged`: Prettier on every staged file; Prettier **then** ESLint on staged TypeScript | ~4 s for a 1–3 file change, dominated by type-aware ESLint loading the TS program |

To check the last commit manually:

```bash
npx commitlint --from HEAD~1 --to HEAD --verbose
```

### Escape hatch

For an emergency — a broken hook, a hotfix that cannot wait for a lint fix:

```bash
git commit --no-verify -m "fix(ci): …"     # skip both hooks for one commit
HUSKY=0 git commit -m "…"                  # same, via environment
```

**CI still enforces the same rules.** The commit messages job lints every
commit in the PR and the title; lint and format run in the lint job. Skipping
the hook moves the failure later, it does not remove it.

## Next

- [04-pull-requests.md](04-pull-requests.md) — the PR title is a commit message too.
- [06-task-lifecycle.md](06-task-lifecycle.md) — where commits fit in the sequence.
