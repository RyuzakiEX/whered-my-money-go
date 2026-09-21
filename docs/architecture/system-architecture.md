# System Architecture

How the running system is put together, what talks to what, and where the trust
boundaries sit.

**Shape in one sentence:** a single Next.js App Router application on Vercel
talking directly to Supabase (Postgres + Auth), server-first, with Row Level
Security as the data isolation mechanism and no custom backend service in
between.

## Context

```text
┌──────────┐
│   User   │
└────┬─────┘
     │ HTTPS
     ▼
┌─────────────────────────────────────────────┐
│  Browser                                    │
│  • React Client Components (forms, charts)  │
│  • Supabase session cookie (httpOnly)       │
└────┬────────────────────────────────────────┘
     │ HTTPS · RSC payloads · Server Action calls
     ▼
┌─────────────────────────────────────────────┐
│  Vercel — Next.js App Router                │
│  • middleware.ts (session refresh, guards)  │
│  • Server Components (reads)                │
│  • Server Actions (writes)                  │
│  • lib/core (pure domain math)              │
└────┬────────────────────────────────────────┘
     │ postgres · PostgREST · GoTrue
     │ carries the USER's JWT, so RLS applies
     ▼
┌─────────────────────────────────────────────┐
│  Supabase                                   │
│  • Postgres + Row Level Security            │
│  • Auth (GoTrue)                            │
│  • Storage (only if needed later)           │
└─────────────────────────────────────────────┘
```

There is no separate API service. Next.js *is* the backend, and Postgres
enforces authorization. Spec §23 names this stack;
[ADR-0001](../adr/0001-single-nextjs-app-not-monorepo.md) records why it stays
one deployable unit.

## Containers

| Container | Owns | Must never |
|---|---|---|
| **Browser** | Rendering, interaction, optimistic UI, chart tooltips | Hold a secret; be trusted for identity, ownership, or money math |
| **middleware.ts** | Refreshing the Supabase session cookie; redirecting by auth state | Contain business logic or database queries |
| **Server Components** | Reading data via RLS-scoped queries; composing pages | Mutate data; call a Server Action |
| **Server Actions** | Validating input, re-checking ownership, writing, revalidating cache | Trust any client-supplied `user_id` |
| **`lib/core`** | All financial computation — Safe to Spend, timeline, forecasts | Do I/O, read the clock, read env vars |
| **`lib/server/queries`** | Typed reads, row→domain mapping | Contain domain math |
| **Postgres + RLS** | Being the final authority on who may read or write which row | Be the *only* authorization check |
| **Supabase Auth** | Identity, sessions, password reset | — |

## Rendering strategy

**Server-first.** The financially interesting pages — dashboard, timeline,
reports, budgets — are Server Components. They read through a request-scoped
Supabase client carrying the user's JWT, so RLS applies to every query, then
hand plain data to `lib/core` for computation.

Client Components exist only for genuine interactivity: forms, filter controls,
dialogs, chart tooltips, optimistic updates.

Three consequences worth stating:

- **No API layer to secure separately.** There is no public REST surface of our
  own to authorize, rate-limit, and document.
- **Money math never runs on the client.** A number the user sees was computed
  server-side from RLS-scoped data.
- **Bundle stays small** because Recharts and form libraries are the only
  substantial client-side dependencies.

## Request flows

### Read

```text
GET /dashboard
   │
   ├─▶ middleware.ts
   │     refresh Supabase session cookie
   │     no session? → redirect /login?next=/dashboard
   │
   ├─▶ Server Component  app/(app)/dashboard/page.tsx
   │     │
   │     ├─▶ lib/server/auth       → userId from the SESSION (never from input)
   │     ├─▶ lib/server/queries/*  → Supabase, user's JWT attached
   │     │      └─▶ Postgres: RLS filters to user_id = auth.uid()
   │     ├─▶ lib/server/mappers/*  → rows → domain types
   │     └─▶ lib/core/*            → computeSafeToSpend, aggregates, timeline
   │
   └─▶ streamed HTML + RSC payload
```

### Write

