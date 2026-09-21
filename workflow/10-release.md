# Release

**`main` deploys itself. Migrations do not.** The app rolls back in seconds; the
schema only moves forward.

Reference: [deployment.md](../docs/ops/deployment.md),
[environments.md](../docs/ops/environments.md).

## The pipeline

```text
PR opened
   ├── gates: ci · security · docs · schema · e2e
   └── Vercel builds a PREVIEW (isolated Supabase preview project)
              └── milestone demos happen here

Merge to main
   ├── Vercel deploys PRODUCTION automatically
   └── Migrations do NOT apply automatically   ← deliberate
```

Two independently deploying systems: Vercel holds the app, Supabase holds the
schema. Nothing coordinates them, and every rule below exists because of that.

## Why migrations are not automatic

Automatic migration-on-merge is tempting and wrong here.

A migration against real financial data is irreversible
([09-database-changes.md](09-database-changes.md#forward-only)). Coupling it to a
merge means an irreversible change to production data happens as a side effect
of clicking a button, whenever CI happens to finish, with nobody watching.

The app deploying automatically is fine — a bad app deploy rolls back in
seconds. The asymmetry in reversibility is the reason for the asymmetry in
automation.

## Order of operations

```text
1. Merge.                    All gates green.
2. supabase db push          Migrations FIRST.
3. Verify the schema.        RLS on; a smoke query works.
4. Vercel deploys.           Automatic.
5. Smoke test production.
```

**Migrations always precede the app.** New code may require the new schema; old
code tolerates it because every migration is backward-compatible by the
expand/contract rule. Reversing the order guarantees a window where new code
meets an old schema and fails outright.

## Smoke test

The shortest path that touches auth, writes, reads, and the money math:

```text
1. GET /api/health                  → 200, database ok
2. Marketing page loads
3. Sign in                          → reaches /dashboard
4. Dashboard renders                → tiles show numbers, no error boundary
5. Add a transaction                → persists, list updates
6. Safe to Spend recomputes         → the number moves
7. Error tracking                   → no new spike
```

**Step 6 is the real check.** Safe to Spend depends on accounts, transactions,
goals, the cache tags, and `lib/core`. If it recomputes correctly, most of the
stack is working.

## Rollback

| What | How | Speed |
|---|---|---|
| **App** | Vercel → promote the previous deployment | Seconds |
| **Schema** | **Fix forward with a new migration** | A deploy cycle |

**The app rolls back freely** — Vercel deployments are immutable and previous
builds stay available.

**The schema never rolls back.** A down-migration on financial data deletes
records, and it would be run mid-incident under pressure. Because every
migration is backward-compatible with the previous app version, rolling the
*app* back is almost always sufficient: the old code simply ignores the new
column.

If a migration is genuinely wrong, write a corrective migration.

## Versioning

`v0.<milestone>.0` per milestone; `v1.0.0` at M9.

```bash
git tag -a v0.7.0 -m "M7 — Safe to Spend"
git push origin v0.7.0
```

| Tag | Milestone |
|---|---|
| `v0.1.0` | M1 — Auth & Profile |
| `v0.2.0` | M2 — Accounts |
| … | … |
| `v0.8.0` | M8 — Money Timeline |
| **`v1.0.0`** | **M9 — MVP complete** |

Tag after the milestone's [Definition of Done](07-definition-of-ready-and-done.md#definition-of-done--milestone)
is met — including the demo passing on a preview deployment.

## Changelog

Generated from [conventional commits](03-commits.md), which is the practical
payoff of the commit convention: `feat` and `fix` entries with scopes produce a
changelog with no additional bookkeeping. Wired up in `M9-B06`.

```bash
npx conventional-changelog -p conventionalcommits -i CHANGELOG.md -s
```

## Release checklist

```text
□ All milestone tasks closed
□ All gates green on main
□ Demo script passes on a preview deployment
□ Migrations reviewed for backward compatibility
□ supabase db push against production
□ Schema verified: RLS on every table
□ Vercel production deploy succeeded
□ Smoke test passed (all 7 steps)
□ Error tracking shows no new spike
□ Tag pushed
□ CHANGELOG updated
□ Docs reflect shipped behaviour
```

## First production release

`M9-B06`, in order:

```text
1.  Provision the production Supabase project (region near users).
2.  supabase link --project-ref <production-ref>
3.  supabase db push
4.  VERIFY RLS on every table. Manual. Non-negotiable.
5.  Seed reference data only. NO demo data.
6.  Configure Auth: site URL, redirect allowlist, email templates.
7.  Set Vercel production env vars.
8.  Custom domain; confirm HTTPS.
9.  Deploy.
10. Full smoke test.
11. Confirm error tracking and alerts are live.
12. Tag v1.0.0 with a changelog.
13. Update deployment.md and environments.md with actual values.
```

Two steps deserve emphasis:

- **Step 4 is manual** even though CI checks it on every change. A
  freshly-provisioned project has never been through that gate, and a missing
  policy here means every user's financial data is readable by anyone who reads
  the client bundle.
- **Step 5** — seeding demo transactions into production would put fabricated
  financial records in real users' accounts.

## Hotfixes

A `priority:p0` bug in production — wrong money, data loss, cross-user
exposure — follows the normal flow, faster:

```bash
git switch -c fix/123-wrong-safe-to-spend-total
# fix, with a regression test that fails before and passes after
gh pr create --fill
```

**Gates still apply.** A p0 on money math is exactly when you least want to skip
the test that proves the fix works. The process is not the delay; investigation
is.

If the fix is not immediate, **roll the app back** while you work on it. That is
what instant rollback is for.

## Next

- [`../docs/ops/deployment.md`](../docs/ops/deployment.md) — pipeline detail and performance budgets.
- [09-database-changes.md](09-database-changes.md) — expand/contract in full.
- [`../docs/ops/environments.md`](../docs/ops/environments.md) — env vars and secret placement.
