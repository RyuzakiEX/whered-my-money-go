# Deployment

**Shape in one sentence:** `main` deploys itself to Vercel, migrations are
applied to Supabase first and by hand, and the app rolls back instantly while
the schema only ever moves forward.

Related: [environments.md](environments.md),
[database-migrations.md](database-migrations.md),
[../../workflow/10-release.md](../../workflow/10-release.md),
[../architecture/observability.md](../architecture/observability.md).

## The pipeline

```text
PR opened
   ├── CI gates: ci · security · docs · schema · e2e
   └── Vercel builds a PREVIEW deployment (isolated Supabase preview project)
              │
              └── milestone demo happens here

Merge to main
   ├── Vercel builds and deploys PRODUCTION automatically
   └── Migrations do NOT apply automatically  ← deliberate
```

**Two independently deploying systems.** Vercel deploys the app; Supabase holds
the schema. Nothing coordinates them, which is the fact every rule below exists
to accommodate.

## Why migrations are not automatic

Automatic migration-on-merge is tempting and wrong here.

A migration against real financial data is irreversible
([database-migrations.md](database-migrations.md#forward-only)). Coupling it to
a merge means a schema change to production happens as a side effect of clicking
a button, at whatever moment CI happens to finish, with no one watching.

So `supabase db push` is run deliberately, by a person, before the app deploy —
and verified. The app deploy being automatic is fine: a bad app deploy rolls
back in seconds.

## Order of operations

```text
1. Merge.                      All gates green.
2. Apply migrations.           supabase db push --linked
3. Verify the schema.          RLS on; a smoke query works.
4. Let Vercel deploy.          Automatic on merge.
5. Smoke test production.      The affected flow, end to end.
```

**Migrations always precede the app.** New code may need the new schema; old
code tolerates it because every migration is backward-compatible by the
expand/contract rule. Reversing this order creates a window where new code meets
an old schema and fails outright.

## Smoke test

After every production deploy, in order — this is the shortest path that touches
auth, writes, reads, and the money math:

```text
1. GET /api/health                      → 200, database ok
2. Load the marketing page              → renders
3. Sign in                              → reaches /dashboard
4. Dashboard loads                      → tiles show numbers, no error boundary
5. Add a transaction                    → persists, list updates
6. Safe to Spend recomputes             → the number moves
7. Check error tracking                 → no new spike
```

Step 6 is the real check. Safe to Spend depends on accounts, transactions,
goals, the cache tags, and `lib/core` — if it recomputes correctly, most of the
stack is working.

## Rollback

Asymmetric, on purpose:

| What | How | Speed |
|---|---|---|
| **App** | Vercel → promote the previous deployment | Seconds |
| **Schema** | **Fix forward with a new migration** | A deploy cycle |

**The app rolls back freely** because a Vercel deployment is immutable and
previous builds stay available. This is why the app deploying automatically is
safe.

**The schema never rolls back.** A down-migration on financial data deletes
records — and it would be run mid-incident, under pressure, when mistakes are
likeliest. Because every migration is backward-compatible with the previous app
version, rolling the *app* back is almost always sufficient: the old code
ignores the new column.

If a migration is genuinely broken, write a corrective migration. The history
stays append-only and auditable.

## Vercel configuration

Live values, recorded in M0-B10. Re-check with the API, not from memory — the
dashboard and this table drift the moment someone clicks a setting.

| Setting | Value |
|---|---|
| Project | `whered-my-money-go` (team `jorges-projects-bfadb832`), Git-linked to `RyuzakiEX/whered-my-money-go` |
| Framework | Next.js (auto-detected) |
| Build command | `npm run build` — the repository script, so Vercel and CI build identically |
| Install command | `npm ci` |
| Node version | `22.x`, from `package.json` `engines` |
| Production branch | `main` |
| Preview branches | All — every push to a PR branch builds a preview |
| PR comments | On: the Vercel bot comments the preview URL on each PR |
| Git fork protection | On: a deployment from a fork's PR waits for a team member to authorize it, so outside code does not build with this project's environment variables unreviewed |
| Function region | `sin1` (Singapore), the same region as the Supabase preview project — cross-region round trips dominate latency |

**Node comes from `engines`, not `.nvmrc`.** Vercel ignores `.nvmrc` and picks
the Node major from `package.json` `engines.node`. An open range such as
`>=22.13.0` would let it build on a newer major than CI tests on, so `engines`
pins the major (`22.x`) and `.nvmrc` pins the exact version for local and CI.
Change both together.

Environment variables per environment, scoped so preview never holds production
credentials, and **no scope holds the `service_role` key**:
[environments.md](environments.md#environment-variable-matrix).

### URLs

| Environment | URL |
|---|---|
| Production | `https://whered-my-money-go.vercel.app` (no custom domain until M9-B06) |
| Preview, per branch | `https://whered-my-money-go-git-<branch>-jorges-projects-bfadb832.vercel.app` — a stable alias that follows the branch's latest push |
| Preview, per commit | A unique immutable URL per deployment, posted in the PR comment |

### Deployment protection

| Setting | Value | Effect |
|---|---|---|
| Vercel Authentication | `all_except_custom_domains` | Every deployment on a `*.vercel.app` URL — previews **and** the production `.vercel.app` alias — requires signing in to Vercel as a team member. |
| Password protection | Off | A paid add-on; the team is on the Hobby plan, and Vercel Authentication already covers it. |

While production has no custom domain, the production URL is also behind
Vercel Authentication — correct while there is no production backend. M9-B06
adds the custom domain, which is the publicly reachable entry point.

### Promotion path

```text
push to a PR branch ──► preview deployment (Preview env vars, preview Supabase)
                              │  CI gates green, PR merged (merge commit)
                              ▼
push to main ─────────► production deployment (Production env vars)
                              │  goes live on the production URL automatically
                              ▼
rollback ─────────────► Vercel → Deployments → previous production → "Promote"
```

A preview build is never promoted to production: it was built with the
**Preview** environment variables, which point at the preview database.
Production is always a fresh build of `main`.

> [!WARNING]
> **A new project's first deployment went to production, from a PR branch.**
> Observed in M0-B10: with the production branch already set to `main`, the
> very first Git deployment (`feat/m0-b10-vercel`, PR #42) was built with
> `target: production` and took the `whered-my-money-go.vercel.app` alias.
> Every later push to that branch built as a preview, as configured. It was
> harmless here — the Production scope was empty and every `.vercel.app` URL
> sits behind Vercel Authentication — and the next push to `main` replaced
> it. When provisioning a new Vercel project, make its first deployment from
> `main`, and confirm `target` on the first deployment rather than assuming.

**A failing build blocks its deployment.** Vercel runs `npm run build`; a
non-zero exit marks the deployment `ERROR` and nothing is aliased, so the
previous good deployment keeps serving. Demonstrated in M0-B10's PR.

## Performance budgets

Measured against `M4-B04`'s 5,000-transaction seed, enforced in `M9-B03`:

| Metric | Budget | Why this one |
|---|---|---|
| Dashboard TTFB | < 600 ms | The most-visited authenticated page |
| Dashboard LCP | < 2.5 s | The number the user came for |
| Transaction list TTFB | < 500 ms | Second-most-visited |
| Timeline TTFB | < 800 ms | Recurrence expansion is CPU-bound |
| Client JS (initial) | < 200 KB gzipped | Charts are the main pressure |

The first thing to break at scale is Postgres connection saturation from
serverless functions — use the Supabase pooler for the app, direct connections
only for migrations. See
[../architecture/system-architecture.md](../architecture/system-architecture.md#performance-and-scale).

## First production release

`M9-B06`. In order:

```text
1.  Provision the production Supabase project (region near users).
2.  supabase link --project-ref <production-ref>
3.  supabase db push --linked            — all migrations
4.  VERIFY RLS on every table.           Manual. Non-negotiable.
5.  Seed reference data only.            NO demo data in production.
6.  Configure Auth: site URL, redirect allowlist, email templates.
7.  Set Vercel production env vars.
8.  Point the custom domain; confirm HTTPS.
9.  Deploy.
10. Full smoke test above.
11. Confirm error tracking and alerts are live.
12. Tag v1.0.0 with a changelog.
13. Update this doc and environments.md with the actual values.
```

Step 4 is manual despite CI checking it on every change. A freshly provisioned
project has never been through that gate, and a missing policy here means every
user's financial data is readable by anyone who reads the client bundle.

Step 5 matters more than it looks: seeding demo transactions into production
would put fabricated financial records in real users' accounts.
