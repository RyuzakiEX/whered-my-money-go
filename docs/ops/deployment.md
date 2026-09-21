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
2. Apply migrations.           supabase db push
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

| Setting | Value |
|---|---|
| Framework | Next.js (auto-detected) |
| Build command | `npm run build` |
| Install command | `npm ci` |
| Node version | Pinned via `.nvmrc` |
| Production branch | `main` |
| Preview branches | All |
| Region | Nearest the Supabase project — cross-region round trips dominate latency |

Environment variables per environment, scoped so preview never holds production
credentials: [environments.md](environments.md#environment-variable-matrix).

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
3.  supabase db push                     — all migrations
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
