# Contributing

The development process for this repository lives in **[`/workflow`](workflow/)**.

GitHub surfaces this file in the issue and pull-request UI, so it exists as a
signpost. The real content is over there.

## Start here

| I want to… | Read |
|---|---|
| Understand how work flows here | [workflow/README.md](workflow/README.md) |
| Set up my machine | [workflow/01-local-setup.md](workflow/01-local-setup.md) |
| Know what to work on next | [tasks/README.md](tasks/README.md) |
| Understand how the app is built | [docs/architecture/README.md](docs/architecture/README.md) |
| Know what the product is meant to do | [docs/product/product-spec.md](docs/product/product-spec.md) |

## The short version

1. **Pick a `status:ready` issue** from the current milestone matching your
   stream — see [tasks/milestones.md](tasks/milestones.md).
2. **Branch** from an up-to-date `main`: `<type>/<issue-number>-<slug>`, e.g.
   `feat/42-safe-to-spend-card`. See
   [workflow/02-branching.md](workflow/02-branching.md).
3. **Write the failing test first** for anything in `lib/core` — that's where
   the money math lives, and it is the one place tests are non-negotiable.
4. **Commit** using [Conventional Commits](workflow/03-commits.md):
   `feat(sts): add safe-to-spend breakdown computation`.
5. **Open a PR** from the template, linking `Closes #42`. Every checklist item
   in the template is there because something went wrong without it once.
6. **Green CI, then squash merge.** See
   [workflow/08-ci-gates.md](workflow/08-ci-gates.md) for what each gate checks
   and how to reproduce it locally.

## Non-negotiables

These are the rules worth stating twice, because violating them is how a
budgeting app loses someone's money:

- **Money is integer minor units.** No floats, ever. See
  [docs/domain/money-and-rounding.md](docs/domain/money-and-rounding.md).
- **Never trust the client for ownership.** Every Server Action accepting an
  `id` re-verifies ownership server-side, even though RLS also enforces it.
  See [docs/security/security-model.md](docs/security/security-model.md).
- **Every table has Row Level Security** and a test proving cross-user access
  returns nothing. See
  [docs/architecture/rls-policies.md](docs/architecture/rls-policies.md).
- **`lib/core` stays pure.** No React, no Next, no supabase-js, no `process.env`,
  no `Date.now()`. The import rules are enforced by lint — see
  [docs/architecture/source-structure.md](docs/architecture/source-structure.md).
- **Docs change in the same PR** as the behaviour they describe. Not as a
  follow-up.

## Reporting problems

- **Bugs and tasks** — use the [issue templates](https://github.com/jorge/whered-my-money-go/issues/new/choose).
  Blank issues are disabled on purpose: the forms collect what triage needs.
- **Security vulnerabilities** — do **not** open an issue. See
  [SECURITY.md](SECURITY.md).
