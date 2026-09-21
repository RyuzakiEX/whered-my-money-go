# Labels

**Four dimensions, one label from each on every issue, plus a GitHub
Milestone.** That combination is what makes "ready backend work in the current
milestone touching RLS" a single filter instead of a conversation.

| | |
|---|---|
| **Document type** | Label taxonomy — the human-readable source |
| **Machine-readable mirror** | [`.github/labels.yml`](../.github/labels.yml) |

## Contents

- [The four dimensions](#the-four-dimensions)
- [Stream](#stream)
- [Type](#type)
- [Priority](#priority)
- [Area](#area)
- [Status and flags](#status-and-flags)
- [Milestones are not labels](#milestones-are-not-labels)
- [Keeping labels.yml in sync](#keeping-labelsyml-in-sync)

## The four dimensions

| Dimension | Answers | Cardinality |
|---|---|---|
| **Stream** | Who picks this up? | Exactly one |
| **Type** | What kind of work is it? | Exactly one |
| **Priority** | When does it get done? | Exactly one |
| **Area** | Which part of the product does it touch? | Exactly one (occasionally two — see below) |

Every task issue carries one of each **plus a milestone**. An issue missing a
dimension is not triaged; that is the practical definition of "not ready".

The dimensions are orthogonal on purpose. Stream routes the work to a person,
type sets expectations about review depth, priority orders the queue, and area
maps to the commit scope so the git history and the issue tracker use the same
vocabulary. A single flat label list cannot do that — you end up with
`frontend-bug-urgent-auth` and no way to filter it.

Area is the one dimension that occasionally takes two labels: a task that
changes a table *and* its policies legitimately carries `area:db` and
`area:rls`. Resist further stacking — three areas usually means the task should
be split.

## Stream

Ownership by directory, per
[../docs/architecture/source-structure.md](../docs/architecture/source-structure.md#stream-ownership).

| Label | Color | Meaning |
|---|---|---|
| `stream:frontend` | `#1D76DB` | `app/**` and `components/**` — pages, layouts, presentational components, client interactivity |
| `stream:backend` | `#0E8A16` | `lib/core/**`, `lib/server/**`, `supabase/**`, unit and integration tests — migrations, RLS, queries, actions, domain math |
| `stream:shared` | `#5319E7` | `lib/validation/**`, `lib/utils/**` — backend authors, frontend consumes. Also cross-cutting reviews (security, performance, docs) |
| `stream:devops` | `#B60205` | `.github/**`, config files, `tests/e2e/**` — CI, deploys, Playwright, branch protection |

## Type

| Label | Color | Meaning |
|---|---|---|
| `type:feature` | `#A2EEEF` | User-visible capability that did not exist before |
| `type:task` | `#C5DEF5` | Necessary engineering work with no direct user-visible change |
| `type:contract` | `#FBCA04` | Lands migration + generated types + Zod schemas + domain types together. **Blocks the milestone's frontend tasks** — see the contract-first protocol |
| `type:bug` | `#D73A4A` | Shipped behaviour does not match the spec or the docs |
| `type:chore` | `#EDEDED` | Dependency bumps, renames, cleanup, tooling maintenance |
| `type:docs` | `#0075CA` | Documentation only. Note that docs changed *alongside* behaviour ride in the feature's PR, not a separate issue |
| `type:test` | `#BFD4F2` | Adding or repairing tests where the behaviour already exists |
| `type:spike` | `#D4C5F9` | Time-boxed investigation. Deliverable is a written answer or an ADR, never merged production code |
| `type:security` | `#B60205` | Threat-model finding, hardening, or an RLS/authorization gap. Never gets a `priority:p2` or lower without a written reason |

`type:contract` is the load-bearing one. It exists as its own type because
those tasks have a different shape from everything else: small, reviewed
carefully, merged fast, and blocking. Treating them as ordinary tasks is how a
milestone's frontend stream ends up idle for three days.

## Priority

| Label | Color | Meaning |
|---|---|---|
| `priority:p0` | `#B60205` | Drop everything. Production is broken, data is at risk, or `main` is red |
| `priority:p1` | `#D93F0B` | This milestone. Everything in the MVP backlog's critical path is p1 |
| `priority:p2` | `#FEF2C0` | Next milestone. Real, scheduled, not now |
| `priority:p3` | `#EEEEEE` | Someday. Good ideas with no committed slot — V2/V3 outline items land here |

If everything is p1, nothing is. The check: p0 should be empty most weeks, and
p1 should be roughly the size of one milestone.

## Area

All areas share `#BFDADC` so the dimension reads as one visual group in a list
view — the label text carries the meaning, the color carries the dimension.

| Label | Color | Meaning |
|---|---|---|
| `area:auth` | `#BFDADC` | Sign-up, login, logout, password reset, session, middleware guards, profile |
| `area:accounts` | `#BFDADC` | Accounts CRUD, balances, archive/delete rules |
| `area:transactions` | `#BFDADC` | Income, expense, transfer, list, search, filter |
| `area:categories` | `#BFDADC` | Default and custom categories, colors, icons, reassignment |
| `area:budgets` | `#BFDADC` | Monthly category budgets, progress, warnings |
| `area:goals` | `#BFDADC` | Savings goals, contributions, projected completion |
| `area:timeline` | `#BFDADC` | Money Timeline, recurrence expansion, projected balance |
| `area:sts` | `#BFDADC` | Safe to Spend computation, breakdown, hero card |
| `area:dashboard` | `#BFDADC` | Metric tiles, cash-flow chart, spending breakdown, widgets |
| `area:reports` | `#BFDADC` | Report types and date-range filters (spec §16) |
| `area:db` | `#BFDADC` | Migrations, schema, enums, indexes, views, generated types |
| `area:rls` | `#BFDADC` | Row Level Security policies and pgTAP isolation tests |
| `area:ci` | `#BFDADC` | Workflows, gates, caching, branch protection, deploys |
| `area:ui` | `#BFDADC` | Design tokens, shadcn primitives, app shell, layout, theming |
| `area:a11y` | `#BFDADC` | Keyboard navigation, ARIA, contrast, axe findings |

> [!NOTE]
> These names mirror the **commit scopes** in
> [../workflow/03-commits.md](../workflow/03-commits.md). `feat(sts): …` closes
> an `area:sts` issue. Keeping one vocabulary means `git log --grep 'sts'` and
> the `area:sts` issue filter describe the same body of work — and a new scope
> in a commit is a signal that a label is missing.

## Status and flags

Optional, and orthogonal to the four required dimensions.

| Label | Color | Meaning |
|---|---|---|
| `status:blocked` | `#000000` | A dependency is open. The blocking issue must be named in the body — a blocked label with no named blocker is worse than no label |
| `status:ready` | `#0E8A16` | Passes the Definition of Ready. Anyone on the matching stream can start it without asking a question first |
| `status:needs-info` | `#FBCA04` | An open question prevents readiness — undecided column, missing design decision, ambiguous acceptance criterion |
| `good-first-task` | `#7057FF` | Self-contained, well-specified, finishable without reading the whole architecture. Deliberately **not** GitHub's default `good first issue` — this repo's tasks are tasks |

`status:ready` is the label the "what should I work on" query filters on:

```text
is:issue is:open milestone:"M7 — Safe to Spend" label:stream:backend label:status:ready
```

Definition of Ready and Done:
[../workflow/07-definition-of-ready-and-done.md](../workflow/07-definition-of-ready-and-done.md).

## Milestones are not labels

There is no `milestone:m7` label, and adding one would be a mistake.

GitHub Milestones provide a burndown chart, a due date, an
open/closed progress bar, and a first-class `milestone:` search qualifier.
Labels provide none of that. Modelling milestones as labels loses all of it and
gains nothing, so:

- **GitHub Milestone** — `M7 — Safe to Spend`. Set on triage. Required.
- **Issue title prefix** — `[M7][BE] …`. Redundant with the milestone, and
  deliberately so: the title renders everywhere the milestone field does not.

Milestone sequencing and the dependency graph:
[milestones.md](milestones.md).

## Keeping labels.yml in sync

[`.github/labels.yml`](../.github/labels.yml) mirrors this table
machine-readably so a future label-sync action can create and reconcile labels
from the repository instead of by hand in the GitHub UI. Shape:

```yaml
- name: stream:backend
  color: 0E8A16
  description: lib/core, lib/server, supabase, unit + integration tests
- name: type:contract
  color: FBCA04
  description: Migration + types + Zod + domain types; blocks frontend tasks
- name: area:sts
  color: BFDADC
  description: Safe to Spend computation, breakdown, hero card
```

Two rules while the sync action does not yet exist:

- **This file is the source.** Change it first, then mirror into
  `.github/labels.yml` in the same PR.
- **Never rename a label in the UI only.** A rename that is not reflected in
  both files silently breaks every saved filter and every doc link that names
  it.
