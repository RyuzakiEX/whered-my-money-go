# Local Setup

**Install Node LTS, npm, Docker Desktop, and the GitHub CLI; then clone,
install, start local Supabase, configure `.env.local`, and run.**

> [!IMPORTANT]
> Some steps below are still tagged **[available after M0]** —
> [M0](../tasks/backlog/m0-foundation.md) is still landing pieces such as
> `.nvmrc` and the app shell. The steps are
> documented now because M0's own acceptance criteria are "this document runs
> top to bottom on a clean machine". Skip to
> [What you can do today](#what-you-can-do-today) for the currently-runnable
> subset.

## Prerequisites

| Tool | Version | Why this one |
|---|---|---|
| Node.js | Active LTS — pinned in `.nvmrc` **[added in M0]** | CI reads `.nvmrc` via `node-version-file`, so the pin is the single source of truth for local and CI alike. Until it exists, [the composite action](../.github/actions/setup-node-project/action.yml) falls back to Node 22. |
| npm | Ships with Node | See [Why npm](#why-npm-and-not-pnpm) below. |
| Docker Desktop | Current stable | Local Supabase is a set of containers — Postgres, Auth (GoTrue), Storage, Realtime, Kong, Studio. No Docker, no local database. |
| Supabase CLI | **Pinned in `package.json`** — installed by `npm ci`, run as `npx supabase` | Owns migrations, type generation, and the local stack. It is the schema source of truth ([ADR-0002](../docs/adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md)). Do not install it globally: CI reads the same pin, and config, diffs, and generated types differ between CLI versions. |
| GitHub CLI (`gh`) | Current stable | Issues, PRs, and re-running CI jobs from the terminal. Optional but the task lifecycle assumes it. |

Install the CLIs however your platform prefers. On Windows:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Docker.DockerDesktop
winget install GitHub.cli
```

Verify:

```bash
node --version        # should match .nvmrc once M0 lands
npm --version
docker info           # must succeed, not just `docker --version`
gh auth status
npx supabase --version   # after step 2 — the pinned CLI from package.json
```

`docker info` rather than `docker --version` is deliberate: the version string
prints happily while the Docker engine is stopped, and `supabase start` needs
the engine, not the binary.

### Why npm, and not pnpm

pnpm is faster and its strict `node_modules` layout would catch a phantom
dependency or two. It is still not worth it here, for three reasons:

- **One app, not a monorepo** ([ADR-0001](../docs/adr/0001-single-nextjs-app-not-monorepo.md)).
  pnpm's headline advantages — workspace linking, content-addressed store across
  packages — mostly apply to the case this repo deliberately isn't.
- **Vercel and GitHub Actions both treat npm as the default path.** Every extra
  package manager is one more thing that can be misconfigured in two places at
  once, for a build that takes seconds either way at this size.
- **`npm ci` already gives the property that matters** — it fails when
  `package.json` and `package-lock.json` disagree, rather than silently
  resolving something new. That is the reproducibility guarantee CI depends on.

The CI composite action does detect `pnpm-lock.yaml` and handle it, so switching
later is a lockfile change and not a CI rewrite. Do it by ADR if the tradeoff
changes, not by accident.

## Setup steps

### 1. Clone

```bash
gh repo clone jorge/whered-my-money-go
cd whered-my-money-go
```

### 2. Install dependencies

```bash
npm ci
```

`npm ci`, not `npm install`. `ci` installs exactly the lockfile and errors if
`package.json` disagrees with it; `install` would quietly resolve a new tree and
your local environment would stop matching CI's. This also installs the pinned
Supabase CLI, which the next step needs.

### 3. Start local Supabase

```bash
npx supabase start
```

First run pulls several container images and takes a few minutes. Later starts
take seconds. No edits to `supabase/config.toml` are needed — if you find
yourself changing it to get the stack up, see
[Troubleshooting](#troubleshooting) first; it is committed, so a local edit
changes every machine.

### 4. Create your environment file

```bash
cp .env.example .env.local
npx supabase status -o env      # prints the local URLs and keys
```

`.env.example` is the environment contract — read the comments in it, they
mark which values are `[browser-safe]` and which are `[server-only]` and must
never carry a `NEXT_PUBLIC_` prefix. The URLs are already filled in with the
local defaults; copy the two keys from the `status` output:

| `status -o env` prints | Goes into `.env.local` as |
|---|---|
| `ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |

The keys are the CLI's fixed local demo keys — identical on every machine for a
given CLI version, and valid only against your local stack. Run
`npx supabase status` (without `-o env`) any time for a readable summary.

`.env.local` is gitignored, along with every `.env*.local`. If you ever find
one in a diff, stop and read [../SECURITY.md](../SECURITY.md) — the `gitleaks`
gate should have caught it, and if it didn't, that's a gate bug worth an issue.

### 5. Apply migrations and seed

```bash
npm run db:reset
```

This drops the local database, replays every migration in
`supabase/migrations/` from empty, then runs `supabase/seed.sql`. It is safe to
run repeatedly — use it liberally. It is the only way to know your migrations
still replay cleanly, and it is exactly what the schema-drift gate does in CI.
See [09-database-changes.md](09-database-changes.md).

Then confirm the stack answers:

```bash
npm run test:integration    # includes a real round trip to the local REST API
```

### 6. Run the app — **[available after M0]**

```bash
npm run dev
```

Then open <http://localhost:3000>.

### 7. Verify before you push — **[available after M0]**

```bash
npm run verify        # lint + typecheck + unit tests
```

Every CI gate has a local equivalent; [08-ci-gates.md](08-ci-gates.md) maps them
one to one.

## What you can do today

No application code exists yet, but the quality gates are real and they run on
this repository right now. All of these work on a fresh clone:

```bash
# Markdown lint — same config the docs gate uses
npx markdownlint-cli2 "**/*.md"

# Link check across all docs
docker run --rm -v "${PWD}:/input" lycheeverse/lychee --no-progress --offline /input

# Secret scan
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest detect \
  --source=/repo --config=/repo/.gitleaks.toml --redact --verbose

# Filesystem/config vulnerability + misconfiguration scan
docker run --rm -v "${PWD}:/repo" aquasec/trivy:latest fs /repo \
  --scanners vuln,secret,misconfig --exit-code 1 --severity HIGH,CRITICAL
```

You can also read the [docs set](../docs/), work the
[M0 backlog](../tasks/backlog/m0-foundation.md), and open documentation PRs —
the `docs` gate is fully operational, which is the point of having built it
first.

## Script reference

Every CI gate maps to exactly one script, so a red job reproduces with one
command. See [08-ci-gates.md](08-ci-gates.md) for the job-to-script mapping.

| Script | Purpose |
|---|---|
| `npm run dev` | Next dev server on :3000 |
| `npm run build` | Production build |
| `npm run start` | Serve a production build |
| `npm run lint` | ESLint across the repo |
| `npm run lint:fix` | ESLint with autofix |
| `npm run lint:boundaries` | Assert the import matrix still bites — see [source-structure.md](../docs/architecture/source-structure.md#import-rules) |
| `npm run lint:md` | markdownlint, pinned to CI's version |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Unit suite (Vitest, `tests/unit/**`) |
| `npm run test:watch` | Unit suite in watch mode |
| `npm run test:coverage` | Unit suite with coverage thresholds enforced |
| `npm run test:integration` | Integration suite — **needs `npx supabase start`** and the anon key in `.env.local` |
| `npm run test:e2e` | Playwright E2E *[after M0-B09]* |
| `npm run db:types` | Regenerate `types/database.types.ts` *[after M0-B07]* |
| `npm run db:reset` | Replay every migration from empty, then `supabase/seed.sql` |
| `npm run verify` | Everything above except integration and E2E. **Run before pushing.** |

`verify` deliberately omits `test:integration` and `test:e2e`: both need
services running, and a pre-push check that fails because Docker is stopped is
a check people route around. CI runs them as their own jobs.

Scripts that depend on a tool you may not have fail with an actionable message
naming the missing command, not a stack trace:

```text
$ npm run db:reset
  The pinned Supabase CLI is not installed (node_modules/.bin/supabase).

      npm ci
```

## Local Supabase ports

`npx supabase start` binds these on `127.0.0.1`, as set in the committed
[`supabase/config.toml`](../supabase/config.toml). Worth memorising, because a
port conflict is the most common first-run failure:

| Port | Service | Notes |
|---|---|---|
| 54321 | API gateway (Kong) | This is your `NEXT_PUBLIC_SUPABASE_URL` — `http://127.0.0.1:54321` |
| 54322 | Postgres | `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| 54323 | Studio | Browser UI at <http://127.0.0.1:54323> — table editor, SQL editor, auth users |
| 54324 | Mailpit (mail catcher) | Where local signup-confirmation and password-reset emails land. Older CLIs called this Inbucket; `config.toml` now names the section `[local_smtp]` |

The local keys are not ports, but you will want them alongside:

```bash
npx supabase status -o env   # API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY, …
```

Use `127.0.0.1`, not `localhost`. On Windows and on some Node versions
`localhost` resolves to `::1` first, and the containers bind IPv4 only — which
surfaces as an `ECONNREFUSED` that looks like the database is down when it
isn't.

## Troubleshooting

### `supabase start` fails: Docker unreachable

The wording varies by CLI version and platform — older CLIs say "Cannot
connect to the Docker daemon"; CLI 2.120 reports a `DockerLifecycleInspectError`
ending in "error during connect … connection refused". Either way, Docker
Desktop isn't running, or is still starting. Launch it, wait until
`docker info` returns without error, then retry. On Windows also confirm the WSL2
backend is healthy — Docker Desktop reports this in Settings → Resources.
Restarting Docker Desktop after a Windows update is a routine step, not a sign of
a broken setup.

### Port already in use — or `HealthCheckTimeoutError`

On Windows a port conflict often does **not** say "port in use". Docker can
bind alongside another process listening on the same port, and the stack then
fails its own health checks: `supabase start` exits 1 with a
`HealthCheckTimeoutError` naming `127.0.0.1:54321`. Treat that as a port
conflict first:

```powershell
Get-NetTCPConnection -LocalPort 54321,54322,54323,54324 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Any owner that is not Docker is the culprit. Otherwise:

```bash
npx supabase stop            # in the other project's directory
npx supabase stop --all      # or, from anywhere: stop every local Supabase stack
```

Two Supabase projects cannot run at once with default ports — they claim the same
54321–54324. On Windows, a stubborn 5432x binding is usually an orphaned
container:

```powershell
docker ps -a --filter "name=supabase" --format "{{.Names}}\t{{.Ports}}"
```

If 54322 specifically is taken, check for a locally-installed Postgres service
listening on the wrong port, or a leftover container from a crashed `supabase
start`. Changing the port in `supabase/config.toml` is a last resort: it is a
committed file, so it changes the port for every machine and every doc that
quotes it.

### `npm run dev` says port 3000 is in use

Another dev server, or an orphaned Node process. Kill it rather than moving to
3001 — `NEXT_PUBLIC_SITE_URL` and the Supabase auth redirect allowlist both
name 3000, so a different port breaks the auth callback in a way that reads as
an auth bug.

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
```

### Windows: CRLF churn, or "the whole file changed" diffs

[`.gitattributes`](../.gitattributes) sets `* text=eol=lf` so everything is
normalised to LF in the repository regardless of your host. If you cloned before
that file existed, or your Git has `core.autocrlf=true` from an older setup,
renormalise once:

```bash
git config core.autocrlf false
git add --renormalize .
git status          # expect: nothing, or only genuinely-changed files
```

A PR whose diff is every line of a file it didn't mean to touch is a line-ending
problem, and it will get sent back — it makes review impossible, which is the
whole reason `.gitattributes` is there.

### Types out of sync with the database

Regenerate rather than hand-editing. `types/database.types.ts` is generated and
marked `linguist-generated` for exactly this reason:

```bash
npm run db:types      # [available after M0-B07]
```

If it still disagrees, your local database has drifted from the migrations — run
`npm run db:reset` first, which replays from empty. See
[09-database-changes.md](09-database-changes.md).

## Next

- [02-branching.md](02-branching.md) — branch naming and `main` protection.
- [06-task-lifecycle.md](06-task-lifecycle.md) — the full issue-to-merge walkthrough.
- [08-ci-gates.md](08-ci-gates.md) — every gate and its local reproduction.
