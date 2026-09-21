# Where'd My Money Go

> A simple budgeting app that answers one question: Where'd my money go?

[![ci](https://github.com/jorge/whered-my-money-go/actions/workflows/ci.yml/badge.svg)](https://github.com/jorge/whered-my-money-go/actions/workflows/ci.yml)
[![security](https://github.com/jorge/whered-my-money-go/actions/workflows/security.yml/badge.svg)](https://github.com/jorge/whered-my-money-go/actions/workflows/security.yml)
[![docs](https://github.com/jorge/whered-my-money-go/actions/workflows/docs.yml/badge.svg)](https://github.com/jorge/whered-my-money-go/actions/workflows/docs.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> [!IMPORTANT]
> **Status: documentation and CI scaffold. No application code yet.**
>
> The architecture, development process, and full MVP backlog are written; the
> app is not. Every CI job exists and skips gracefully until the code it checks
> lands. See [ADR-0006](docs/adr/0006-docs-ci-first-scaffold.md) for why it was
> built in that order, and [M0](tasks/backlog/m0-foundation.md) for what comes
> next.

## The idea

Most budgeting apps tell you what you spent. This one tells you what you can
spend.

Instead of:

> "You spent ₱35,000 this month."

it answers:

> "You have ₱12,400 that's actually safe to spend after accounting for your
> upcoming bills, savings target, and expected income."

Two features carry that difference:

- **Safe to Spend** — your balance minus everything you have already promised to
  bills, savings, and debt this period. Shown with a breakdown you can open, so
  the number is auditable rather than merely asserted.
- **Money Timeline** — what happens to your money next, chronologically, with a
  running projected balance and the first date you would go negative.

The full product specification is
[docs/product/product-spec.md](docs/product/product-spec.md).

## Where things are

| Directory | Contents |
|---|---|
| **[docs/](docs/)** | Architecture, domain algorithms, security, operations, decision records |
| **[workflow/](workflow/)** | How development works here — branching, commits, PRs, CI gates, releases |
| **[tasks/](tasks/)** | The MVP backlog: 10 milestones, every task with acceptance criteria |
| **[.github/](.github/)** | Issue and PR templates, six CI workflows |

## Start here

1. [docs/product/product-spec.md](docs/product/product-spec.md) — what the product is
2. [docs/architecture/README.md](docs/architecture/README.md) — how it fits together
3. [docs/domain/safe-to-spend.md](docs/domain/safe-to-spend.md) — the headline feature, specified precisely
4. [workflow/README.md](workflow/README.md) — how to work here
5. [tasks/milestones.md](tasks/milestones.md) — what to build next

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js App Router · TypeScript · Tailwind · shadcn/ui · Recharts |
| Backend | Supabase — Postgres, Auth, Row Level Security |
| Domain logic | Pure, dependency-free TypeScript in `lib/core` |
| Tests | Vitest (unit + integration) · pgTAP (RLS) · Playwright (E2E) |
| Deploy | Vercel + Supabase |

Decisions and their alternatives: [docs/adr/](docs/adr/).

## The rules that matter

Each is enforced by lint, CI, or a review gate — and each exists because its
absence is how this category of app fails.

- **Money is integer minor units.** `₱1,234.56` is `123456`. No floats, anywhere.
- **Never trust the client for ownership.** Every `id` is re-verified
  server-side, even though RLS also enforces it.
- **Every table has Row Level Security** — CI fails the build otherwise.
- **`lib/core` stays pure.** No React, no database, no `process.env`, no clock.
- **Balances are derived** from transactions, never stored.
- **Calendar dates, never UTC instants.** The most common bug class in
  budgeting apps.
- **Migrations are forward-only.** Down-migrations on financial data lose records.

## Milestones

| | Milestone | Demoable outcome |
|---|---|---|
| M0 | Foundation & Toolchain | The app runs; all CI jobs execute for real |
| M1 | Auth & Profile | Sign up → dashboard → log out → log back in |
| M2 | Accounts | Create Cash + Bank + GCash, see balances |
| M3 | Transactions & Categories | Add income and expenses, categorise, search |
| M4 | Dashboard Core | Tiles, cash-flow chart, spending breakdown |
| M5 | Budgets | Monthly category budgets with progress and warnings |
| M6 | Savings Goals | Create a goal, contribute, see the projected date |
| **M7** | **Safe to Spend** ⭐ | The headline number, with an explainable breakdown |
| **M8** | **Money Timeline** ⭐ | Future events, projected balance, shortfall warning |
| M9 | MVP Hardening & Launch | a11y, mobile, perf, security review, production |

Full breakdown with exit criteria: [tasks/milestones.md](tasks/milestones.md).

## Running it

Nothing is runnable yet — there is no `package.json`. What *does* work today:

```bash
npx markdownlint-cli2 "**/*.md"        # lint the docs
npx lychee --offline --no-progress .   # check every relative link

docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest detect \
  --source=/repo --config=/repo/.gitleaks.toml --verbose
```

Local setup for when there is an app:
[workflow/01-local-setup.md](workflow/01-local-setup.md).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) — and the real detail in
[workflow/](workflow/).

Security vulnerabilities: **do not open an issue.** See
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
