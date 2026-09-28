# 0004 — Vitest for unit and integration, Playwright for E2E

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-09 |
| **Deciders** | @jorge |
| **Affects** | [testing-strategy.md](../ops/testing-strategy.md), `ci.yml`, `e2e.yml`, `M0-B04`, `M0-B09` |

## Context

The test suite has to serve four distinct layers
([testing-strategy.md](../ops/testing-strategy.md)): several hundred pure unit
tests on money math, in-database RLS tests, integration tests against a real
Supabase, and a thin browser suite.

The forces:

- **Unit tests must be fast enough to run on every save.** They are the primary
  feedback loop for `lib/core`, and a slow suite stops being run.
- **The project is TypeScript and ESM throughout.** Next.js 16, native ESM.
- **Property-based testing is required.** Each domain doc lists invariants to
  check over generated inputs.
- **One developer.** Configuration time is product time.

## Decision

| Layer | Tool |
|---|---|
| Unit | **Vitest** |
| Integration | **Vitest** (separate project, local Supabase) |
| RLS isolation | **pgTAP** via `supabase test db` |
| E2E | **Playwright**, Chromium only |
| Property tests | **fast-check**, inside Vitest |

Two Vitest *projects* in one config — `unit` (no setup, no database) and
`integration` (Supabase-aware setup) — so `npm run test` stays fast while
integration runs separately in CI.

Coverage via `@vitest/coverage-v8`, thresholds in `vitest.config.ts` rather than
in CI, so the same command fails identically on a laptop and in the pipeline.

## Consequences

### What this makes easier

- **ESM and TypeScript work with no configuration.** Vitest uses Vite's
  transform pipeline; there is no `ts-jest`, no `transformIgnorePatterns`, no
  ESM/CJS interop debugging.
- **Watch mode is genuinely instant** on `lib/core`, because those tests import
  nothing.
- **One runner, one assertion API** across unit and integration. No context
  switch, no two sets of mocking semantics.
- **Playwright's tooling is a real advantage** — trace viewer, auto-waiting, and
  `--ui` mode. Auto-waiting is the specific reason flakiness stays manageable.
- **pgTAP tests RLS where RLS runs.** A test going through application code
  proves the app is careful, not that the database is safe.

### What this makes harder

- **Vitest is less universally known than Jest.** Fewer Stack Overflow answers,
  though the API is deliberately Jest-compatible so most knowledge transfers.
- **Playwright needs browser binaries** — an install step in CI and locally
  (~200 MB).
- **pgTAP is a fourth tool** with its own SQL-flavoured assertion syntax.
  Justified by testing RLS in the right place.
- **E2E remains the slowest, most fragile layer** regardless of tool.

## Alternatives considered

### Jest + Playwright

**What it was.** The conventional choice. Enormous ecosystem, universally known.

**Why rejected.** Jest's ESM support is still awkward, and Next.js 16 with
native ESM is exactly where that hurts: `transformIgnorePatterns`,
`extensionsToTreatAsEsm`, and `moduleNameMapper` become ongoing maintenance
rather than one-time setup. Jest is also measurably slower on the watch loop
that matters most here. Vitest's Jest-compatible API means very little
knowledge is lost.

### Vitest only, no E2E

**What it was.** Skip Playwright. Rely on unit and integration tests.

**Why rejected.** Nothing below E2E catches a broken auth redirect, a Server
Action that fails only in a real browser, or a render crash from a Client
Component boundary. More specifically, spec §31's nine questions are *user*
questions — "can I see how much I can safely spend" is answerable only by a test
that signs in and looks at the page. The suite stays thin (~15 tests) precisely
to keep the cost proportionate.

### Cypress for E2E

**What it was.** Mature, good developer experience, large ecosystem.

**Why rejected.** Playwright's auto-waiting is more reliable than Cypress's
retry model for the async, server-rendered flows here, its trace viewer is
better for debugging a CI-only failure, and it runs faster in CI. Cypress's
in-browser architecture also complicates testing multi-origin auth redirects.

### Testing RLS through the application instead of pgTAP

**What it was.** Integration tests asserting that a cross-user query returns
nothing.

**Why rejected — and this is the important one.** It tests the wrong thing. If
the application layer filters by `user_id` (it does, as defence in depth), the
test passes *whether or not RLS works*. It would give a green suite while every
table sat unprotected — and the anon key is public by design
([security-model.md](../security/security-model.md)). pgTAP connects as the user
role and asks Postgres directly. Both layers are tested; they are not the same
test.

## Revisit when

- Visual regression becomes worth its maintenance cost (currently a manual pass
  in `M9-F01`).
- Cross-browser rendering bugs actually appear — then add browsers to the
  Playwright matrix, which is a config change.
- The E2E suite approaches the 10-minute budget and needs sharding.

## References

- [testing-strategy.md](../ops/testing-strategy.md) — the pyramid and thresholds
- [ADR-0003](0003-pure-typescript-domain-core.md) — the purity that makes unit tests cheap
- [rls-policies.md](../architecture/rls-policies.md) — what pgTAP verifies
- Spec §31 — the nine questions the E2E suite is scoped to
