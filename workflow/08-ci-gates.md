# CI Gates

**Six workflows, five required status checks.** Every job runs on every pull
request and does real work. **No gate passes by not running**: a skipped job
fails its aggregate unless it is one of the two listed exceptions
([below](#no-gate-passes-by-not-running)).

## Required status checks

Configure branch protection to require exactly these five. They are **aggregate
gates**, not individual jobs:

```text
ci · security · docs · e2e · schema
```

They never need changing as the project grows: a new job joins its workflow's
aggregate, and the aggregate is what branch protection requires.

## The workflows

| Workflow | Required check | Jobs |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | **`ci`** | lint · commit messages · typecheck · unit tests · integration tests · build |
| [`security.yml`](../.github/workflows/security.yml) | **`security`** | gitleaks · trivy · dependency review · npm audit · actionlint (workflows) |
| [`docs.yml`](../.github/workflows/docs.yml) | **`docs`** | markdown lint + links · docs structure checks |
| [`e2e.yml`](../.github/workflows/e2e.yml) | **`e2e`** | playwright (chromium) |
| [`schema-drift.yml`](../.github/workflows/schema-drift.yml) | **`schema`** | schema drift (4 gates in one job) |
| [`codeql.yml`](../.github/workflows/codeql.yml) | — (reports only) | codeql (javascript-typescript) · codeql (actions) |

## Every job

| Job | Blocks? | Checks | Reproduce locally |
|---|---|---|---|
| **lint** | Yes | ESLint, the [import-boundary assertion](../docs/architecture/source-structure.md#import-rules), and Prettier | `npm run lint && npm run lint:boundaries && npm run format:check` |
| **commit messages** | Yes (PRs only) | commitlint on every commit in the PR, and on the PR title **with the `(#N)` squash suffix** — the header that lands on `main`. Dependabot's commits and titles are skipped | `npx commitlint --from origin/main --to HEAD` |
| **typecheck** | Yes | `tsc --noEmit`, strict | `npm run typecheck` |
| **unit tests** | Yes | Vitest + coverage thresholds | `npm run test -- --coverage` |
| **integration tests** | Yes | Vitest against a local Supabase | `supabase start && npm run test:integration` |
| **build** | Yes | `next build` with placeholder public env | `npm run build` |
| **gitleaks (secret scan)** | **Yes — any finding** | Secrets in **full git history** | `docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest detect --source=/repo --config=/repo/.gitleaks.toml --verbose` |
| **trivy** | Yes at HIGH/CRITICAL on PRs | Dependency CVEs, misconfigured YAML, secrets in the tree | `docker run --rm -v "${PWD}:/repo" aquasec/trivy:latest fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed /repo` |
| **dependency review** | Yes at HIGH, and denied licences | Newly *introduced* vulnerable or copyleft deps | PR-only; no local equivalent |
| **npm audit** | Yes at HIGH (prod deps only) | Advisories against the lockfile | `npm audit --audit-level=high --omit=dev` |
| **codeql (javascript-typescript)** | No — reports | Injection, taint flows in our code | Impractical locally |
| **codeql (actions)** | No — reports | **Workflow injection, over-broad permissions.** | Impractical locally |
| **actionlint (workflows)** | Yes | Every workflow parses and is valid: expression contexts, job references, and shellcheck on every `run:` block. In `security.yml`, so a `ci.yml` that fails to load cannot take this check down with it | `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7` |
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

## No gate passes by not running

Until [`M0-B08`](../tasks/backlog/m0-foundation.md) the workflows detected what
the repository contained and **skipped** the jobs whose code did not exist yet,
and the aggregates counted a skip as a pass. That kept a docs-only repository
green. Once the code existed, the same mechanism became a way for a gate to go
green without running — so it is gone:

- **No detection steps.** Every job runs unconditionally. There is no
  `preflight` job and no `steps.detect` condition left in any workflow.
- **Jobs run in parallel.** `build` no longer waits for `lint` and
  `typecheck`; the aggregate fails if any of them fails either way.
- **Aggregates are strict.** All five use
  [`require-results`](../.github/actions/require-results/action.yml): every
  needed job must **succeed**. A skip fails the gate unless the job is named in
  `allow-skipped` for that run.

The exceptions, all explicit:

| Job | Skips when | Why |
|---|---|---|
| **commit messages** | Push to `main` | A push has no PR commit range or title to check. |
| **dependency review** | Push to `main` | It compares a PR's dependencies against its base. |
| **pgTAP RLS isolation tests** (step, inside `schema drift`) | `supabase/tests` has no `.sql` files | The harness lands in [`M1-B03`](../tasks/backlog/m1-auth-and-profile.md), which must delete this skip. |

### A workflow that fails to load is silence, not red

If a workflow file is invalid, GitHub runs **zero** jobs and the aggregate
posts **no status at all**. In M0-B11, `hashFiles()` in a job-level `if`
did exactly that: the PR showed 16 green checks and nothing red. Two defences:

1. **Branch protection requires the aggregates**
   ([02-branching.md](02-branching.md)), so a missing `ci` status blocks the
   merge instead of going unnoticed.
2. **actionlint runs in `security.yml`**, a different workflow from the ones it
   most needs to check.

Check the **number** of checks on a PR, not only their colour. Today a PR
shows 24 (as of M0-B08).

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
| Aggregates use `require-results` | One strict implementation of "every job succeeded", instead of five copies of a lenient one. |
| No `paths-ignore` on **any** workflow | Every aggregate is a required check. `e2e.yml` lost its filter in M0-B08; with the browser cache the job takes about three minutes. |
| `SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr.io` at workflow level in `ci.yml`, `e2e.yml`, `schema-drift.yml` | The CLI pulls the local stack from `public.ecr.aws` by default, and anonymous ECR pulls are quota-limited per source IP. On #43, `supabase start` failed every pull with `Data limit exceeded` while sibling jobs on other runners passed. GitHub's own registry avoids that quota. Local development keeps the default. |

**`supabase start` failing with `Data limit exceeded` or `toomanyrequests`** is
a registry quota, not your change. Check which registry the failing pull names
before re-running: if it is not `ghcr.io`, a workflow has lost the variable
above.

## Next

- [`../docs/security/ci-security-gates.md`](../docs/security/ci-security-gates.md) — scanner thresholds, triage, suppressions.
- [09-database-changes.md](09-database-changes.md) — satisfying the schema gate.
- [02-branching.md](02-branching.md) — the branch-protection checklist.
