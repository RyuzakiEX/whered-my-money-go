# CI Gates

**Six workflows, five required status checks.** Every job either passes, or is
skipped because the code it checks does not exist yet — and a skipped job never
blocks a pull request.

## Required status checks

Configure branch protection to require exactly these five. They are **aggregate
gates**, not individual jobs:

```text
ci · security · docs · e2e · schema
```

They never need changing as the project grows — that is the whole design, and
[why](#why-ci-is-green-on-an-empty-repo) is below.

## The workflows

| Workflow | Required check | Jobs |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | **`ci`** | preflight · lint · typecheck · unit tests · integration tests · build |
| [`security.yml`](../.github/workflows/security.yml) | **`security`** | gitleaks · trivy · dependency review · npm audit |
| [`docs.yml`](../.github/workflows/docs.yml) | **`docs`** | markdown lint + links · docs structure checks |
| [`e2e.yml`](../.github/workflows/e2e.yml) | **`e2e`** | playwright (chromium) |
| [`schema-drift.yml`](../.github/workflows/schema-drift.yml) | **`schema`** | schema drift (4 gates in one job) |
| [`codeql.yml`](../.github/workflows/codeql.yml) | — (reports only) | codeql (javascript-typescript) · codeql (actions) |

## Every job

| Job | Blocks? | Checks | Reproduce locally |
|---|---|---|---|
| **preflight (detect project)** | No — always passes | Detects `package.json`, lockfile, tests, `supabase/config.toml`, migrations. Writes a summary table. | — |
| **lint** | Yes | ESLint (incl. the [import boundaries](../docs/architecture/source-structure.md#import-rules)) + Prettier | `npm run lint && npm run format:check` |
| **typecheck** | Yes | `tsc --noEmit`, strict | `npm run typecheck` |
| **unit tests** | Yes | Vitest + coverage thresholds | `npm run test -- --coverage` |
| **integration tests** | Yes | Vitest against a local Supabase | `supabase start && npm run test:integration` |
| **build** | Yes | `next build` with placeholder public env | `npm run build` |
| **gitleaks (secret scan)** | **Yes — any finding** | Secrets in **full git history** | `docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest detect --source=/repo --config=/repo/.gitleaks.toml --verbose` |
| **trivy** | Yes at HIGH/CRITICAL on PRs | Dependency CVEs, misconfigured YAML, secrets in the tree | `docker run --rm -v "${PWD}:/repo" aquasec/trivy:latest fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed /repo` |
| **dependency review** | Yes at HIGH, and denied licences | Newly *introduced* vulnerable or copyleft deps | PR-only; no local equivalent |
| **npm audit** | Yes at HIGH (prod deps only) | Advisories against the lockfile | `npm audit --audit-level=high --omit=dev` |
| **codeql (javascript-typescript)** | No — reports | Injection, taint flows in our code | Impractical locally |
| **codeql (actions)** | No — reports | **Workflow injection, over-broad permissions.** Works today. | Impractical locally |
| **playwright (chromium)** | Yes | Critical-path E2E | `npm run test:e2e` |
| **schema drift** | Yes | Four gates — see below | `supabase db reset && supabase db diff && supabase test db` |
| **markdown lint + links** | Yes | markdownlint + relative-link check | `npx markdownlint-cli2 "**/*.md"` and `npx lychee --offline --no-progress .` |
| **docs structure checks** | Yes | ADR index complete · backlog files indexed · task IDs unique · `docs/README.md` links resolve | See the job's shell steps |

### The schema gate's four checks

One `supabase start`, four assertions
([database-migrations.md](../docs/ops/database-migrations.md#what-ci-verifies)):

1. **Replay** — `supabase db reset` applies every migration to an empty database.
2. **Drift** — `supabase db diff --schema public` is empty.
3. **Types** — the committed `types/database.types.ts` matches the live schema.
4. **RLS** — every public table has RLS enabled, every RLS table has a policy,
   and the pgTAP isolation tests pass.

**Check 4 is the most valuable gate in the repository.** The Supabase anon key
is public by design, so RLS is the only thing between a table and anyone who
reads the JavaScript bundle. A table shipped without it is world-readable —
silently. CI fails the build rather than warning.

The gate needs **no secrets**: it runs a throwaway local Postgres, so it works
on fork PRs.

## Why CI is green on an empty repo

This repository currently has no `package.json`, no tests, no migrations — and
all six workflows pass. That is deliberate, not accidental.

### 1. Preflight detects what exists

A `preflight` job probes the repository and publishes boolean outputs
(`has_app`, `has_lockfile`, `has_tests`, `has_supabase_config`, …). It always
succeeds.

### 2. Code jobs gate on those outputs

```yaml
lint:
  needs: preflight
  if: needs.preflight.outputs.has_app == 'true'
```

With no `package.json`, `lint` is **skipped** — not failed. Standalone
workflows use `if: hashFiles('package.json') != ''` for the same effect.

### 3. The aggregate gate is the required check

```yaml
ci:
  needs: [preflight, lint, typecheck, unit, integration, build]
  if: always()          # runs even when dependencies were skipped
  # fails ONLY if some dependency actually failed or was cancelled
```

**This is the trick that makes the whole thing work.**

Without it, you would have to list `lint`, `typecheck`, and the rest as required
checks. GitHub treats a *skipped* required check as never-reported, so every PR
would sit at "Expected — waiting for status" forever. The usual workaround is
editing branch protection every time a job comes online — tedious and
error-prone.

The aggregate gate always runs, and:

| Situation | `ci` |
|---|---|
| All jobs passed | ✅ green |
| Some jobs skipped, none failed | ✅ green |
| Any job failed | ❌ red |
| Any job cancelled | ❌ red |

So branch protection is configured once and never touched again.

### 4. Some gates do real work today

Not everything skips. Running now, and meaningful:

| Gate | Value today |
|---|---|
| **gitleaks** | Scans full history. Meaningful from commit one. |
| **trivy** (misconfig) | Analyses these workflow files for misconfiguration. |
| **codeql (actions)** | Lints the workflows for injection and over-broad permissions. |
| **docs** | Markdown lint, relative links, ADR index, task-ID uniqueness. |

The docs gate is why CI here is green *and* meaningful rather than vacuously
green.

[`M0-B08`](../tasks/backlog/m0-foundation.md) activates the rest once
`package.json` lands. No workflow edits required — preflight simply starts
reporting `true`.

## Reading a skipped job

A grey "Skipped" in the checks list is **expected** while the relevant code does
not exist. Preflight's step summary prints exactly what was detected and why:

```text
### Preflight
| Signal              | Value   |
|---------------------|---------|
| App (package.json)  | `false` |
| Migrations          | `false` |

> No application code yet — code jobs are skipped by design.
```

A skipped job that *should* have run means preflight's detection is wrong —
that is a bug in `ci.yml`, not in your branch.

## When a gate is red

1. **Read the failing step**, not just the job name.
2. **Reproduce locally** with the command from the table above.
3. **Fix it.** Do not disable the gate, and do not merge red.
4. **If it is unrelated to your change** — a runner outage, a CVE disclosed
   overnight in a dependency you did not touch — file a `type:chore` issue and
   say so in the PR. Still do not bypass.

Security-specific triage, and the suppression rules (a reason, an owner, an
expiry date, and review):
[ci-security-gates.md](../docs/security/ci-security-gates.md).

## Conventions across all workflows

| Convention | Why |
|---|---|
| **Actions SHA-pinned** with a version comment | A tag is mutable; CI has repository write potential. Dependabot bumps them weekly. |
| `permissions: contents: read` at top level | Least privilege; jobs escalate individually. |
| `cancel-in-progress` **on PRs only** | Never cancel a `main` run — those gate deploys and feed the Security tab. |
| `timeout-minutes` on every job | A hung job cannot burn the budget. |
| **No `pull_request_target`** | It runs with secrets against untrusted code. |
| No `paths-ignore` on `ci.yml` / `security.yml` | A path-filtered *required* check never runs on unrelated PRs and blocks the merge button. |
| `paths-ignore` **is** on `e2e.yml` | Docs PRs — which is all of them right now — should not queue a 20-minute browser job. Safe because `e2e` is not required while the suite is thin. |

## Next

- [`../docs/security/ci-security-gates.md`](../docs/security/ci-security-gates.md) — scanner thresholds, triage, suppressions.
- [09-database-changes.md](09-database-changes.md) — satisfying the schema gate.
- [02-branching.md](02-branching.md) — the branch-protection checklist.
