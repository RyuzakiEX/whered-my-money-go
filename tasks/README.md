# Tasks

**The executable backlog.** Every MVP task is written out here with acceptance
criteria, ready to paste into a GitHub issue. If a task is not in this
directory, it is not in the MVP.

| | |
|---|---|
| **Document type** | Working backlog — the plan of record for *when* things get built |
| **Source of truth for scope** | [../docs/product/product-spec.md](../docs/product/product-spec.md) §26 |
| **Status** | MVP not yet started; M0 is the entry point |

## Contents

- [How the backlog works](#how-the-backlog-works)
- [Milestones](#milestones)
- [Label taxonomy](#label-taxonomy)
- [Task IDs and tracking](#task-ids-and-tracking)
- [Issue title format](#issue-title-format)
- [How to file these as GitHub issues](#how-to-file-these-as-github-issues)
- [Definition of Ready and Done](#definition-of-ready-and-done)

## How the backlog works

Three layers, deliberately separated:

| Layer | Lives in | Answers |
|---|---|---|
| **Product intent** | [../docs/product/product-spec.md](../docs/product/product-spec.md) | What should the product do? |
| **Design decisions** | [../docs/architecture/](../docs/architecture/), [../docs/domain/](../docs/domain/) | How is it built, and why that way? |
| **Work items** | this directory | Who builds what, in which order, and how do we know it's done? |

Each milestone is one backlog file. Each file holds a task table where every row
is a future GitHub issue: an ID, the owning stream, a title, and acceptance
criteria specific enough to argue about.

Work proceeds one milestone at a time, but **within** a milestone the frontend,
backend, and devops streams run in parallel. That is only possible because each
milestone opens with a `type:contract` task that lands the migration, the
generated database types, the Zod schemas, and the domain types together. Once
that merges, frontend builds against real types with fixtures while backend
implements the queries. See
[../docs/architecture/source-structure.md](../docs/architecture/source-structure.md)
for the directory-level stream ownership that keeps the two from colliding.

> [!NOTE]
> Acceptance criteria in this backlog are written as verifiable clauses, not
> intentions. "Works correctly" is not an acceptance criterion. "Deleting an
> account with transactions returns a blocked result and offers archive
> instead" is.

## Milestones

| ID | Milestone | Backlog |
|---|---|---|
| **M0** | Foundation & Toolchain | [backlog/m0-foundation.md](backlog/m0-foundation.md) |
| **M1** | Auth & Profile | [backlog/m1-auth-and-profile.md](backlog/m1-auth-and-profile.md) |
| **M2** | Accounts | [backlog/m2-accounts.md](backlog/m2-accounts.md) |
| **M3** | Transactions & Categories | [backlog/m3-transactions-and-categories.md](backlog/m3-transactions-and-categories.md) |
| **M4** | Dashboard Core | [backlog/m4-dashboard-core.md](backlog/m4-dashboard-core.md) |
| **M5** | Budgets | [backlog/m5-budgets.md](backlog/m5-budgets.md) |
| **M6** | Savings Goals | [backlog/m6-goals.md](backlog/m6-goals.md) |
| **M7** | Safe to Spend ⭐ | [backlog/m7-safe-to-spend.md](backlog/m7-safe-to-spend.md) |
| **M8** | Money Timeline ⭐ | [backlog/m8-money-timeline.md](backlog/m8-money-timeline.md) |
| **M9** | MVP Hardening & Launch | [backlog/m9-mvp-hardening-and-launch.md](backlog/m9-mvp-hardening-and-launch.md) |
| — | V2 outline | [backlog/v2-outline.md](backlog/v2-outline.md) |
| — | V3 outline | [backlog/v3-outline.md](backlog/v3-outline.md) |

Goals, demoable outcomes, the dependency graph, and the mapping from spec §31's
nine success questions to milestones live in
[milestones.md](milestones.md).

## Label taxonomy

Four dimensions. **Every issue carries exactly one label from each**, plus a
GitHub Milestone.

| Dimension | Prefix | Answers | Values |
|---|---|---|---|
| **Stream** | `stream:` | Who picks this up? | frontend · backend · shared · devops |
| **Type** | `type:` | What kind of work is it? | feature · task · contract · bug · chore · docs · test · spike · security |
| **Priority** | `priority:` | When? | p0 · p1 · p2 · p3 |
| **Area** | `area:` | Which part of the product? | auth · accounts · transactions · categories · budgets · goals · timeline · sts · dashboard · reports · db · rls · ci · ui · a11y |

Two optional dimensions on top: `status:` (blocked / ready / needs-info) marks
triage state, and `good-first-task` flags issues a newcomer can finish without
reading the whole architecture.

Full table with colors and meanings: [labels.md](labels.md).

> [!NOTE]
> **Milestones are GitHub Milestones, not labels.** There is no `milestone:m7`
> label and there should never be one — GitHub Milestones give burndown,
> due dates, and the "open/closed in this milestone" view that a label cannot.

## Task IDs and tracking

Doc-side task IDs are stable identifiers of the form:

```text
M<n>-<stream initial><nn>

M7-B02   milestone 7, backend task 02
M7-F01   milestone 7, frontend task 01
M0-S03   milestone 0, shared task 03
M9-D05   milestone 9, devops task 05
```

Stream initials: `B` backend · `F` frontend · `S` shared · `D` devops.

> [!NOTE]
> In this backlog, shared and devops tasks keep the `B` prefix where they were
> numbered alongside backend work in a single sequence — the ID is an opaque
> stable handle, and the `Stream` column is authoritative for ownership. Never
> renumber an ID once it has an issue against it.

These IDs never change. They are what commit messages, ADRs, and other docs
cite, so a link stays valid even after the issue is closed and the milestone
archived.

GitHub issue numbers flow the other way. When an issue is filed, record its
number in the backlog file's `Issue` column:

```markdown
| M7-B01 | backend | [M7][BE] Implement computeSafeToSpend in lib/core | … | #128 |
```

That gives a two-way cross-reference: the issue body cites `M7-B01`, and the
backlog row cites `#128`. Neither side goes stale silently, and the progress
table at the top of each backlog file can be ticked off as issues close.

## Issue title format

```text
[M<n>][<STREAM>] <imperative summary>
```

```text
[M7][BE] Implement computeSafeToSpend in lib/core
[M7][FE] Build Safe to Spend hero card
[M3][SH] Define transaction Zod schemas and domain types
[M0][DO] Activate CI jobs now that package.json exists
```

Stream codes in titles: `BE` · `FE` · `SH` · `DO`.

The point is that milestone and stream are visible in **any** list view —
search results, notification emails, a project board grouped by something
else, the commit that closes the issue. Labels are filterable but not always
rendered; the title always is.

## How to file these as GitHub issues

Do this a milestone at a time, not all ninety at once. A backlog of open issues
for work three milestones away is noise.

1. **Create the GitHub Milestone** for `M<n>` if it does not exist. Name it
   exactly as in [milestones.md](milestones.md) — e.g. `M7 — Safe to Spend`.
   Set a due date if you are tracking velocity.
2. **Open the issue form**: *New issue → Task*, which is
   [`.github/ISSUE_TEMPLATE/01-task.yml`](../.github/ISSUE_TEMPLATE/01-task.yml).
   Blank issues are disabled deliberately — the form collects what triage
   needs. A copy-paste skeleton mirroring the form's fields lives at
   [templates/task-issue.md](templates/task-issue.md).
3. **Title**: paste the backlog row's title verbatim, including the
   `[M7][BE]` prefix.
4. **Context / why**: state the outcome and cite the source — `spec §9`,
   `docs/domain/safe-to-spend.md`, or the milestone goal. One paragraph.
5. **Acceptance criteria**: split the backlog row's semicolon-separated clauses
   into one Markdown checkbox each. Each clause is deliberately one testable
   assertion, so the split is mechanical:

   ```markdown
   - [ ] `computeSafeToSpend` is pure and takes `today` as a parameter
   - [ ] Returns the total plus every contributing term
   - [ ] Spec §9's example passes as a fixture (₱23,500)
   - [ ] Module coverage ≥ 95%
   ```

6. **Depends on**: reference the blocking task by doc ID *and* issue number
   once known — `M7-B01 (#128)`. Contract tasks list every frontend task they
   block.
7. **Labels**: one `stream:`, one `type:`, one `priority:`, one `area:`. Add
   `status:blocked` if a dependency is open.
8. **Milestone**: set the real GitHub Milestone on triage. Do not skip this —
   it is how the burndown works, and an issue with no milestone is invisible to
   the "what's left in M7" question.
9. **Record the issue number** back into the backlog file's `Issue` column in
   the same session. If you file ten issues and record none, the cross-reference
   is already broken.

Sanity check before filing: the task should satisfy the Definition of Ready. If
it does not — an open question, an undecided schema column, a missing design
decision — label it `status:needs-info` and resolve that before anyone starts.

## Definition of Ready and Done

- [../workflow/05-milestones-and-streams.md](../workflow/05-milestones-and-streams.md)
  — how milestones are sequenced and how the three streams share one milestone
  without blocking each other.
- [../workflow/07-definition-of-ready-and-done.md](../workflow/07-definition-of-ready-and-done.md)
  — the gates a task passes on the way in and on the way out. Copy the DoR
  checklist into the issue; the PR template carries the DoD.

Related: [../workflow/03-commits.md](../workflow/03-commits.md) for the commit
scopes that mirror the `area:` labels, and
[../CONTRIBUTING.md](../CONTRIBUTING.md) for the short version of the whole
process.
