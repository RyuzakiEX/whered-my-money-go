# Observability

**Shape in one sentence:** structured JSON logs correlated by request, carrying
enough to debug a failure and deliberately too little to reconstruct someone's
finances — because a log aggregator is a copy of your database with none of its
access controls.

Related: [../security/security-model.md](../security/security-model.md),
[system-architecture.md](system-architecture.md),
[api-and-data-access.md](api-and-data-access.md),
[../ops/environments.md](../ops/environments.md).

## Contents

- [The governing principle](#the-governing-principle)
- [Log shape](#log-shape)
- [Never log this](#never-log-this)
- [Log levels](#log-levels)
- [Error tracking](#error-tracking)
- [Audit log](#audit-log)
- [What to alert on](#what-to-alert-on)
- [Health checks](#health-checks)

## The governing principle

> **A log line is a copy of data outside the database's protection.**

Postgres has Row Level Security ([rls-policies.md](rls-policies.md)) ensuring
one user can never read another's transactions. A log aggregator has none of
that: it is searchable by anyone with dashboard access, retained for months,
replicated, and frequently a third-party service.

So the rule is not "avoid logging secrets". It is stronger:

**Log what identifies the *failure*, not what identifies the *money*.**

`userId` plus `"insert into transactions failed: FK violation on account_id"` is
debuggable. Adding `amount=15000, description="Rent September"` turns a support
tool into a financial dossier and provides no additional diagnostic value —
the constraint that failed is the bug, not the number.

## Log shape

Structured JSON, one object per line, from `lib/server/logger.ts`.

```json
{
  "level": "error",
  "time": "2026-09-09T04:12:33.481Z",
  "requestId": "01JBQ4X7YH8K2M9",
  "userId": "8f3c1e22-...",
  "route": "/transactions",
  "action": "createTransaction",
  "durationMs": 142,
  "outcome": "failure",
  "errorCode": "FOREIGN_KEY_VIOLATION",
  "errorMessage": "account_id not found or not owned",
  "env": "production",
  "release": "v0.7.0"
}
```

| Field | Always | Notes |
|---|---|---|
| `level` | ● | See [levels](#log-levels) |
| `time` | ● | ISO 8601 UTC |
| `requestId` | ● | ULID, generated in `middleware.ts`, threaded through the request |
| `userId` | when authenticated | **Opaque UUID only** — never email, never name |
| `route` | ● | Pathname, **never** the query string (filters leak intent) |
| `action` | for mutations | Server Action name |
| `durationMs` | for completed work | Feeds the performance budget |
| `outcome` | ● | `success` / `failure` |
| `errorCode` | on failure | Stable enum from the [error envelope](api-and-data-access.md) |
| `errorMessage` | on failure | Our own message, never a raw driver string |
| `env`, `release` | ● | Correlate a spike to a deploy |

### `requestId` is the thing that makes logs usable

Generated once per request and attached to every line. Without it, a
concurrent-request log stream is noise — you cannot tell which "insert failed"
belongs to which "request started". With it, one search reconstructs a single
user's single failed action. It is also returned in the error envelope, so a
user reporting a problem can quote an ID that finds the exact trace.

## Never log this

Hard prohibitions. Violating one is a `priority:p0` incident, not a cleanup
task.

| Never | Why |
|---|---|
| **Amounts alongside identity** | `userId` + `amountMinor` in one line reconstructs a transaction history from logs alone. **The central rule of this document.** |
| Transaction descriptions | Free text the user wrote. Often names a person, a purpose, or a medical expense. |
| Account names or balances | `"BPI Savings: ₱240,000"` is exactly the disclosure RLS exists to prevent. |
| Category names with amounts | Spending shape is sensitive even without exact figures. |
| Session tokens, JWTs, cookies | A logged token is a working credential. |
| `SUPABASE_SERVICE_ROLE_KEY` | Total loss of data isolation. |
| Password reset tokens | Account takeover. |
| Passwords — including failed attempts | Users mistype their password *into* the username field. |
| Email addresses | PII, and it is the account identifier. Use `userId`. |
| Raw request bodies | Contains all of the above at once. |
| Raw Postgres error text | May echo row values in constraint-violation detail. |
| Full query strings | `?category=medical&min=50000` is sensitive. |

### Logging money safely, when you must

Occasionally a money bug genuinely needs numeric context. Two sanctioned
options:

1. **Log the shape, not the value.** `amountDigits: 5`, `sign: "negative"`,
   `currency: "PHP"` — enough to catch a unit error (centavos vs pesos) without
   recording the amount.
2. **Log the ID and look it up.** `transactionId` plus an `errorCode`. Anyone
   with legitimate need reads the row through the database, where access is
   controlled and audited.

Redaction is **structural, not a regex**: the logger accepts a typed context
object with an allowlist of loggable fields. A denylist of key names fails the
moment someone writes `{ detail: { amount: … } }`.

```typescript
// lib/server/logger.ts
type LoggableContext = {
  requestId: string;
  userId?: string;           // UUID only
  route?: string;
  action?: string;
  durationMs?: number;
  outcome?: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  entityId?: string;         // an id is fine; its contents are not
  count?: number;
};
// Anything not in this type cannot be logged. Enforced by the compiler.
```

## Log levels

| Level | Use | Example |
|---|---|---|
| `error` | Failed and the user is affected | Mutation failed, unhandled exception |
| `warn` | Degraded but handled | Cache miss storm, timeline truncated at the cap, retry succeeded |
| `info` | Notable successful events | Sign-in, sign-out, mutation succeeded |
| `debug` | Local only — **never enabled in production** | Query plans, intermediate values |

`debug` is production-disabled by configuration *and* by the type above: the
fields a debug line would want are the ones it cannot have.

## Error tracking

An error tracker (Sentry or equivalent, wired in `M9-B04`) catches unhandled
exceptions with stack traces. It is subject to every prohibition above, plus
two of its own — because a tracker's defaults are built for apps that are not
handling financial data:

- **Disable automatic request-body capture.** Default-on in most SDKs; it would
  capture exactly the transaction payloads this document forbids.
- **Scrub before send.** A `beforeSend` hook strips anything not on the
  allowlist. Verified by a test (`M9-B04`) that throws a synthetic error
  carrying an amount and asserts the outbound payload does not contain it.

Attach `requestId`, `userId`, `release`, and `route` as tags. That is enough to
group, triage, and correlate with logs.

Route-level `error.tsx` boundaries per route group render a friendly failure —
in spec §32's non-judgmental voice, with the `requestId` shown so a user can
quote it — rather than a stack trace.

## Audit log

Distinct from application logs, and the distinction is the point:

| | Application logs | Audit log |
|---|---|---|
| **Question** | "Why did this break?" | "Who changed this, and when?" |
| **Storage** | Log aggregator | `audit_log` table in Postgres |
| **Protected by** | Dashboard access control | **RLS, like every other table** |
| **Retention** | Weeks | Long-term |
| **Contains** | No money, no PII | Entity ids, action, actor, timestamp |
| **Readable by** | Operators | The user themselves (their own rows) |

Spec §24 asks for "audit logging where appropriate". Scope:

- Authentication events — sign-up, sign-in, sign-out, password reset requested
  and completed.
- Mutations to `accounts`, `budgets`, `goals`, `recurring_transactions`.
- **All deletes**, including transactions.
- Changes to `exclude_from_safe_to_spend` — it silently changes the headline
  figure, so a user asking "why did my Safe to Spend drop?" deserves an answer.

Deliberately **not** audited: individual transaction creates and updates. They
are the app's highest-volume action, and `transactions` already carries
`created_at` / `updated_at` — a parallel audit trail would double write volume
to restate what the row already says.

The table lives in Postgres precisely so it inherits RLS. An audit trail of
someone's finances stored *outside* the access-control system would be a new
disclosure risk rather than a control. Schema:
[data-model.md](data-model.md). It is a V2 table; the scope is fixed now so
`M9-B01`'s security review has something to check against.

## What to alert on

Alert on things that need a human. Everything else is a dashboard.

| Alert | Threshold | Why |
|---|---|---|
| Error rate spike | > 2% of requests over 5 min | Something broke |
| Any `error` on a mutation path | Immediate | Money did not get recorded |
| Auth failure spike | Unusual volume from one IP | Credential stuffing |
| Cross-user access attempt | **Any occurrence** | RLS caught it, but someone tried |
| Dashboard p95 latency | > budget from `M9-B03` | Perf regression |
| Timeline truncation rate | Rising | The occurrence cap is being hit; needs tuning |
| Failed migration on deploy | Immediate | Schema/app mismatch window is open |
| Supabase connection saturation | > 80% of pool | The first thing that breaks at scale |

**Not alerts:** individual 4xx responses, validation failures, a single expected
error. Alert fatigue means real alerts get ignored, and the one that gets
ignored will be the cross-tenant one.

## Health checks

`GET /api/health` — a Route Handler, one of the few legitimate uses of one
([api-and-data-access.md](api-and-data-access.md)):

```json
{ "status": "ok", "release": "v0.7.0", "checks": { "database": "ok" } }
```

- **Unauthenticated** but reveals nothing: no counts, no versions beyond the
  release tag, no configuration.
- **Database check is a trivial round trip** (`select 1`), not a real query. It
  answers "can we reach Postgres", and must not become a way to probe data.
- Returns `503` when a check fails, so uptime monitoring and platform health
  checks work.
