# Architecture

**How it all fits, on one screen.**

```text
                        Browser
                  Client Components only for
              forms · dialogs · charts · filters
                            │
                    httpOnly session cookie
                            │
        ┌───────────────────▼───────────────────────┐
        │  Vercel — Next.js App Router              │
        │                                           │
        │  middleware.ts     session refresh, guards │
        │        │                                   │
        │  Server Components ──▶ lib/server/queries  │
        │  Server Actions   ──▶ lib/server/actions   │
        │        │                    │              │
        │        │              lib/server/mappers   │
        │        │              rows → domain types  │
        │        ▼                    │              │
        │  lib/core  ◀────────────────┘              │
        │  PURE money math. No I/O, no clock.        │
        └───────────────────┬───────────────────────┘
                            │  user's JWT attached
                            │  → RLS applies
        ┌───────────────────▼───────────────────────┐
        │  Supabase — Postgres + Auth               │
        │  Row Level Security on every table        │
        │  supabase/migrations = schema truth       │
        └───────────────────────────────────────────┘
```

No separate API service. Next.js *is* the backend; Postgres enforces
authorization.

## The five ideas

Everything else follows from these.

**1. Server-first.** Pages that show money are Server Components reading
RLS-scoped data. Money is never computed in the browser.

**2. The domain core is pure.** `lib/core` holds every calculation and imports
nothing — no React, no database, no clock. That makes it exhaustively testable
and reusable by What-If unchanged.
→ [ADR-0003](../adr/0003-pure-typescript-domain-core.md)

**3. Authorization is three independent layers.** Identity from the session →
application ownership re-check → Row Level Security. Each catches a different
failure; RLS is the last line, not the only one.
→ [../security/security-model.md](../security/security-model.md#the-three-layer-rule)

**4. Migrations are the schema.** Hand-written SQL in `supabase/migrations`,
with CI proving on every change that they replay cleanly, have not drifted,
match the generated types, and left RLS enabled everywhere.
→ [ADR-0002](../adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md)

**5. Money is integer minor units.** `₱1,234.56` is `123456`. Never a float,
anywhere.
→ [ADR-0005](../adr/0005-money-as-integer-minor-units.md)

## Where to look

| Question | Document |
|---|---|
| What talks to what? Where are the trust boundaries? | [system-architecture.md](system-architecture.md) |
| Where does this code go? What may it import? | [source-structure.md](source-structure.md) |
| What columns exist? What type is this? | [data-model.md](data-model.md) |
| Who can read this row? | [rls-policies.md](rls-policies.md) |
| Server Action or Route Handler? How do errors surface? | [api-and-data-access.md](api-and-data-access.md) |
| What invalidates the cache after a write? | [state-and-caching.md](state-and-caching.md) |
| Server or Client Component? How do I format ₱? | [frontend-architecture.md](frontend-architecture.md) |
| What may I log? | [observability.md](observability.md) |
| How is Safe to Spend actually calculated? | [../domain/safe-to-spend.md](../domain/safe-to-spend.md) |

## Boundaries in one table

The import matrix from [source-structure.md](source-structure.md#import-rules),
enforced by lint:

| Layer | May import | Must never import |
|---|---|---|
| `lib/core` | `lib/core`, TS stdlib | React, Next, supabase-js, Zod, date libs, `process.env` |
| `lib/server` | `lib/core`, `lib/validation`, supabase-js, Next server APIs | `components/*`, browser APIs |
| `app/**` | `lib/server`, `lib/core`, `components` | `lib/server/supabase/admin` |
| `components/**` | `lib/core` **types**, `lib/utils` | `lib/server` |

## What this is not

- Not a monorepo — [ADR-0001](../adr/0001-single-nextjs-app-not-monorepo.md)
- No ORM — [ADR-0002](../adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md)
- No custom auth — Supabase Auth
- No global client state store — [state-and-caching.md](state-and-caching.md#why-no-global-client-store)
- No real-time subscriptions — request-scoped reads plus tag revalidation
- No multi-currency arithmetic in the MVP — [../domain/money-and-rounding.md](../domain/money-and-rounding.md)
- No multi-tenant sharing — V3, and it will need an RLS redesign
