# API and Data Access

> [!IMPORTANT]
> **PLANNED — no application code exists yet.** This document defines the
> conventions that [M1](../../tasks/backlog/m1-auth-and-profile.md) onwards
> implement. The directory layout it refers to is created by
> [M0](../../tasks/backlog/m0-foundation.md) — see
> [source-structure.md](source-structure.md).

**Shape in one sentence:** there is no API — Server Components read directly and
Server Actions write, both through a request-scoped Supabase client carrying the
user's JWT, with Zod parsing at every entry point and a discriminated-union
result type as the only thing that ever crosses back to the client.

The absence of a REST surface of our own is a feature: no public endpoints to
authorize, version, rate-limit, or document, and no second place for an
authorization bug to live. See
[system-architecture.md](system-architecture.md#rendering-strategy) and
[ADR-0001](../adr/0001-single-nextjs-app-not-monorepo.md).

Related: [rls-policies.md](rls-policies.md) for the database-level checks these
functions sit in front of, [data-model.md](data-model.md) for the schema,
[state-and-caching.md](state-and-caching.md) for what a mutation invalidates, and
[../security/security-model.md](../security/security-model.md) for the threat
model.

## Contents

- [Three mechanisms, one decision table](#three-mechanisms-one-decision-table)
- [Direct RSC queries](#direct-rsc-queries)
- [Server Actions](#server-actions)
- [Route Handlers](#route-handlers-are-for-webhooks-and-cron-only)
- [The validation boundary](#the-validation-boundary)
- [The result envelope](#the-result-envelope)
- [Column allowlists](#column-allowlists)
- [When `service_role` may be used](#when-service_role-may-be-used)
- [Mapper discipline](#mapper-discipline)
- [Ownership re-checks](#ownership-re-checks)
- [What is deliberately absent](#what-is-deliberately-absent)

## Three mechanisms, one decision table

Next.js offers three ways to reach the database. Picking per-case by taste
produces a codebase where the same operation is done three ways. This table is
the rule.

| Need | Mechanism | Where it lives | Why |
|---|---|---|---|
| Render data on a page | **Direct RSC query** | `lib/server/queries/*` called from a Server Component | No client round trip, no serialization boundary, no endpoint to secure. The page and its data are one unit |
| Mutate data from a form or button | **Server Action** | `lib/server/actions/*` | Progressive enhancement, typed arguments, integrated with `revalidateTag`, and no URL an attacker can enumerate |
| Receive a request from outside our app | **Route Handler** | `app/api/*` | Only mechanism that exposes an HTTP endpoint. Required for webhooks and cron |
| Client-side incremental fetch (infinite scroll) | **Server Action**, not a Route Handler | `lib/server/actions/*` | Actions are callable from Client Components and return typed data. A Route Handler for this creates a public JSON endpoint solely so our own UI can call it |
| Client-side search-as-you-type | **Server Action** | `lib/server/actions/*` | Same reasoning. Debounce on the client, call the action |
| Download a CSV export (V2) | **Route Handler** | `app/api/export/route.ts` | Needs real response headers — `Content-Type`, `Content-Disposition`. An Action returns data, not a response |
| Anything a third party calls | **Route Handler** | `app/api/*` | By definition |

The decision reduces to one question: **does something outside this Next.js app
need to make an HTTP request?** If no — and for the entire MVP the answer is no —
it is an RSC query or a Server Action.

### Route Handlers are for webhooks and cron only

`app/api/` exists in the tree ([source-structure.md](source-structure.md#the-tree))
with that constraint written next to it. Enforced by review, and by the fact
that the MVP ships zero route handlers.

Why the restriction is worth having:

- **Every Route Handler is a new public URL.** It must independently establish
  identity, parse input, and authorize. A Server Action inherits the session
  from the request that invoked it. One less thing to get wrong, per endpoint.
- **They invite a parallel API.** Once `app/api/transactions/route.ts` exists,
  the next transaction feature is tempted to go through it, and gradually there
  are two data-access paths with two sets of validation — one of which will fall
  behind.
- **Actions cover the client-fetch cases.** The usual reason to reach for a
  Route Handler is "a Client Component needs data". Server Actions do that, with
  types, without a URL.

Anticipated Route Handlers, all V2 or later:

| Route | Purpose | Auth mechanism |
|---|---|---|
| `app/api/cron/materialize-recurring/route.ts` | Materialize due recurring transactions (spec §15) | `CRON_SECRET` header comparison, constant-time. Not a user session — there is no user |
| `app/api/export/route.ts` | CSV export (spec §27) | Normal user session |
| `app/api/webhooks/*/route.ts` | If a payment provider ever appears | Provider signature verification on the raw body |

Rules for each, since they bypass the protections Actions get for free:

- Verify the caller **before** parsing the body. A malformed body from an
  unauthenticated caller should be rejected as unauthenticated, not as invalid.
- Compare secrets with a constant-time comparison. String `===` on a secret is a
  timing oracle.
- The cron route uses `service_role` and is therefore the *only* MVP-era
  exception to [the `service_role` rule](#when-service_role-may-be-used) — with
  its own ADR when it lands.
- Return the [result envelope](#the-result-envelope) as JSON, not raw errors.

## Direct RSC queries

A Server Component calls a query function. No fetch, no endpoint, no cache
header negotiation.

```ts
// app/(app)/dashboard/page.tsx  — Server Component
import { getCurrentUserId } from '@/lib/server/auth';
import { listAccountBalances } from '@/lib/server/queries/accounts';
import { listTransactionsInPeriod } from '@/lib/server/queries/transactions';
import { computeSafeToSpend } from '@/lib/core/safe-to-spend';

export default async function DashboardPage() {
  const userId = await getCurrentUserId();          // from the SESSION
  const [accounts, transactions] = await Promise.all([
    listAccountBalances(),
    listTransactionsInPeriod(currentMonth()),
  ]);

  const safeToSpend = computeSafeToSpend({ accounts, transactions, today });
  return <DashboardView safeToSpend={safeToSpend} /* … */ />;
}
```

Four rules for query functions in `lib/server/queries/`:

1. **They take no `userId` parameter.** The Supabase client is request-scoped and
   carries the user's JWT; RLS scopes the rows. A `userId` argument is a
   parameter that can be passed wrongly, and a signature that invites a caller
   to pass one from a search param. Where a query needs the id for something
   other than filtering, it calls `getCurrentUserId()` itself.
2. **They return domain types, never rows.** Mapping happens inside the query.
   See [Mapper discipline](#mapper-discipline).
3. **They contain no domain math.** A query fetches and maps. Summing, forecasting,
   and Safe to Spend belong in `lib/core`
   ([source-structure.md](source-structure.md#why-libcore-is-quarantined)).
4. **They throw on infrastructure failure; they do not return an envelope.** A
   read that fails is an exception, handled by the route's `error.tsx`. The
   envelope exists for *writes*, where the client needs a field-level response.
   A query returning `Result<T>` would force every Server Component into
   `if (!result.ok)` branching that renders nothing useful anyway.

`Promise.all` for independent reads is not an optimisation detail — sequential
awaits in a Server Component serialize round trips to Supabase and are the most
common cause of a slow dashboard.

## Server Actions

Every write goes through one. The canonical shape, in order, with nothing
omitted:

```ts
// lib/server/actions/transactions.ts
'use server';

import { revalidateTag } from 'next/cache';
import { getCurrentUserId } from '@/lib/server/auth';
import { createServerClient } from '@/lib/server/supabase/server';
import { createTransactionSchema } from '@/lib/validation/transactions';
import { tags } from '@/lib/server/cache/tags';
import { toDomainTransaction } from '@/lib/server/mappers/transactions';
import { err, ok, type ActionResult } from '@/lib/server/result';
import type { Transaction } from '@/lib/core/types';

export async function createTransaction(
  input: unknown,
): Promise<ActionResult<Transaction>> {
  // 1. Identity from the session. Client-supplied user_id is never read.
  const userId = await getCurrentUserId();
  if (!userId) return err('unauthenticated');

  // 2. Parse, don't validate. `input` is unknown until this line.
  const parsed = createTransactionSchema.safeParse(input);
  if (!parsed.success) return err('validation', fieldErrors(parsed.error));
  const data = parsed.data;                 // fully typed, minor units, trimmed

  const supabase = createServerClient();

  // 3. Re-verify ownership and product invariants. RLS also enforces the
  //    ownership half — deliberately belt and braces. This layer exists to
  //    return a useful message instead of a 42501.
  const refs = await verifyTransactionRefs(supabase, data);
  if (!refs.ok) return refs;

  // 4. Write with an explicit column allowlist. `data` is never spread.
  const { data: row, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,                      // from the session, not from input
      account_id: data.accountId,
      category_id: data.categoryId ?? null,
      amount_minor: data.amountMinor,
      currency: data.currency,
      type: data.type,
      description: data.description ?? null,
      occurred_on: data.occurredOn,
    })
    .select('id, account_id, category_id, amount_minor, currency, type, description, occurred_on, created_at, updated_at')
    .single();

  if (error) return mapPostgresError(error);   // never surfaces `error` itself

  // 5. Invalidate. Tags are constants; see state-and-caching.md.
  revalidateTag(tags.transactions(userId));
  revalidateTag(tags.accounts(userId));
  revalidateTag(tags.dashboard(userId));
  revalidateTag(tags.safeToSpend(userId));

  // 6. Typed result. Domain type, not a row.
  return ok(toDomainTransaction(row));
}
```

Non-negotiables, and what goes wrong without each:

| Rule | Failure without it |
|---|---|
| `userId` from the session, never from input | A user forges another user's `user_id` (trust boundary **B1**) |
| `input: unknown`, parsed on line 1 of the body | A typed parameter is a *claim* about untrusted data; TypeScript erases it at runtime |
| Ownership re-check before the write | RLS rejects it with `42501`, and the user sees "something went wrong" instead of "that account doesn't exist" |
| Explicit column allowlist | Client input reaches a column nobody intended — see [Column allowlists](#column-allowlists) |
| `revalidateTag` before returning | The UI shows stale numbers after a write; the most-reported bug class in a server-first app |
| Return the envelope, never throw to the client | A raw Postgres error leaks schema details and constraint names |

Actions are also the only place a multi-row invariant can be maintained.
Creating a transfer writes two `transactions` rows sharing a
`transfer_group_id` ([data-model.md](data-model.md#3-transfer_group_id-uuid-pairs-the-two-legs-of-a-transfer));
that pairing has no database-level enforcement, so the action must write both or
neither via an RPC wrapped in a transaction. A partially-written transfer
corrupts two account balances at once.

## The validation boundary

**Zod at every entry point. Every one.** An entry point is any function where
data crosses from outside the server into it:

| Entry point | Validated |
|---|---|
| Server Action arguments | Always, first statement |
| Route Handler bodies | Always, after auth |
| URL search params | Always — filters and pagination cursors are user input |
| Route params (`[id]`) | Always — a UUID string is not a UUID |
| `formData` | Always. Every value is `string \| File` |
| Third-party webhook payloads | Always, after signature verification |

Schemas live in `lib/validation/` and are imported by both actions and forms, so
client-side and server-side validation cannot disagree
([source-structure.md](source-structure.md#the-contract-first-protocol)).

### Parse, don't validate

The distinction is the whole point. A *validator* answers a yes/no question and
leaves you holding the original untyped value. A *parser* returns a new value
whose type encodes what was proven about it.

```ts
// ❌ Validate: the check and the use are separate, and drift.
function createTransaction(input: TransactionInput) {
  if (!isValid(input)) throw new Error('invalid');
  // `input` is still whatever the caller passed. The type is a promise
  // TypeScript cannot keep — this function is reachable from a network
  // boundary, and at runtime `input` could be a string.
  await db.insert(input);
}

// ✅ Parse: after this line, the value's type is earned.
const parsed = createTransactionSchema.safeParse(input);
if (!parsed.success) return err('validation', fieldErrors(parsed.error));
const data = parsed.data;   // amountMinor is a positive integer. Proven.
```

Consequences that matter in this codebase specifically:

- **Money is parsed to minor units at the boundary, once.** The user types
  `1,234.56`; the schema turns it into `123456`. Nothing downstream sees a
  decimal, so nothing downstream can multiply by 100 a second time. See
  [../domain/money-and-rounding.md](../domain/money-and-rounding.md).
- **Dates are parsed to `YYYY-MM-DD` strings, never `Date` objects.** A `Date` is
  an instant; `occurred_on` is a calendar day. Passing a `Date` through invites
  a timezone shift that moves a transaction into the previous month — the exact
  bug [../domain/recurrence.md](../domain/recurrence.md) exists to prevent.
- **Strings are trimmed and length-capped in the schema**, so the check
  constraints in [data-model.md](data-model.md#constraints-summary) are a
  backstop rather than the user-facing error.

### Reject unknown fields

Zod objects are strict by default in the sense that unknown keys are *stripped* —
which is safe, but silent. We go further and **reject**:

```ts
export const createTransactionSchema = z
  .object({
    accountId:   z.string().uuid(),
    categoryId:  z.string().uuid().nullish(),
    amountMinor: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency:    z.string().length(3).regex(/^[A-Z]{3}$/),
    type:        z.enum(['income', 'expense', 'transfer']),
    description: z.string().trim().max(200).nullish(),
    occurredOn:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();                    // ← unknown keys are an ERROR, not stripped
```

`.strict()` on every schema, without exception. Two reasons:

1. **It catches the attack.** A client sending `{ userId: '<victim>', … }` or
   `{ isArchived: true, … }` gets a validation error. With stripping, the extra
   key is silently discarded — safe today, but it means the payload an attacker
   is probing with looks *accepted*, and it means a future refactor that starts
   spreading `data` inherits a live vulnerability.
2. **It catches our own bugs.** A form renaming `amount` to `amountMinor`
   without updating the schema fails loudly instead of inserting a default.

`.strict()` and the [column allowlist](#column-allowlists) are two independent
layers guarding the same attack. Both, because either alone is one refactor away
from being gone.

### Cross-field rules belong in the schema

```ts
export const createTransactionSchema = z.object({ /* … */ })
  .strict()
  .refine((v) => v.type !== 'transfer' || v.categoryId == null, {
    path: ['categoryId'],
    message: 'Transfers are not categorised.',
  })
  .refine((v) => v.occurredOn <= todayInUserTz, {
    path: ['occurredOn'],
    message: "That's in the future. Use a recurring transaction instead.",
  });
```

The first `refine` duplicates the `transactions_transfer_no_category` check
constraint. That is intentional: the constraint guarantees the invariant, the
`refine` produces a message attached to the right form field. A constraint
violation surfacing as a toast is a worse product than a field error, and the
constraint is what makes the invariant true.

## The result envelope

Every Server Action returns a discriminated union. Never `T | null`, never a
thrown error, never a bare boolean.

```ts
// lib/server/result.ts
export type ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: ActionError };

export type ActionError =
  | { kind: 'validation';     fields: Record<string, string[]> }
  | { kind: 'unauthenticated' }
  | { kind: 'not_found';      entity: EntityName }
  | { kind: 'conflict';       reason: ConflictReason; message: string }
  | { kind: 'rate_limited';   retryAfterSeconds: number }
  | { kind: 'unexpected';     correlationId: string };
```

Why a union rather than exceptions:

- **The call site is forced to handle failure.** `result.data` does not typecheck
  until `result.ok` is narrowed. A thrown error is invisible in the type
  signature and gets forgotten.
- **Validation errors are structured.** `fields` maps directly onto form field
  errors. A string message cannot.
- **It survives the RSC boundary.** Server Action return values are serialized;
  a plain object crosses cleanly, an `Error` subclass does not keep its shape.

### Never throw raw Postgres errors to the client

```ts
// lib/server/result.ts
export function mapPostgresError(e: PostgrestError): ActionResult<never> {
  switch (e.code) {
    case '23505':  // unique_violation
      return err('conflict', conflictFromConstraint(e.constraint));
    case '23503':  // foreign_key_violation
      return err('not_found', entityFromConstraint(e.constraint));
    case '23514':  // check_violation
      return err('conflict', conflictFromConstraint(e.constraint));
    case '42501':  // insufficient_privilege — an RLS rejection
      // Reaching here means an ownership re-check was missed upstream.
      // Report it as not-found (see below) and alert: it is our bug.
      logger.error({ event: 'rls.rejection', constraint: e.constraint });
      return err('not_found', 'record');
    default: {
      const correlationId = currentCorrelationId();
      logger.error({ event: 'db.unexpected', correlationId, code: e.code });
      return err('unexpected', correlationId);
    }
  }
}
```

A raw `PostgrestError` reaching the browser hands an attacker table names,
column names, constraint names, and often a fragment of the failing SQL — a free
schema dump from a malformed form submission. The named constraints in
[data-model.md](data-model.md#constraints-summary) are what make this mapping
possible: `budgets_unique_period` maps to a specific sentence, whereas
`budgets_category_id_period_start_key1` maps to nothing.

The `unexpected` branch returns a `correlationId` and nothing else. The user can
quote it to support; the details are in the logs
([observability.md](observability.md)).

### Never leak whether a record exists

**Cross-user access returns `not_found`, never `forbidden`.**

```ts
// ❌ Leaks existence.
const account = await getAccount(id);
if (!account)                    return err('not_found', 'account');
if (account.userId !== userId)   return err('forbidden');   // ← "this exists"

// ✅ Indistinguishable.
const account = await getAccount(id);   // RLS-scoped: another user's row
if (!account) return err('not_found', 'account');   // reads as absent
```

`403` and `404` are different answers, and the difference is information. An
attacker iterating UUIDs learns which ones are real accounts belonging to
someone else — the same oracle that makes IDOR enumeration productive, and the
same UUID leakage that makes the
[cross-table ownership](rls-policies.md#cross-table-ownership) attack viable.

This is nearly free here because RLS-scoped reads already return nothing for
another user's row: the natural code path produces the correct answer, and
`forbidden` would have to be added deliberately. `ActionError` has no
`forbidden` variant, so it cannot be returned by accident.

The one intentional exception: `unauthenticated` is distinguishable from
`not_found`, because "you are logged out" is information the user needs and
leaks nothing about which records exist.

## Column allowlists

**Never spread client input into a write.**

```ts
// ❌ Every one of these is the same bug.
await supabase.from('transactions').insert({ ...data, user_id: userId });
await supabase.from('accounts').update({ ...input }).eq('id', id);
await supabase.from('goals').insert(parsed.data);
```

Even with `.strict()` upstream, spreading is wrong. `.strict()` protects the
*current* schema; the spread is a standing instruction to write whatever the
schema happens to allow tomorrow. Add one field to a validation schema for a new
form, and it silently becomes writable everywhere that schema is spread. Concrete
cases in this schema:

| If a spread reached this column | Result |
|---|---|
| `user_id` | Row written under another user (blocked by RLS — but relying on RLS for a bug the app can prevent is backwards) |
| `accounts.opening_balance_minor` | Balance rewritten from the client. Every derived number changes ([data-model.md](data-model.md#4-opening-balance-is-stored-current-balance-is-derived)) |
| `accounts.exclude_from_safe_to_spend` | Safe to Spend manipulated through a form that does not expose the field |
| `goals.achieved_at` | Fabricated achievement history |
| `is_default`, `is_archived` | State the UI never offers, set anyway |
| `created_at` | Rewritten audit trail |

So: name every column, every time.

```ts
// ✅ Explicit. Reviewable. A new schema field cannot become writable by accident.
const patch = {
  name: data.name,
  type: data.type,
  currency: data.currency,
  exclude_from_safe_to_spend: data.excludeFromSafeToSpend,
  display_order: data.displayOrder,
} satisfies AccountUpdate;

await supabase.from('accounts').update(patch).eq('id', accountId);
```

The same rule applies to reads: `.select()` with no argument returns `*`, which
means a column added later starts flowing to the client without anyone deciding
it should.

```ts
// ❌ `*` — today's shape is not tomorrow's.
.select()
// ✅ Named columns, matching what the mapper consumes.
.select('id, name, type, currency, exclude_from_safe_to_spend, is_archived')
```

`satisfies` rather than `as`: `as` silences the compiler, `satisfies` checks the
object against the generated `Insert`/`Update` type from
`types/database.types.ts` while keeping the literal's precision. A typo'd column
name is a compile error.

## When `service_role` may be used

**Essentially never.**

The `service_role` key bypasses every policy in
[rls-policies.md](rls-policies.md). It is trust boundary **B5**
([system-architecture.md](system-architecture.md#trust-boundaries)) and the
single most dangerous value in the system: one leak or one misuse is total loss
of data isolation for every user.

`lib/server/supabase/admin.ts` is the only module that constructs it, guarded
three ways ([source-structure.md](source-structure.md#the-admints-restriction)):
lint allowlist, a runtime throw if bundled for the browser, and `CODEOWNERS`.

| Caller | Allowed | Note |
|---|---|---|
| Anything under `app/` | **No** | Never. Not for an admin page, not "temporarily" |
| `lib/server/queries/*` | **No** | If a read needs it, a `select` policy is missing |
| `lib/server/actions/*` | **No** | If a write needs it, a `with check` is missing or the data model is wrong |
| `supabase/seed.sql` tooling | Yes | Local development only |
| Migration tooling | Yes | Runs as the migration role by design |
| `tests/integration/*` fixture setup | Yes | Creating test users requires it. Never for assertions — a test that reads through `service_role` proves nothing about RLS ([rls-policies.md](rls-policies.md#testing-strategy)) |
| Scheduled job (V2 recurring materialisation) | Yes, with an ADR | Acts for all users with no session; no `auth.uid()` exists. The narrowest legitimate case in the roadmap |

### The heuristic

> **If a request-path feature seems to need `service_role`, the RLS policy is
> wrong.** Fix the policy.

Real examples of the temptation and the actual fix:

| "We need `service_role` because…" | The real fix |
|---|---|
| "The dashboard aggregate query returns nothing" | The view is missing `security_invoker = true` ([rls-policies.md](rls-policies.md#views-and-rls)) |
| "Sign-up can't create the profile" | It shouldn't. A trigger does ([rls-policies.md](rls-policies.md#profile-creation)) |
| "The insert fails with 42501" | A cross-table `with check` is rejecting a reference the user doesn't own — which is the policy working |
| "We need to write the audit log" | `audit_log_insert_own` allows the user's own rows |
| "Support needs to see a user's data" | That is a designed capability with its own auth, audit, and ADR. Not a key |

When the V2 cron job does need it, the constraints are: a Route Handler under
`app/api/cron/`, secret verified before anything else, every query explicitly
`.eq('user_id', …)` scoped even though RLS is bypassed, no user-supplied input
reaching it, and every action written to `audit_log`.

## Mapper discipline

**Database rows never leave `lib/server`.** Every query maps rows to domain
types before returning. Mandatory, per
[source-structure.md](source-structure.md#conventions).

```ts
// lib/server/mappers/transactions.ts
import type { Tables } from '@/types/database.types';
import type { Transaction } from '@/lib/core/types';

type Row = Tables<'transactions'>;

export function toDomainTransaction(row: Row): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    categoryId: row.category_id,
    // The domain type carries a Money value object, not a loose integer —
    // amount and currency travel together so no calculation can mix them.
    amount: { minor: row.amount_minor, currency: row.currency },
    direction: row.type,          // 'income' | 'expense' | 'transfer'
    description: row.description,
    occurredOn: row.occurred_on,  // 'YYYY-MM-DD', a calendar day
    transferGroupId: row.transfer_group_id,
  };
}
```

What the boundary buys, concretely:

| Change | With mappers | Without |
|---|---|---|
| Rename `occurred_on` | One mapper line | Every component, query, and test |
| `goals.current_amount` becomes a view ([data-model.md](data-model.md#6-goal_contributions-is-a-new-table)) | Mapper reads from the view | Every consumer learns a new shape |
| Add a column | Nothing, until the domain wants it | It appears in props and someone renders it |
| Test `lib/core` | Construct a domain object | Construct a plausible database row |

Rules:

- **`lib/core` must not import `types/database.types.ts`.** Enforced by
  ESLint ([source-structure.md](source-structure.md#import-rules)). `lib/core` is
  the product's model; a generated Postgres type is not.
- **Components receive domain types.** A component with `snake_case` props is a
  leaked row and a lint failure waiting to happen.
- **Mapping is one-directional per function.** `toDomainX` and `toRowX` are
  separate. A bidirectional mapper accumulates conditionals about which
  direction it is going.
- **Mappers are pure and unit-tested.** They are the only place a column-to-field
  mistake can hide, and they need no database to test.
- **Nullability is resolved at the mapper.** `types/database.types.ts` marks
  many columns nullable because Postgres does; where the domain requires a
  value, the mapper throws on null rather than propagating `T | null` into every
  consumer. A null there is a schema bug, not a UI state.

## Ownership re-checks

Step 3 of the [Server Action](#server-actions) shape. RLS enforces ownership
too, so this looks redundant. It is not — the two layers answer different
questions.

| Question | Answered by |
|---|---|
| May this user write this row? | RLS |
| Does the referenced account belong to them? | RLS (`with check`) **and** the action |
| Does this write make product sense? | Only the action |
| What should the user be told? | Only the action |

```ts
async function verifyTransactionRefs(
  supabase: SupabaseClient,
  data: CreateTransactionInput,
): Promise<ActionResult<void>> {
  // RLS-scoped: another user's account simply is not visible here.
  const { data: account } = await supabase
    .from('accounts')
    .select('id, currency, is_archived')
    .eq('id', data.accountId)
    .maybeSingle();

  if (!account) return err('not_found', 'account');   // not `forbidden`
  if (account.is_archived) {
    return err('conflict', 'account_archived',
      'That account is archived. Unarchive it to add transactions.');
  }
  if (account.currency !== data.currency) {
    return err('conflict', 'currency_mismatch',
      'That transaction is in a different currency than the account.');
  }

  if (data.categoryId) {
    const { data: category } = await supabase
      .from('categories')
      .select('id, type')
      .eq('id', data.categoryId)
      .maybeSingle();

    if (!category) return err('not_found', 'category');
    if (data.type !== 'transfer' && category.type !== data.type) {
      return err('conflict', 'category_type_mismatch',
        `That's an ${category.type} category. Pick an ${data.type} one.`);
    }
  }

  return ok(undefined);
}
```

Notice what only this layer can do: distinguish archived from missing, currency
mismatch from type mismatch, and produce a sentence naming the actual problem.
RLS's answer to all of these is the same `42501`.

Reaching `mapPostgresError`'s `42501` branch therefore means a re-check was
missed — which is why that branch logs at error level and alerts
([observability.md](observability.md#what-to-alert-on)). RLS catching something
the application should have caught is a bug report from the database.

## What is deliberately absent

- **No REST or GraphQL API of our own.** Server Actions and RSC queries are the
  interface. [system-architecture.md](system-architecture.md#non-goals).
- **No tRPC.** Server Actions already give end-to-end types without a router,
  a client, or a serialization layer to configure.
- **No ORM.** `supabase-js` plus generated types.
  [ADR-0002](../adr/0002-supabase-cli-migrations-as-schema-source-of-truth.md).
- **No `services/` or `repositories/` layer.** `queries/` and `actions/` are that
  layer. [source-structure.md](source-structure.md#what-is-deliberately-absent).
- **No client-side Supabase queries for application data.**
  `lib/server/supabase/browser.ts` exists for auth-state subscription only.
  Client queries mean money math on the client, RLS as the sole authorization
  check, and a second data-access path.
- **No API versioning.** There are no external consumers. When there are, that is
  an ADR.
- **No rate limiting in the MVP.** Supabase Auth rate-limits the endpoints that
  matter (sign-up, password reset). The `rate_limited` envelope variant exists so
  adding it later needs no client change. Tracked in
  [M8](../../tasks/backlog/m9-mvp-hardening-and-launch.md).
- **No soft-delete API semantics.** `is_archived` on accounts and categories;
  everything else is a real delete.
  [data-model.md](data-model.md#what-is-deliberately-absent).
- **No idempotency keys yet.** Optimistic UI plus `revalidateTag` makes a double
  submit visible immediately, and the unique constraints catch the cases that
  matter. Revisit if duplicate transactions appear in practice.
