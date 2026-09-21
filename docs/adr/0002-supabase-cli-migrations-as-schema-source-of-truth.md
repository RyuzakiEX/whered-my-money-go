# 0002 — Supabase CLI migrations are the schema source of truth

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-09 |
| **Deciders** | @jorge |
| **Affects** | [data-model.md](../architecture/data-model.md), [database-migrations.md](../ops/database-migrations.md), `schema-drift.yml`, all backend milestones |

## Context

Spec §23 names Supabase and PostgreSQL; spec §24 requires Row Level Security,
database constraints, and user-scoped queries. Something has to be authoritative
about the schema's shape.

The forces:

- **RLS is the primary isolation mechanism.** Policies are SQL, they are
  security-critical, and they must be reviewable as SQL — not generated from an
  abstraction that hides them.
- **The schema uses Postgres features an ORM abstracts poorly.** Enums, partial
  and expression indexes, `EXISTS` subqueries inside policies, views, triggers,
  check constraints.
- **Types must be trustworthy.** TypeScript should know the schema, and be
  *right* about it.
- **Schema drift is the failure to prevent.** A change made in the dashboard, or
  a stale types file, produces confident code validated against a schema that no
  longer exists.

## Decision

**`supabase/migrations/*.sql` is the single source of truth for the database
schema.** Hand-written SQL, committed to git, applied by the Supabase CLI.

Consequences of that, made concrete:

- **No ORM.** Data access is `supabase-js` plus generated types.
- **`types/database.types.ts` is generated** by `supabase gen types typescript`,
  committed, and never hand-edited.
- **Schema changes never happen through the Studio UI.**
- **Migrations are forward-only** — see
  [database-migrations.md](../ops/database-migrations.md#forward-only).
- **CI proves all of this** on every change (`schema-drift.yml`): migrations
  replay from empty, no drift, types current, RLS enabled everywhere, pgTAP
  isolation tests pass.

## Consequences

### What this makes easier

- **RLS policies are reviewable as SQL** — exactly the artefact that gets
  audited, in the language it is enforced in.
- **Full access to Postgres.** Expression indexes, generated columns, views,
  triggers, `EXISTS` in policies — no abstraction to fight.
- **The drift gate is possible at all.** `supabase db diff` against a
  freshly-replayed database is only meaningful because migrations are the truth.
- **No connection-pooling complexity from an ORM** in a serverless runtime.
- **Types cannot silently lie** — CI fails when the committed file is stale.

### What this makes harder

- **Migrations are hand-written SQL.** No `prisma migrate dev` generating them
  from a model diff. More typing, and SQL fluency required.
- **No compile-time query validation.** `supabase-js` is typed from the
  generated types, but a query builder cannot check a complex join the way an
  ORM's DSL can.
- **Query composition is manual.** Filters and pagination are built by hand
  (`M3-B06`) rather than composed from a fluent API.
- **Two representations to keep in step** — migrations and generated types —
  though CI enforces that rather than trusting it.

### What this forecloses

- **Database portability.** This is Postgres-and-Supabase specific, deliberately.
  RLS with `auth.uid()` is not portable, and it is the security model.

## Alternatives considered

### Drizzle ORM + drizzle-kit

**What it was.** Schema declared in TypeScript, SQL migrations generated,
`drizzle-kit check` for drift, and genuinely good typed queries.

**Why rejected.** It introduces a **second schema authority**. The TypeScript
schema and `supabase/migrations` would both claim to describe the database, and
reconciling them is a permanent tax. Worse for this project specifically: RLS
policies would still be hand-written SQL living *outside* the declared schema, so
the security-critical part gets none of the benefit while the drift surface
doubles. Drizzle is a strong choice for an app where the ORM owns the schema
outright; here Supabase already does.

### Prisma

**What it was.** The best-known TypeScript ORM: excellent DX, mature migrations,
`prisma migrate diff --exit-code` for drift.

**Why rejected.** Three concrete problems. **RLS** — Prisma connects as a single
database user, so `auth.uid()` does not resolve and per-request RLS does not
apply; working around it means threading the user's JWT manually and abandoning
much of Prisma's value. **Pooling** — Prisma in serverless needs careful
connection management or a data proxy. **Feature coverage** — enums, views, and
policy subqueries need `Unsupported` escape hatches and raw SQL, which means
hand-written SQL anyway, just less visibly.

### Supabase Studio as the source of truth

**What it was.** Edit the schema in the dashboard; export migrations after.

**Why rejected.** The schema would live in one project's database and nowhere
else — absent from git, absent from other environments, invisible in review,
and overwritten on the next replay. Every property this decision is trying to
guarantee would be lost.

## Revisit when

- Query complexity grows past what hand-built `supabase-js` filters handle
  comfortably — though the first response should be a SQL view, not an ORM.
- Supabase ships first-class typed query composition that keeps SQL migrations
  authoritative.
- A second, non-Supabase database enters the picture.

## References

- Spec §23 (tech stack), §24 (security requirements)
- [database-migrations.md](../ops/database-migrations.md) — the workflow this implies
- [rls-policies.md](../architecture/rls-policies.md) — the SQL this keeps reviewable
- `.github/workflows/schema-drift.yml` — the gate that enforces it
