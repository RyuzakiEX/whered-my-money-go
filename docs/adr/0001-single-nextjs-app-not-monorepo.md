# 0001 — Build a single Next.js app, not a monorepo

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-09 |
| **Deciders** | @jorge |
| **Affects** | [source-structure.md](../architecture/source-structure.md), all milestones |

## Context

Spec §23 names Next.js, TypeScript, Supabase, and Vercel. It does not say how
the repository is organised.

The forces in tension:

- **Boundaries matter here.** The money math must stay isolated from React and
  from I/O — that is [ADR-0003](0003-pure-typescript-domain-core.md). A monorepo
  package boundary enforces that at the module-resolution level, which is
  stronger than a lint rule.
- **Two streams work in parallel.** `stream:frontend` and `stream:backend` work
  the same milestone simultaneously
  ([workflow/05](../../workflow/05-milestones-and-streams.md)). Package
  boundaries would make ownership unambiguous.
- **It is one deployable unit.** Next.js on Vercel talking to Supabase. There is
  no second application, no shared library consumed elsewhere, no independent
  release cadence.
- **One developer.** Every minute of tooling overhead is a minute not spent on
  the product, and spec §33 asks for the smallest thing that works.

## Decision

**We will build a single Next.js application at the repository root** — one
`package.json`, one `tsconfig.json`, one `node_modules`, no workspace tooling.

Layer boundaries are enforced by **ESLint `no-restricted-imports`** (`M0-B02`)
against the import matrix in
[source-structure.md](../architecture/source-structure.md#import-rules), backed
by a fixture that must fail lint.

Stream ownership is by **directory**, not by package: `stream:frontend` owns
`app/**` and `components/**`; `stream:backend` owns `lib/core/**`,
`lib/server/**`, and `supabase/**`.

## Consequences

### What this makes easier

- **Setup is `npm ci`.** No workspace protocol, no build orchestration, no
  package graph to reason about.
- **CI is simple and fast.** One install, one lint, one typecheck. No caching
  strategy per package, no task graph.
- **Refactoring across layers is one commit.** Moving a function from
  `lib/server` to `lib/core` does not touch package manifests.
- **Editor tooling just works.** One TypeScript project, no path-mapping or
  project-reference configuration.

### What this makes harder

- **Boundary enforcement is a lint rule, not the module resolver.** A developer
  can add an `eslint-disable` comment; a package boundary would refuse to
  resolve. Mitigated by the deliberate-violation fixture in CI and by review, but
  it is genuinely weaker.
- **Accidental coupling is possible.** Nothing stops importing `lib/server` from
  a component except lint.
- **Extracting `lib/core` later requires work** — moving files, adding a
  manifest, wiring a build.

### What this forecloses

- **A second consumer of the domain logic.** A React Native app or a scheduled
  worker sharing `lib/core` would need the extraction above. Given the MVP is
  one web app, that cost is deferred, not paid.

## Alternatives considered

### pnpm workspace: `apps/web` + `packages/{core,db,ui}`

**What it was.** Genuine package boundaries, so `packages/core` physically
cannot import React — the resolver would fail, not a linter.

**Why rejected.** The isolation it buys is real, but it is the *only* thing it
buys here, and a lint rule with a failing-fixture test gets most of the way for
none of the cost. Against that: workspace protocol quirks, a slower and more
complex CI, `node_modules` hoisting surprises, and per-package tsconfig
management — all carried by one developer building one deployable app. Spec §33
argues against it directly.

**Revisit if** a second consumer of `lib/core` appears, or a second developer
finds the lint boundary insufficient in practice.

### Turborepo or Nx

**What it was.** A monorepo plus task orchestration and remote caching.

**Why rejected.** These solve slow CI across many packages. With one package
there is nothing to orchestrate and nothing to cache beyond what `actions/setup-node`
already does. Pure overhead at this scale.

### Single app with no enforced boundaries

**What it was.** One app, layer separation by convention and review only.

**Why rejected.** Conventions rot, and the specific convention at risk here is
the one keeping money math testable. `lib/core` accreting a React import or a
`Date.now()` call would be found by a failing test months later, or by a user.
The lint rule costs one task (`M0-B02`) and makes the boundary mechanical.

## Revisit when

- A second application needs `lib/core` (mobile, a worker, a public API).
- A second developer joins and the lint boundary proves insufficient.
- `lib/core` grows large enough to warrant an independent release cadence.

## References

- Spec §23 (tech stack), §33 (MVP principle)
- [source-structure.md](../architecture/source-structure.md) — the import matrix this replaces packages with
- [ADR-0003](0003-pure-typescript-domain-core.md) — the boundary that most needs enforcing
