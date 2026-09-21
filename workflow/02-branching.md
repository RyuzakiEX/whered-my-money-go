# Branching

**Trunk-based: `main` is always deployable and protected, every change arrives
through one short-lived branch and one squash-merged PR, and branches are
updated by rebase, never by merging `main` in.**

There is exactly one long-lived branch. Everything else lives hours to a couple
of days. That is not a stylistic preference — `main` auto-deploys to Vercel
production ([10-release.md](10-release.md)), so "deployable" and "merged" are the
same word here, and anything that lets un-deployable code sit in a shared branch
breaks that equivalence.

## Naming

```text
<type>/<issue-number>-<short-slug>
```

```text
feat/42-safe-to-spend-card
fix/57-timeline-month-end-clamp
chore/12-add-trivy-workflow
docs/3-architecture-doc-set
```

- **`<type>`** matches the [conventional commit type](03-commits.md#types) —
  `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`, `build`.
- **`<issue-number>`** is mandatory. It makes the branch self-documenting six
  months later, lets `gh pr create` prefill sensibly, and means a stale branch
  list is triageable at a glance instead of an archaeology exercise.
- **`<short-slug>`** is two to four kebab-case words. Enough to recognise; not
  the issue title.

Branch names are lowercase and contain no personal prefix. `jorge/fix-thing` is
a habit from repos with many contributors and per-person namespaces; here it
just makes the type invisible in a branch listing.

## Rules

**One issue → one branch → one PR.** If a branch ends up needing two issues to
describe it, it was two branches. See
[the scope rule](06-task-lifecycle.md#the-scope-rule).

**Branch from an up-to-date `main`.**

```bash
git switch main
git pull --ff-only
git switch -c feat/42-safe-to-spend-card
```

`--ff-only` on purpose: if it refuses, you have local commits on `main` that
shouldn't be there, and you want to know that now rather than discover it in a
merge commit later.

**Rebase to update. Do not merge `main` into your branch.**

```bash
git fetch origin
git rebase origin/main
# resolve, then:
git push --force-with-lease
```

Rebasing keeps the branch a clean linear series of your commits, which is what
makes self-review of the diff meaningful — a merge commit in the middle turns
"what did I change?" into a three-way question. It also matches the
linear-history protection rule below, and `--force-with-lease` is what makes the
force-push safe: it refuses if the remote moved under you.

Since every PR is squash-merged, the intermediate history is collapsed at merge
time anyway. Rebase conflicts are therefore cheap: you are conflicting with
`main` once, on a small branch, rather than accumulating merge commits that
obscure the diff.

**Delete after merge.** GitHub's "automatically delete head branches" setting
handles this; if you merged from the CLI, `gh pr merge --squash --delete-branch`
does both. A branch list that only contains live work is a status report. One
that contains three months of merged branches is noise.

**Never commit directly to `main`**, including "trivial" typo fixes. The gates
are the point: a typo in a doc that `lychee` would have flagged as a dead link is
exactly the class of thing that slips through when you skip the PR. Protection
enforces this mechanically anyway.

## Branch protection checklist

> [!NOTE]
> This is a **GitHub repository setting**, not a file in the repo, so it cannot
> be reviewed in a PR and cannot be verified by CI. It is written down here
> because a setting nobody wrote down is a setting that silently drifts. Verify
> it against this list whenever the CI workflows change.

Settings → Branches → branch protection rule for `main`:

- [ ] **Require a pull request before merging** — no direct pushes.
- [ ] **Require status checks to pass**, and require exactly these three:
  - [ ] `ci-status` (from `ci.yml`)
  - [ ] `security-status` (from `security.yml`)
  - [ ] `docs-status` (from `docs.yml`)
- [ ] **Require branches to be up to date before merging** — off. With rebase
      and a solo dev this only adds forced churn; turn it on when concurrent PRs
      become normal.
- [ ] **Require conversation resolution before merging** — on. Even solo: an
      unresolved thread on your own PR is a note-to-self you'd otherwise merge
      past.
- [ ] **Require linear history** — on. Squash-only merges plus rebase updates
      produce linear history for free; the setting is there to make an
      accidental merge commit impossible.
- [ ] **Do not allow force pushes** — on.
- [ ] **Do not allow deletions** — on.
- [ ] **Require review from Code Owners** — **OFF while solo.** See below.
- [ ] **Include administrators** — on. A protection rule you can bypass isn't
      one; the whole value is that it applies on the day you're in a hurry.
- [ ] **Allowed merge methods**: squash only. Disable merge commits and rebase
      merging in Settings → General → Pull Requests.

### Why those three checks, and why they never sit pending

`ci-status`, `security-status`, and `docs-status` are **aggregate gate jobs**:
each one depends on every real job in its workflow and runs with
`if: always()`, so it reports green when its dependencies passed *or were
skipped*, and red only on a genuine failure.

This matters because of a specific GitHub behaviour: a required status check
that never reports blocks the PR forever. If `unit` were required directly, then
every PR that changes no code — every docs PR, which is currently all of them —
would skip `unit` and wait indefinitely for a check that will never arrive.
Requiring the aggregate instead means the required check always runs and always
reports. Full explanation in
[08-ci-gates.md](08-ci-gates.md#why-is-ci-green-on-an-empty-repo).

### Why Code Owners review is off

[`CODEOWNERS`](../.github/CODEOWNERS) exists and is useful — it auto-requests
review on the dangerous paths (`supabase/migrations/**`, `lib/core/**`,
`.github/workflows/**`). But with a single owner, "require review from Code
Owners" means the only person who can approve the PR is the person who opened
it, and GitHub does not let you approve your own PR. The result is a repository
where nothing can merge.

So: `CODEOWNERS` for **notification**, not **enforcement**, while solo. The
substitute is the self-review discipline in
[04-pull-requests.md](04-pull-requests.md#solo-dev-mode). Flip this setting on
the day a second contributor has push access — it is a checkbox, and the
`CODEOWNERS` file it depends on is already correct.

## Why there are no milestone integration branches

The tempting shape, given that milestones have parallel `stream:frontend` and
`stream:backend` tasks, is a long-lived `milestone/m3-transactions` branch that
both streams merge into and that graduates to `main` when the milestone is done.

This is rejected. Reasons, in order of how much they cost:

- **It destroys the vertical slice.** A milestone is defined as something
  demoable end to end ([05-milestones-and-streams.md](05-milestones-and-streams.md)).
  An integration branch means nothing is demoable until everything is, so the
  milestone stops being a slice and becomes a phase — and you find out whether
  the slice actually works at the end, which is the worst possible time.
- **Preview deployments point at the wrong thing.** Vercel builds a preview per
  PR. If PRs target an integration branch, the preview shows integration-branch
  state, and the milestone exit criterion "the demo script passes on a preview
  deployment" is testing something that is not what will be deployed.
- **The final merge is the risky one.** Weeks of divergence collapse into a
  single review nobody can do well — precisely the "review quality falls off a
  cliff" problem that the [400-line PR target](04-pull-requests.md) exists to
  avoid, scaled up.
- **Schema changes get deferred.** A migration sitting on an integration branch
  hasn't been applied to any real environment. The expand/contract discipline in
  [09-database-changes.md](09-database-changes.md) assumes migrations reach
  production incrementally and backward-compatibly. Batching them into one
  merge is how you get an unrecoverable migration on financial data.
- **It hides drift instead of surfacing it.** The schema-drift gate and the
  regenerated types are meant to fail fast, on the PR that caused the drift.

**Parallelism here comes from directory separation plus contract-first, not from
branch isolation.** The stream ownership table in
[`../docs/architecture/source-structure.md`](../docs/architecture/source-structure.md#stream-ownership)
guarantees that `stream:frontend` (`app/**`, `components/**`) and
`stream:backend` (`lib/core/**`, `lib/server/**`, `supabase/**`) touch disjoint
files — so two branches off `main` in the same milestone do not conflict. The
`type:contract` task supplies the agreement they need to proceed independently.
That is the entire mechanism; a shared branch adds nothing it doesn't already
have and takes away everything above.

The one legitimate exception is a **spike**: a throwaway branch used to learn
something, never merged, deleted afterwards. Name it `spike/<issue>-<slug>` so
it is obviously not a candidate for merging, and land the *conclusion* as an
ADR in [`../docs/adr/`](../docs/adr/) rather than the code.

## Next

- [03-commits.md](03-commits.md) — commit message format and scopes.
- [04-pull-requests.md](04-pull-requests.md) — PR size, description, review order.
- [06-task-lifecycle.md](06-task-lifecycle.md) — the commands in sequence.
