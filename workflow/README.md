# Workflow

**This directory is the development process for this repository: how work is
sliced, branched, committed, reviewed, gated, migrated, and released.**

It is written for a solo developer building a portfolio-grade product, which
creates a specific tension worth naming up front. A solo dev can skip almost
every process step and still ship. The reason not to is that this repository is
also the artifact — the process is part of what it demonstrates — and because
the rules that look like ceremony at one developer are the rules that stop
being optional at two. So every rule here either (a) catches a real class of bug
in a money app, or (b) is written so it can tighten without rewriting when a
second contributor arrives. Rules that exist only as decoration are not here.

The repository currently contains **documentation and CI only**. There is no
application code yet — see [`../tasks/backlog/m0-foundation.md`](../tasks/backlog/m0-foundation.md).
Every doc below is written to be accurate today and still correct after M0
lands, so anything not yet runnable is tagged **[available after M0]** rather
than quietly implied.

## The docs

| File | What it answers |
|---|---|
| [01-local-setup.md](01-local-setup.md) | What do I install, and what can I actually run today? |
| [02-branching.md](02-branching.md) | What do I name the branch, and how is `main` protected? |
| [03-commits.md](03-commits.md) | What does a commit message look like, and which scope do I use? |
| [04-pull-requests.md](04-pull-requests.md) | How big is too big, what goes in the description, what do I review first? |
| [05-milestones-and-streams.md](05-milestones-and-streams.md) | How does one person work "in parallel"? What is a milestone allowed to be? |
| [06-task-lifecycle.md](06-task-lifecycle.md) | Issue to merged, with the actual commands. |
| [07-definition-of-ready-and-done.md](07-definition-of-ready-and-done.md) | When may I start, and when am I finished? |
| [08-ci-gates.md](08-ci-gates.md) | What does each CI job check, how do I reproduce it locally, and why is CI green on an empty repo? |
| [09-database-changes.md](09-database-changes.md) | How do I change the schema without breaking the deployed app? |
| [10-release.md](10-release.md) | How does this ship, in what order, and how do I roll back? |
| [11-agent-and-ai-usage.md](11-agent-and-ai-usage.md) | What may AI write here, and what must a human own? |

## 60-second version: how I work here

1. **Pick one `status:ready` issue** from the current milestone
   ([`../tasks/milestones.md`](../tasks/milestones.md)). One issue, one branch,
   one PR. If it doesn't meet the
   [Definition of Ready](07-definition-of-ready-and-done.md#definition-of-ready),
   groom it first rather than starting and discovering the gaps mid-branch.
2. **Branch off fresh `main`**: `feat/42-safe-to-spend-card`. Rebase to update,
   never merge `main` in. See [02-branching.md](02-branching.md).
3. **Contract before UI.** Every milestone opens with one `type:contract` task
   that lands the migration, the regenerated `types/database.types.ts`, the Zod
   schemas, and the domain types. That task blocks the milestone's frontend
   tasks; once it merges, frontend and backend proceed against the same types at
   the same time. This — not branch isolation — is where parallelism comes from.
   See [05-milestones-and-streams.md](05-milestones-and-streams.md).
4. **Failing test first for anything in `lib/core`.** That is the money math.
   It is pure, it is the product, and it is the one place where tests are not
   negotiable ([ADR-0003](../docs/adr/0003-pure-typescript-domain-core.md)).
5. **Commit in conventional increments**: `feat(sts): add safe-to-spend
   breakdown computation`, `Refs #42`. See [03-commits.md](03-commits.md).
6. **`npm run verify` locally**, then push. Reproducing a gate locally is
   always cheaper than a CI round trip — [08-ci-gates.md](08-ci-gates.md) lists
   the local command for every job.
7. **Open the PR, self-review the diff first**, then let the gates run.
   `ci`, `security`, and `docs` are the required aggregate checks.
8. **Squash merge.** The PR title becomes the commit, so the title itself has to
   be a valid conventional commit. Branch deletes itself; `Closes #42` closes
   the issue.
9. **New work discovered? File a new issue.** Do not grow the PR. See
   [06-task-lifecycle.md](06-task-lifecycle.md#the-scope-rule).

> [!IMPORTANT]
> Two rules override convenience every time, because a budgeting app that gets
> them wrong is worse than no budgeting app. **Money is integer minor units** —
> never a float, anywhere, including in transit. **Every table has RLS plus a
> pgTAP test proving cross-user reads return nothing.** Neither is a follow-up
> task.

## Where else to look

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — the signpost GitHub shows in the
  issue and PR UI; it links back into these files.
- [`../docs/`](../docs/) — what the software *is*:
  [architecture](../docs/architecture/README.md),
  [domain rules](../docs/domain/money-and-rounding.md),
  [security model](../docs/security/security-model.md),
  [ADRs](../docs/adr/), and the
  [product spec](../docs/product/product-spec.md).
- [`../tasks/`](../tasks/) — what to *do* next: the
  [milestone plan](../tasks/milestones.md) and the per-milestone backlogs.
- [`../docs/architecture/source-structure.md`](../docs/architecture/source-structure.md)
  — the directory ownership table and import rules that make the stream split
  work. Read it before your first PR; most process questions here are downstream
  of that document.
