# State and Caching

**Shape in one sentence:** the server owns the data, the URL owns the view, and
the browser owns almost nothing — so a mutation invalidates a named cache tag
and the next render is correct by construction rather than by remembering to
update three places.

Related: [system-architecture.md](system-architecture.md),
[api-and-data-access.md](api-and-data-access.md),
[frontend-architecture.md](frontend-architecture.md),
[source-structure.md](source-structure.md).

## Contents

- [Where state lives](#where-state-lives)
- [Cache tags](#cache-tags)
- [Invalidation matrix](#invalidation-matrix)
- [revalidateTag vs revalidatePath](#revalidatetag-vs-revalidatepath)
- [URL as view state](#url-as-view-state)
- [Optimistic UI](#optimistic-ui)
- [Why no global client store](#why-no-global-client-store)

## Where state lives

| Kind of state | Lives in | Example |
|---|---|---|
| **Domain data** | Postgres, read per-request through RLS | Transactions, balances, budgets |
| **Derived figures** | Computed in `lib/core` on the server, cached by tag | Safe to Spend, timeline, budget progress |
| **View state** | URL search params | Active filters, date range, timeline horizon, page cursor |
| **Ephemeral UI state** | Local `useState` in the owning Client Component | Dialog open, dropdown focus, form draft |
| **Session** | httpOnly cookie, refreshed by `middleware.ts` | Supabase JWT |
| **Per-viewer preference** | `localStorage`, read defensively | Collapsed sidebar, last-used account |

The ordering matters: **push state as far up this table as it will go.** Domain
data on the server cannot go stale in a tab left open for an hour; view state in
the URL survives a refresh and can be shared; local `useState` cannot do either.

## Cache tags

Every cached read is tagged. Tags are **constants**, defined once in
`lib/server/cache/tags.ts`, never inline string literals.

```typescript
// lib/server/cache/tags.ts

export const tags = {
  accounts:     (userId: string) => `user:${userId}:accounts`,
  transactions: (userId: string) => `user:${userId}:transactions`,
  categories:   (userId: string) => `user:${userId}:categories`,
  budgets:      (userId: string) => `user:${userId}:budgets`,
  goals:        (userId: string) => `user:${userId}:goals`,
  recurring:    (userId: string) => `user:${userId}:recurring`,
  dashboard:    (userId: string) => `user:${userId}:dashboard`,
  sts:          (userId: string) => `user:${userId}:sts`,
  timeline:     (userId: string) => `user:${userId}:timeline`,
  profile:      (userId: string) => `user:${userId}:profile`,
} as const;
```

Three rules, each with a reason:

1. **Always namespaced by `userId`.** A tag without it is a cross-tenant cache
   poisoning bug waiting to happen — one user's invalidation would clear (or
   worse, serve) another's data. This is the same defence-in-depth thinking as
   [RLS](rls-policies.md): the cache key must not be the only thing keeping
   users apart, but it must not be the thing that fails either.
2. **`userId` comes from the session**, never from a parameter. Same rule as
   everywhere else — see
   [../security/security-model.md](../security/security-model.md).
3. **Constants, not literals.** A typo in an inline `` `user:${id}:transaction` ``
   (singular) fails silently: the read caches under a tag nothing invalidates,
   and the user sees stale money until the deployment rolls. A typo in a
   function name is a compile error. That asymmetry is the whole argument.

### Derived tags

`dashboard`, `sts`, and `timeline` cache *computed* results, not table reads.
They are separate tags because they have different invalidation sets and very
different costs — recomputing the timeline means expanding recurrence rules
([recurrence.md](../domain/recurrence.md#the-occurrence-cap)), which is the
most expensive thing this app does per request.

## Invalidation matrix

The load-bearing table. Every mutation must invalidate every tag whose value it
could change — the failure mode is a user adding a transaction and watching
their Safe to Spend figure not move, which reads as a broken product.

| Mutation | `accounts` | `transactions` | `categories` | `budgets` | `goals` | `recurring` | `dashboard` | `sts` | `timeline` |
|---|---|---|---|---|---|---|---|---|---|
| Create / update / delete transaction | ● | ● | | ● | | | ● | ● | ● |
| Create transfer (two legs) | ● | ● | | | | | ● | ● | ● |
| Create / update account | ● | | | | | | ● | ● | ● |
| Archive / delete account | ● | ● | | | | ● | ● | ● | ● |
| Toggle `exclude_from_safe_to_spend` | ● | | | | | | ● | ● | ● |
| Create / update / delete category | | ● | ● | ● | | | ● | | |
| Create / update / delete budget | | | | ● | | | ● | | |
| Create / update / delete goal | | | | | ● | | ● | ● | |
| Add goal contribution | ● | ● | | | ● | | ● | ● | ● |
| Create / update / pause recurring | | | | | | ● | ● | ● | ● |
| Update profile (currency, timezone) | ● | ● | ● | ● | ● | ● | ● | ● | ● |

Five entries in that table are non-obvious enough to justify:

- **A transaction invalidates `budgets`** — not the budget rows themselves, but
  the *progress* computed against them. Spend changed, so
  `spent / limit` changed.
- **A transaction invalidates `accounts`** — balances are derived from
  transactions via the `account_balances` view
  ([data-model.md](data-model.md#derived-views)), so a new transaction changes a
  balance without touching an `accounts` row.
- **A goal contribution invalidates `accounts` and `transactions`** — a
  contribution may be linked to a real transaction moving money into savings.
- **A budget change does *not* invalidate `sts`.** Safe to Spend's
  `PlannedSavings` term comes from *goals*, not budgets
  ([safe-to-spend.md](../domain/safe-to-spend.md#plannedsavings)). Invalidating
  it here would be harmless but wasteful, and the wrong mental model to encode.
- **A profile change invalidates everything** — currency and timezone feed into
  every formatted amount and every calendar-date calculation.

Helper, so an action lists intent rather than plumbing:

```typescript
// lib/server/cache/revalidate.ts
export function revalidateForTransactionChange(userId: string): void {
  for (const tag of [
    tags.accounts(userId),
    tags.transactions(userId),
    tags.budgets(userId),
    tags.dashboard(userId),
    tags.sts(userId),
    tags.timeline(userId),
  ]) {
    revalidateTag(tag);
  }
}
```

Every Server Action calls exactly one of these named helpers. The matrix above
is the specification for what each one contains, and the helpers are unit-tested
against it — so the table cannot drift from the code without a test failing.

## revalidateTag vs revalidatePath

| Use | When |
|---|---|
| **`revalidateTag`** | Default. Data changed, and every page reading that data should refresh — regardless of which route the user was on. |
| `revalidatePath` | Only when a *route's* structure or metadata changed independently of data. Rare here. |

`revalidateTag` is preferred because the dependency runs the right way round: a
page declares which tags it reads, and a mutation declares which tags it
dirties. Neither needs to know the other's routes. With `revalidatePath` every
mutation would have to enumerate affected routes — and adding a new page that
shows Safe to Spend would silently start serving stale data until someone
remembered to add its path to five different actions.

## URL as view state

Filters, sorts, ranges, and cursors live in `searchParams`:

```text
/transactions?category=food&from=2026-09-01&to=2026-09-30&sort=amount_desc
/timeline?horizon=60&direction=out
/budget?period=2026-09
```

Four things this buys, none of which a `useState` filter provides:

- **Shareable and bookmarkable.** "Look at my September food spending" is a link.
- **Back and forward work.** Changing a filter is navigation, and the browser
  already knows how to undo navigation.
- **Survives refresh** and restores on reopen.
- **Server-readable.** Server Components receive `searchParams` directly, so the
  filtered query runs on the server against RLS-scoped data — no client-side
  refetch, no filtering of an over-fetched payload in the browser.

Conventions: short lowercase keys; ISO dates (`from`, `to`); omit defaults
entirely so a clean view has a clean URL; validate with Zod on read and fall
back to the default rather than throwing on a hand-edited URL (a user typing
`?horizon=999` should get 30 days, not an error page).

## Optimistic UI

Used where latency is visible and the outcome is near-certain: adding a
transaction, toggling a filter chip, adding a goal contribution.

```text
1. Apply the change locally (useOptimistic)
2. Call the Server Action
3. Success → server revalidation replaces the optimistic value with the truth
4. Failure → roll back, surface the error, keep the user's input
```

Three rules:

- **Never optimistically render a money total the server computes.** Show the
  new transaction row optimistically; do **not** optimistically adjust Safe to
  Spend or a budget bar. The client cannot compute those correctly —
  `lib/core` is server-side by design, and dedupe, horizons, and exclusion flags
  make a naive client-side guess wrong in ways the user would notice. A brief
  skeleton on the derived figure is honest; a wrong number is not.
- **Rollback must preserve input.** A failed submission returns the user to
  their filled-in form, never to an empty one. Losing typed data to a network
  blip is the fastest way to lose trust.
- **Deletes confirm, not optimise.** An undo toast (task `M3-F04`) beats an
  optimistic delete: it is reversible from the user's side and needs no
  reconciliation.

## Why no global client store

No Redux, Zustand, Jotai, or React Query. The reasons are specific rather than
ideological:

- **There is no client-side source of truth to synchronise.** Server Components
  read fresh, RLS-scoped data per request. A client cache would be a second copy
  of the data whose only job is to become stale.
- **Two caches is one too many.** Next's tag-based cache plus a client cache
  means two invalidation stories, and the interesting bugs live in the gap
  between them.
- **Money must not be recomputed on the client.** A store encourages deriving
  totals client-side from cached rows — which is exactly the boundary
  [source-structure.md](source-structure.md) forbids.
- **The state that is genuinely client-owned is tiny** and belongs to one
  component: is this dialog open, what has the user typed.

**When to revisit.** Add one only when something genuinely client-owned needs
sharing across distant components and cannot live in the URL — a multi-step
wizard spanning routes, or offline draft queueing for a PWA (`V3-M27`). That
change gets an ADR ([../adr/](../adr/)) recording what the URL and the server
could not do.
