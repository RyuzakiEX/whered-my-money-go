# Task Lifecycle

**Issue → branch → test → commits → PR → green → squash.** The commands, in
order.

> [!NOTE]
> Commands marked **[after M0]** do not work yet — there is no `package.json`.
> [01-local-setup.md](01-local-setup.md) lists what runs today.

## 1. Pick a task

From the current milestone, matching the stream you are working in:

```bash
gh issue list --milestone "M2 — Accounts" --label "status:ready,stream:backend"
```

Only pick `status:ready` — it means the task meets the
[Definition of Ready](07-definition-of-ready-and-done.md#definition-of-ready).
A task that isn't ready will stall halfway through, and the stall will look like
a coding problem when it is a specification problem.

Check **Depends on**. A frontend task usually depends on its milestone's
`type:contract` task ([05-milestones-and-streams.md](05-milestones-and-streams.md)).
If that hasn't merged, pick something else.

```bash
gh issue edit 42 --add-assignee @me
```

## 2. Branch

```bash
git switch main
git pull
git switch -c feat/42-safe-to-spend-card
```

Always from an up-to-date `main`. Naming: `<type>/<issue-number>-<slug>` —
[02-branching.md](02-branching.md).

## 3. Write the failing test first — for `lib/core`

**Non-negotiable for anything in `lib/core`.**

```bash
# Start from the canonical fixture the domain doc specifies
$EDITOR tests/unit/safe-to-spend/spec-s9.test.ts
npm run test -- --watch          # [after M0] — should FAIL
```

Two reasons this is a rule rather than a preference here:

- **The domain docs already define correct.** Spec §9's ₱23,500 is written down
  in [`../docs/domain/safe-to-spend.md`](../docs/domain/safe-to-spend.md) before
  any code exists. Writing the test first means implementing against that
  definition rather than producing one.
- **A test written after the code asserts what the code does**, which is
  circular. On money math, circular is worthless — it will confirm a wrong
  number as confidently as a right one.

Outside `lib/core` — components, layouts, config — test-first is optional. Use
judgement.

## 4. Implement

Read the relevant docs before writing:

| Working on | Read |
|---|---|
| `lib/core` money math | The [domain doc](../docs/domain/) + [money-and-rounding.md](../docs/domain/money-and-rounding.md) |
| A migration | [data-model.md](../docs/architecture/data-model.md) + [rls-policies.md](../docs/architecture/rls-policies.md) |
| A Server Action | [api-and-data-access.md](../docs/architecture/api-and-data-access.md) + [state-and-caching.md](../docs/architecture/state-and-caching.md) |
| A component | [frontend-architecture.md](../docs/architecture/frontend-architecture.md) |
| Naming anything | [glossary.md](../docs/product/glossary.md) |

## 5. Commit in increments

```bash
git add lib/core/safe-to-spend/
git commit -m "feat(sts): implement computeSafeToSpend with term breakdown

Spec §9's worked example is a passing fixture.

Refs #42"
```

One logical change per commit. `Refs #N` on commits, `Closes #N` on the PR only
— [03-commits.md](03-commits.md).

## 6. Verify locally

```bash
npm run verify          # [after M0] — lint + typecheck + unit
```

**Always before pushing.** A local run is seconds; a CI round trip is minutes,
and a red PR is noise in your own review history.

For schema changes:

```bash
supabase db reset       # [after M0] — replays every migration from empty
npm run db:types        # regenerate, and COMMIT the result
supabase test db        # pgTAP RLS isolation tests
```

Available **today**, on docs and CI changes:

```bash
npx markdownlint-cli2 "**/*.md"
npx lychee --offline --no-progress .
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest detect \
  --source=/repo --config=/repo/.gitleaks.toml
```

Every gate's local equivalent: [08-ci-gates.md](08-ci-gates.md).

## 7. Push and open the PR

```bash
git push -u origin feat/42-safe-to-spend-card
gh pr create --fill
```

Fill in the [template](../.github/pull_request_template.md). Its conditional
checklists — database, money math, authorization — apply if the change touches
those areas. Screenshots are **required** for `stream:frontend`.

Put `Closes #42` in the description.

## 8. Self-review

Read your own diff **on GitHub**, in the rendered view. It catches what the
local diff doesn't: stray logging, an accidentally staged file, a `TODO` with no
issue, a test that asserts nothing.

On a solo project this is the review. Ten minutes.

## 9. Green, then squash merge

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Required gates: `ci`, `security`, `docs`, and `schema` where applicable. Do not
merge red; do not disable a gate
([04-pull-requests.md](04-pull-requests.md#when-ci-is-red)).

The PR title becomes the commit on `main`, so it must be a valid conventional
commit. The branch deletes; `Closes #42` closes the issue.

## The scope rule

> **If the task revealed new work, file a new issue. Do not grow the PR.**

You are implementing Safe to Spend and notice the account balance view is
missing an index. Tempting to fix it here — it is two lines.

Don't:

- **Review quality collapses.** A focused 200-line PR gets read. A 600-line PR
  spanning three concerns gets skimmed, and skimming money math or an RLS policy
  is how bugs ship.
- **`git bisect` stops working.** A commit doing three things points at three
  possible causes.
- **Scope creep has no natural stop.** The index leads to a query change leads
  to a mapper change, and the PR never lands.

```bash
gh issue create --title "[M7][BE] Add index on account_balances lookup" \
  --label "type:task,stream:backend,area:db,priority:p2"
```

Then link it from your PR description and carry on.

**The exception:** if the current change is *broken* without it — a missing
migration for a column you are querying — it belongs in this PR. The test is
whether the PR is correct without it, not whether it would be nicer with it.

## If you get blocked

```bash
gh issue edit 42 --add-label "status:blocked"
```

Comment with what is blocking and which issue it waits on. Then pick up
something else — there is almost always a task in the other stream.

If the block is a missing decision rather than missing code, file a
[spike](../.github/ISSUE_TEMPLATE/04-spike.yml): timeboxed, and its output is a
written finding or an ADR, never merged production code.

## Next

- [07-definition-of-ready-and-done.md](07-definition-of-ready-and-done.md) — when to start, when you're finished.
- [08-ci-gates.md](08-ci-gates.md) — reproducing each gate locally.
- [09-database-changes.md](09-database-changes.md) — the schema-change sequence in detail.