```text
User submits the Add Transaction form (Client Component)
   │
   ├─▶ Server Action  lib/server/actions/transactions.ts
   │     │
   │     ├─ 1. userId ← session.            Client-supplied user_id is IGNORED.
   │     ├─ 2. Zod parse.                   Reject unknown fields; parse amount
   │     │                                  to integer minor units here.
   │     ├─ 3. Re-verify ownership.         Does account_id belong to this user?
   │     │                                  Does category_id? Does the category
   │     │                                  type match the transaction type?
   │     │                                  RLS also enforces this — belt and
   │     │                                  braces, deliberately.
   │     ├─ 4. Write.                       Explicit column allowlist; no
   │     │                                  spreading of client input.
   │     ├─ 5. revalidateTag(...)           transactions, accounts, dashboard, sts
   │     └─ 6. Return a typed result.       Uniform error envelope; never leak
   │                                        a raw Postgres error to the client.
   │
   └─▶ UI refreshes from the server; optimistic state reconciles or rolls back
```

Step 3 is not redundant with RLS. RLS answers "may this user write this row?"
It does not answer "does this write make product sense?" — and a `WITH CHECK`
that only compares `user_id` still permits attaching a transaction to another
user's account. See [rls-policies.md](rls-policies.md#cross-table-ownership).

### Auth

```text
Sign-up / login  →  Server Action  →  Supabase Auth (GoTrue)
                                        │
                                        ├─ httpOnly session cookie set
                                        └─ trigger on auth.users
                                             ├─ create profiles row
                                             │    (currency PHP, tz Asia/Manila)
                                             └─ seed default categories (spec §7)

Every subsequent request:
   middleware.ts refreshes the cookie before it expires
   (app)/**  + no session  → /login?next=<path>
   (auth)/** + session     → /dashboard
```

## Trust boundaries

| # | Boundary | What crosses | Control | If the control fails |
|---|---|---|---|---|
| **B1** | Browser ↔ Server | Form data, Server Action arguments, search params | Nothing from the client is trusted. `user_id` is always derived from the session. Zod validates every field; unknown fields rejected | A user forges another user's `user_id` and writes to their data |
| **B2** | Server ↔ Postgres | SQL via `supabase-js`, user's JWT attached | RLS on every table, default-deny. App-layer ownership re-checks as defence in depth | Cross-tenant read or write — the worst outcome for this product |
| **B3** | CI ↔ Secrets | Workflow tokens, Actions secrets | Least-privilege `GITHUB_TOKEN`, SHA-pinned actions, no `pull_request_target`, fork PRs get no secrets | A malicious PR exfiltrates a secret or pushes to `main` |
| **B4** | App ↔ Third-party client libraries | Chart data (client-side only) | Charting library confined to `components/charts`; no data egress; CSP | A dependency exfiltrates financial data from the browser |
| **B5** | Server ↔ `service_role` | The RLS-bypassing key | `admin.ts` lint-restricted + throws in browser bundles; unused in MVP request paths; never a GitHub secret | Total loss of data isolation |

### The rule that matters most

**The `service_role` key is never reachable from anything under `app/`.**

Allowlisted callers: migration tooling, seed scripts, and (later) scheduled
jobs. Nothing else. If a feature appears to need it, the RLS policy is wrong.

## Performance and scale

What breaks first, in order:

1. **Postgres connections.** Serverless functions open connections
   unpredictably. Use the Supabase connection pooler for the app; direct
   connections only for migrations. Ignoring this is the classic
   serverless-plus-Postgres outage.
2. **Timeline recurrence expansion.** Expanding recurring rules over a 90-day
   horizon is CPU-bound in `lib/core`. Mitigations: hard caps on expanded
   occurrence count, and caching the result under a tagged key.
3. **Dashboard aggregation.** Naive per-category queries become N+1. One
   aggregate query set (or a SQL view), verified against a 5,000-transaction
   seed in [M4](../../tasks/backlog/m4-dashboard-core.md).
4. **Transaction list pagination.** Offset pagination degrades on long
   histories; keyset pagination from the start.

Cache strategy and tag naming: [state-and-caching.md](state-and-caching.md).

## Non-goals

Recorded so they are not relitigated:

- **No monorepo.** [ADR-0001](../adr/0001-single-nextjs-app-not-monorepo.md).
- **No separate API service.** Server Actions and RSC queries are the API.
- **No custom auth.** Supabase Auth handles sessions and password reset.
- **No ORM.** [ADR-0002](../adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md).
- **No multi-currency arithmetic in the MVP.** One currency per user; mixed
  currency is an explicit error. [../domain/money-and-rounding.md](../domain/money-and-rounding.md).
- **No real-time subscriptions.** Personal finance data changes when the user
  changes it; request-scoped reads plus revalidation are sufficient.
- **No multi-tenant sharing.** Shared household budgets are V3 and will require
  an RLS redesign — flagged as the largest architectural change on the roadmap.
