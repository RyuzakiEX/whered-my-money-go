# Documentation

Everything about how this application is built and why.

> [!IMPORTANT]
> **No application code exists yet.** This repository currently holds
> documentation and CI only — see
> [ADR-0006](adr/0006-docs-ci-first-scaffold.md) for why. Documents describing
> source layout carry a **PLANNED** banner until
> [M9-B07](../tasks/backlog/m9-mvp-hardening-and-launch.md) reconciles them
> against shipped behaviour.

## Read these first

In order, if you are new to the project:

1. **[product/product-spec.md](product/product-spec.md)** — what the product is.
2. **[architecture/system-architecture.md](architecture/system-architecture.md)** — how it runs.
3. **[architecture/source-structure.md](architecture/source-structure.md)** — where code goes and what it may import.
4. **[domain/safe-to-spend.md](domain/safe-to-spend.md)** — the headline feature, specified.
5. **[../workflow/README.md](../workflow/README.md)** — how to work here.
6. **[../tasks/milestones.md](../tasks/milestones.md)** — what to build next.

## Product

| Document | Contents |
|---|---|
| [product/product-spec.md](product/product-spec.md) | The full product specification, 33 sections. **Canonical source of truth for product intent.** Cited throughout as "spec §N". |
| [product/glossary.md](product/glossary.md) | One name per concept. Read before naming a function or a column. |
| [product/success-criteria.md](product/success-criteria.md) | Spec §31's nine questions as testable criteria, mapped to milestones and E2E tests. |

> [!NOTE]
> **`product-spec.md` is a faithful transcription.** It was reformatted from the
> original `plan.md` with no requirement added, removed, reworded, or reordered.
> Every *decision* derived from it — column types, formulas, thresholds,
> constraints — lives in `architecture/` and `domain/` instead, so the spec
> stays a record of intent rather than of implementation.

## Architecture

| Document | Contents |
|---|---|
| [architecture/README.md](architecture/README.md) | One-screen "how it all fits". |
| [architecture/system-architecture.md](architecture/system-architecture.md) | Topology, request flows, **trust boundaries**, scale posture, non-goals. |
| [architecture/source-structure.md](architecture/source-structure.md) | The planned tree, the **import-rules matrix**, stream ownership. The load-bearing document. |
| [architecture/data-model.md](architecture/data-model.md) | Every table, column, type, constraint, index. Migration ordering per milestone. |
| [architecture/rls-policies.md](architecture/rls-policies.md) | Row Level Security design and the **cross-table ownership** vulnerability. |
| [architecture/api-and-data-access.md](architecture/api-and-data-access.md) | Server Actions vs Route Handlers, validation boundary, error envelope. |
| [architecture/state-and-caching.md](architecture/state-and-caching.md) | Cache tags and the **invalidation matrix**. URL as view state. |
| [architecture/frontend-architecture.md](architecture/frontend-architecture.md) | Route groups, server/client boundary, chart isolation, a11y, brand voice. |
| [architecture/observability.md](architecture/observability.md) | Log shape, the **never-log list**, error tracking, audit log, alerts. |

## Domain algorithms

The product's differentiators, specified precisely enough to implement and test.
Each names its canonical fixture drawn from the spec's own worked example.

| Document | Spec | Milestone |
|---|---|---|
| [domain/safe-to-spend.md](domain/safe-to-spend.md) ⭐ | §9 | M7 |
| [domain/money-timeline.md](domain/money-timeline.md) ⭐ | §10 | M8 |
| [domain/budget-forecasting.md](domain/budget-forecasting.md) | §11, §12 | M5, V2 |
| [domain/goal-projection.md](domain/goal-projection.md) | §13, §14, §18 | M6, V2 |
| [domain/recurrence.md](domain/recurrence.md) | §15 | M8 |
| [domain/money-and-rounding.md](domain/money-and-rounding.md) | — | **All** |

> [!IMPORTANT]
> **[domain/money-and-rounding.md](domain/money-and-rounding.md) is mandatory
> reading** before touching anything involving an amount. Money is integer minor
> units, never a float.

## Security

| Document | Contents |
|---|---|
| [security/security-model.md](security/security-model.md) | Assets, the **three-layer rule**, threats and mitigations, secrets inventory, review gates. |
| [security/ci-security-gates.md](security/ci-security-gates.md) | What each scanner catches, thresholds, triage, suppression policy, leaked-secret runbook. |

See also [../SECURITY.md](../SECURITY.md) for vulnerability reporting.

## Operations

| Document | Contents |
|---|---|
| [ops/environments.md](ops/environments.md) | Local / preview / production. Env var matrix, secret placement. |
| [ops/database-migrations.md](ops/database-migrations.md) | Migration workflow, forward-only rule, expand/contract, what CI verifies. |
| [ops/testing-strategy.md](ops/testing-strategy.md) | The four test layers, coverage thresholds, fixtures. |
| [ops/deployment.md](ops/deployment.md) | Vercel + Supabase pipeline, ordering, rollback, performance budgets. |

## Decisions

[adr/README.md](adr/README.md) — the index, the process, and when to write one.

| # | Decision |
|---|---|
| [0001](adr/0001-single-nextjs-app-not-monorepo.md) | Single Next.js app, not a monorepo |
| [0002](adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md) | Supabase CLI migrations are the schema source of truth |
| [0003](adr/0003-pure-typescript-domain-core.md) | Domain logic is pure, dependency-free TypeScript |
| [0004](adr/0004-testing-stack-vitest-playwright.md) | Vitest for unit and integration, Playwright for E2E |
| [0005](adr/0005-money-as-integer-minor-units.md) | Money is stored and computed as integer minor units |
| [0006](adr/0006-docs-ci-first-scaffold.md) | Documentation and CI land before application code |

## The rules worth knowing before you write anything

Each is enforced somewhere — lint, CI, or a review gate — and each exists
because its absence is how this category of application fails.

| Rule | Detail |
|---|---|
| **Money is integer minor units** | No floats. [ADR-0005](adr/0005-money-as-integer-minor-units.md) |
| **Never trust the client for ownership** | Every `id` re-verified server-side, even though RLS also enforces it. [security-model.md](security/security-model.md#the-three-layer-rule) |
| **Every table has RLS** | CI fails the build otherwise. [rls-policies.md](architecture/rls-policies.md) |
| **`lib/core` stays pure** | No React, Next, supabase-js, `process.env`, or clock. [ADR-0003](adr/0003-pure-typescript-domain-core.md) |
| **Balances are derived** | Never a stored mutable column. [data-model.md](architecture/data-model.md) |
| **Calendar dates, not instants** | The most common bug class in budgeting apps. [recurrence.md](domain/recurrence.md#the-timezone-rule) |
| **Migrations are forward-only** | Down-migrations on financial data lose records. [database-migrations.md](ops/database-migrations.md) |
| **Never log an amount with an identity** | [observability.md](architecture/observability.md#never-log-this) |
| **Docs change in the same PR** as the behaviour they describe | [../workflow/07-definition-of-ready-and-done.md](../workflow/07-definition-of-ready-and-done.md) |

## Maintaining these docs

- A behaviour or schema change updates its documentation **in the same pull
  request**. Not as a follow-up.
- Adding a document adds a row above. CI fails if a listed document is missing
  (`docs.yml` → *docs structure checks*).
- Adding an ADR adds a row to [adr/README.md](adr/README.md). Also CI-checked.
- Markdown lint and relative-link checks run on every PR — reproduce locally
  with `npx markdownlint-cli2 "**/*.md"` and `npx lychee --offline .`
