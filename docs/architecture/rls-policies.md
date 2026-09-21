# Row Level Security Policies

> [!IMPORTANT]
> **PLANNED — no policies exist yet.** Each table's policies land in the same
> migration as the table itself ([data-model.md](data-model.md#migration-ordering)),
> never in a follow-up. This document is the design those migrations implement.

**Shape in one sentence:** every user table has RLS enabled with no permissive
default, one narrowly-named policy per operation, and any policy touching a
foreign key re-validates that the referenced row also belongs to `auth.uid()` —
because the obvious `user_id = auth.uid()` check does not stop a user from
attaching their data to someone else's account.

Spec §24 states the requirement: "RLS policies should prevent users from
accessing another user's data. Every financial record must belong to a user."
This is how. RLS is trust boundary **B2** in
[system-architecture.md](system-architecture.md#trust-boundaries) and the last
line of defence — if it fails, cross-tenant financial data leaks, which is the
worst outcome this product has.

Related: [../security/security-model.md](../security/security-model.md) for the
overall threat model, [api-and-data-access.md](api-and-data-access.md) for the
application-layer checks that sit in front of these policies, and
[data-model.md](data-model.md) for the tables being protected.

## Contents

- [The rule](#the-rule)
- [Naming convention](#naming-convention)
- [Policy matrix](#policy-matrix)
- [Cross-table ownership](#cross-table-ownership)
- [`security definer` functions](#security-definer-functions)
- [Profile creation](#profile-creation)
- [Views and RLS](#views-and-rls)
- [Testing strategy](#testing-strategy)
- [CI enforcement](#ci-enforcement)
- [What is deliberately absent](#what-is-deliberately-absent)

## The rule

**No table ships without RLS enabled and an explicit policy per permitted
operation.**

Postgres RLS is default-deny once enabled: with `enable row level security` and
zero policies, every query returns zero rows and every write fails. That is the
correct starting state, and every policy from there is a deliberate, reviewable
grant.

```sql
-- Both lines, on every user table, in the table's own migration.
alter table public.transactions enable row level security;
alter table public.transactions force row level security;
```

`force row level security` is the line people skip. Without it, the **table
owner** bypasses RLS entirely. The migration role owns these tables, so any
future function or job running as the owner silently sees everything. `force`
closes that, and costs nothing.

Three consequences of default-deny worth internalising:

- **A missing policy is a broken feature, not a security hole.** Failure mode is
  "nothing loads", which surfaces in the first test. The inverse design — allow
  by default, deny by exception — fails silently and in the wrong direction.
- **`select` and `insert` are separate grants.** A user may be able to insert a
  row they then cannot read. That combination is almost always a bug; the matrix
  below makes it visible.
- **Adding a column never needs a policy change.** Policies are row filters, not
  column filters. Column-level restriction is a `grant` concern, and we do not
  use it — see [What is deliberately absent](#what-is-deliberately-absent).

## Naming convention

```text
<table>_<op>_own
```

Examples: `transactions_select_own`, `budgets_insert_own`, `goals_delete_own`,
`audit_log_insert_own`.

| Rule | Reason |
|---|---|
| One policy per table per operation | `pg_policies` becomes a readable inventory. Two policies on the same operation are OR'd together, so a second permissive policy silently *widens* access — the opposite of what the person adding it usually intends |
| Never `for all` | It expands to four operations at once. Reviewing "may this user delete this?" then requires reasoning about a policy written for reading. Explicit `for select` / `for insert` / `for update` / `for delete` keeps each grant one sentence long |
| Suffix `_own` is literal | It reads as an assertion at the call site of a code review: `transactions_select_own` claims the row is the caller's. A policy that does not enforce that claim is a name mismatch a reviewer can catch |
| `to authenticated` on every policy | Never `to public`. `public` includes the `anon` role. An anonymous request should never match a policy at all |

## Policy matrix

Every policy below is `to authenticated`. `auth.uid()` is Supabase's
`current_setting('request.jwt.claims')::json->>'sub'`, wrapped — it returns the
authenticated user's id and `null` for anonymous requests, so `user_id =
auth.uid()` is false rather than an error when unauthenticated.

> [!NOTE]
> Wrap `auth.uid()` as `(select auth.uid())` inside policy predicates. Postgres
> then evaluates it once per query as an `InitPlan` instead of once per row.
> On a 5,000-row transaction scan this is the difference between an index scan
> and a per-row function call, and it is the single most common Supabase RLS
> performance mistake. Every predicate below uses the wrapped form.

### `profiles`

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `id = (select auth.uid())` | — |
| `insert` | **no policy** | — | — |
| `update` | yes | `id = (select auth.uid())` | `id = (select auth.uid())` |
| `delete` | **no policy** | — | — |

```sql
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));
```

No insert policy: profiles are created only by the `on auth.users` trigger
([Profile creation](#profile-creation)). If application code could insert a
profile, it could insert one with a mismatched id or a duplicate, and there is
no product reason to allow it.

No delete policy: account deletion goes through Supabase Auth, and the
`on delete cascade` from `auth.users` removes the profile. A user deleting their
profile row while their auth user survives leaves an unusable account.

Both `using` and `with check` on update, with identical predicates. Omitting
`with check` is the classic RLS mistake on updates: `using` gates *which rows
you may target*, `with check` gates *what the row looks like afterwards*. With
only `using`, a user could `update profiles set id = <someone else's uuid>` —
they may target their own row, and nothing validates the result. Every update
policy in this document carries both.

### `accounts`

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `user_id = (select auth.uid())` | — |
| `insert` | yes | — | `user_id = (select auth.uid())` |
| `update` | yes | `user_id = (select auth.uid())` | `user_id = (select auth.uid())` |
| `delete` | yes | `user_id = (select auth.uid())` | — |

```sql
create policy accounts_select_own on public.accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy accounts_insert_own on public.accounts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy accounts_update_own on public.accounts
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy accounts_delete_own on public.accounts
  for delete to authenticated
  using (user_id = (select auth.uid()));
```

`accounts` has no foreign key to another user table, so a plain `user_id` check
is sufficient here. That is *not* true of most tables below.

### `categories`

Identical shape to `accounts` — no outbound FK to a user-owned table.

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `user_id = (select auth.uid())` | — |
| `insert` | yes | — | `user_id = (select auth.uid())` |
| `update` | yes | `user_id = (select auth.uid())` | `user_id = (select auth.uid())` |
| `delete` | yes | `user_id = (select auth.uid())` | — |

### `transactions`

**This is the table where a plain `user_id` predicate is not enough.** Full
reasoning in [Cross-table ownership](#cross-table-ownership).

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `user_id = (select auth.uid())` | — |
| `insert` | yes | — | `user_id = (select auth.uid())` **AND** `account_id` owned **AND** `category_id` owned-or-null |
| `update` | yes | `user_id = (select auth.uid())` | same three conditions as insert |
| `delete` | yes | `user_id = (select auth.uid())` | — |

```sql
create policy transactions_select_own on public.transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = account_id
        and a.user_id = (select auth.uid())
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id
          and c.user_id = (select auth.uid())
      )
    )
  );

create policy transactions_update_own on public.transactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = account_id
        and a.user_id = (select auth.uid())
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id
          and c.user_id = (select auth.uid())
      )
    )
  );

create policy transactions_delete_own on public.transactions
  for delete to authenticated
  using (user_id = (select auth.uid()));
```

The `update` policy repeats the whole `with check`. Without it, a user could
create a legitimate transaction and then `update` it to point at another user's
`account_id` — the insert was guarded, the update was not, and the end state is
identical to the attack the insert policy blocked. Guarding insert but not
update is a half-fix that reads as a complete one.

The `exists` subqueries are on `(user_id, id)`-indexed lookups against tables
the user can already read. They add a nested loop over one row per insert. The
cost is not measurable; the exposure without them is total.

### `budgets`

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `user_id = (select auth.uid())` | — |
| `insert` | yes | — | `user_id = (select auth.uid())` **AND** `category_id` owned |
| `update` | yes | `user_id = (select auth.uid())` | same |
| `delete` | yes | `user_id = (select auth.uid())` | — |

```sql
create policy budgets_insert_own on public.budgets
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.categories c
      where c.id = category_id
        and c.user_id = (select auth.uid())
    )
  );
```

`category_id` is `not null` on `budgets`, so no null branch. Note what RLS does
*not* enforce here: that the category is `type = 'expense'`. That is a product
invariant, enforced by trigger
([data-model.md](data-model.md#constraints-summary)). RLS answers "whose row is
this?"; it is the wrong tool for "does this row make product sense?"

### `goals`

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `user_id = (select auth.uid())` | — |
| `insert` | yes | — | `user_id = (select auth.uid())` **AND** `account_id` owned-or-null |
| `update` | yes | `user_id = (select auth.uid())` | same |
| `delete` | yes | `user_id = (select auth.uid())` | — |

`goals.account_id` is nullable, so the null branch applies — same shape as
`transactions.category_id`. It is easy to miss because the column is optional
and usually empty; an optional FK is exactly as exploitable as a required one.

### `goal_contributions`

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `user_id = (select auth.uid())` | — |
| `insert` | yes | — | `user_id = (select auth.uid())` **AND** `goal_id` owned **AND** `transaction_id` owned-or-null |
| `update` | yes | `user_id = (select auth.uid())` | same |
| `delete` | yes | `user_id = (select auth.uid())` | — |

```sql
create policy goal_contributions_insert_own on public.goal_contributions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.goals g
      where g.id = goal_id
        and g.user_id = (select auth.uid())
    )
    and (
      transaction_id is null
      or exists (
        select 1 from public.transactions t
        where t.id = transaction_id
          and t.user_id = (select auth.uid())
      )
    )
  );
```

Two foreign keys, two checks. `goal_contributions` carries a denormalized
`user_id` ([data-model.md](data-model.md#goal_contributions)) specifically so the
`select` predicate stays a single indexed column — but the denormalization does
nothing for the write path, which still has to validate both references.

### `recurring_transactions`

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `user_id = (select auth.uid())` | — |
| `insert` | yes | — | `user_id = (select auth.uid())` **AND** `account_id` owned **AND** `category_id` owned-or-null |
| `update` | yes | `user_id = (select auth.uid())` | same |
| `delete` | yes | `user_id = (select auth.uid())` | — |

Same shape as `transactions`. The table ships empty in M2 with policies already
in place, so V2's recurring-transaction work is UI and actions with no security
review of new policies.

### `audit_log`

The one table with an asymmetric policy set.

| Op | Allowed | `USING` | `WITH CHECK` |
|---|---|---|---|
| `select` | yes | `user_id = (select auth.uid())` | — |
| `insert` | yes | — | `user_id = (select auth.uid())` |
| `update` | **no policy** | — | — |
| `delete` | **no policy** | — | — |

```sql
create policy audit_log_select_own on public.audit_log
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy audit_log_insert_own on public.audit_log
  for insert to authenticated
  with check (user_id = (select auth.uid()));
-- Deliberately no update or delete policy. Append-only.
```

An audit log a user can edit is not an audit log. With RLS enabled and no
`update`/`delete` policy, those operations are impossible for `authenticated` —
including for the application itself, which is the point. Retention pruning,
when it exists, runs as an allowlisted maintenance job, not from a request path.

### Summary

| Table | select | insert | update | delete | Cross-table checks on write |
|---|---|---|---|---|---|
| `profiles` | own | — | own | — | none |
| `accounts` | own | own | own | own | none |
| `categories` | own | own | own | own | none |
| `transactions` | own | own | own | own | `account_id`, `category_id?` |
| `budgets` | own | own | own | own | `category_id` |
| `goals` | own | own | own | own | `account_id?` |
| `goal_contributions` | own | own | own | own | `goal_id`, `transaction_id?` |
| `recurring_transactions` | own | own | own | own | `account_id`, `category_id?` |
| `audit_log` | own | own | **denied** | **denied** | none |

`?` marks a nullable foreign key, which needs the `is null or exists (...)`
branch. Five of the nine tables need cross-table checks. That ratio is why the
next section exists.

## Cross-table ownership

**This is the section that matters most.** The naive policy is the one almost
every Supabase tutorial shows, and it is insufficient for any table with a
foreign key to another user-owned table.

### The vulnerable policy

```sql
-- INSUFFICIENT. Do not ship this.
create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check (user_id = (select auth.uid()));
```

It reads as complete. `user_id` must be the caller's, so a user can only create
their own transactions. And that is true — as far as it goes.

### The attack

Attacker is user A. Victim is user B. A knows or guesses one of B's
`account_id` values — a UUID, so not guessable at random, but UUIDs leak
constantly: a shared screenshot, a URL, a support ticket, a CSV export, a
`select` on a table whose policy someone got wrong once. Assume it is known.

```sql
-- Executed by user A, with A's own valid JWT.
insert into transactions
  (user_id, account_id, amount_minor, currency, type, occurred_on)
values
  ('<A's uuid>',            -- ✅ passes with check (user_id = auth.uid())
   '<B's account uuid>',    -- ❌ nothing checks this
   99999999, 'PHP', 'expense', current_date);
```

The insert succeeds. The `with check` predicate is satisfied: `user_id` really
is A's.

What A has just done:

| Consequence | Why |
|---|---|
| Corrupted B's balance | `account_balances` sums transaction legs by `account_id`. A's row is now part of B's balance computation |
| Corrupted B's Safe to Spend | Which reads from the balance |
| Corrupted B's dashboard and reports | Same source |
| Made it invisible to B | B's `transactions_select_own` filters `user_id = auth.uid()`. The row is A's, so **B cannot see the transaction that is breaking their numbers** |
| Made it invisible to support | The same filter applies to any per-user query |

That last pair is what makes this severe rather than merely wrong. It is a write
primitive into another tenant's derived financial data, with no read path for the
victim to discover it. A user watching their balance drift with no matching
transaction is the exact failure that destroys trust in a budgeting app — and
here it is adversarial, not a bug.

The same shape applies to every foreign key: `budgets.category_id` (a budget
attached to B's category), `goal_contributions.goal_id` (contributions inflating
B's goal progress), `goals.account_id`, `recurring_transactions.account_id`.

### The correct policy

```sql
-- CORRECT. Ownership of the row AND of everything it references.
create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = account_id
        and a.user_id = (select auth.uid())
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id
          and c.user_id = (select auth.uid())
      )
    )
  );
```

### Side by side

| | Vulnerable | Correct |
|---|---|---|
| Predicate | `user_id = auth.uid()` | `user_id = auth.uid()` **and** every FK's owner is `auth.uid()` |
| A inserts with A's `user_id` | allowed | allowed |
| A inserts pointing at B's `account_id` | **allowed** | rejected |
| A updates their row to B's `account_id` | **allowed** | rejected (update carries the same `with check`) |
| A sets `category_id` to B's category | **allowed** | rejected |
| Visible to B | no | n/a |
| Extra cost | — | one indexed single-row `exists` per FK per write |

### The rule to apply mechanically

> **Every nullable or non-nullable foreign key pointing at a user-owned table
> requires an `EXISTS` ownership check in that table's `insert` and `update`
> `WITH CHECK` predicates.** No exceptions for optional columns.

Three failure modes to watch for in review, in order of how often they occur:

1. **Insert guarded, update not.** The update policy needs the identical
   `with check`. A `using`-only update policy is the same vulnerability with an
   extra step.
2. **Nullable FK skipped.** `goals.account_id` and `transactions.category_id`
   are usually null, so the missing branch is invisible in testing. Optional
   does not mean safe.
3. **Relying on the Server Action instead.** The action's ownership re-check
   ([system-architecture.md](system-architecture.md#write), step 3) is real
   defence in depth and it should stay. But it protects one code path. RLS
   protects the database — including a future cron job, a `supabase-js` call
   from a place nobody expected, a PostgREST request made directly with a user's
   JWT, and the next person who writes an action and forgets the check. The
   application check is the fast, friendly rejection with a good error message;
   RLS is the one that is actually load-bearing.

## `security definer` functions

**Forbidden by default.** A `security definer` function runs with its creator's
privileges — the migration role — which owns every table and, combined with
Postgres's owner bypass, sees every row. It is a deliberate hole in the model
described above.

`security invoker` is the default and the correct choice for essentially
everything: the function sees exactly what the caller sees, RLS applies
normally.

Two functions in the schema need `security definer`, both justified:

| Function | Why it must be `definer` |
|---|---|
| `handle_new_user()` | Triggered on `auth.users` insert. It writes to `public.profiles` and `public.categories` at a moment when there is no authenticated session — `auth.uid()` is null during sign-up, so no `invoker` policy could match |
| `prune_audit_log()` (V2) | Deletes from a table with no `delete` policy, by design |

Adding a third requires an explicit review, a comment in the migration
explaining why RLS cannot express the requirement, and a `CODEOWNERS`-flagged
change. "It was easier" is not a reason; a policy that is hard to write usually
means the data model is wrong.

### The `search_path` attack

Any `security definer` function **must** set an empty search path:

```sql
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''        -- ← not optional
as $$ ... $$;
```

Without it, the function resolves unqualified names using the *caller's*
`search_path`. An attacker who can create objects in any schema on that path —
and on a default Supabase project, `public` is writable by more roles than
people expect — can shadow a function or table the definer function calls:

```sql
-- Attacker, in a schema that precedes public on the caller's search_path:
create function evil.now() returns timestamptz language sql as $$
  -- Anything here executes with the DEFINER's privileges, which own
  -- every table and bypass every policy.
  select now();
$$;

set search_path = evil, public;
-- Then trigger the definer function. Its unqualified now() resolves to evil.now().
```

The definer function then executes attacker-controlled SQL as the table owner:
full read and write across every tenant. This is the standard Postgres privilege
escalation, and it is the reason `set search_path = ''` exists.

With an empty search path, every reference must be schema-qualified —
`public.profiles`, `public.gen_random_uuid()`, `pg_catalog.now()`. That is
verbose, and the verbosity is the safety: there is no name left for an attacker
to shadow.

Rules, all three required together:

1. `security definer` requires a written justification in the migration.
2. `set search_path = ''` on every `security definer` function, with no
   exceptions.
3. Schema-qualify every identifier inside it. A single unqualified name defeats
   rule 2.

The `set_updated_at()` trigger function is `security invoker`. It modifies
`new`, touches no table, and needs no privilege. Marking it `definer` "to be
safe" would be exactly backwards.

## Profile creation

Profiles are created by a trigger on `auth.users`, never by application code.

```sql
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, currency, timezone)
  values (new.id, 'PHP', 'Asia/Manila');

  insert into public.categories (user_id, name, type, color, is_default)
  select new.id, d.name, d.type, d.color, true
  from public.default_categories d;   -- spec §7 defaults

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

Why a trigger rather than a Server Action after sign-up:

- **It cannot be skipped.** OAuth callback, email sign-up, a magic link, an admin
  creating a user in the Supabase dashboard, a seed script — every path inserts
  into `auth.users`, so every path gets a profile. An application-side create
  covers only the paths someone remembered.
- **It is atomic with user creation.** No window in which an authenticated user
  has no profile, and therefore no defensive `if (!profile)` branch in every
  page.
- **It removes the need for a `profiles` insert policy.** Fewer grants.

The cost is that it must be `security definer` (there is no session yet) and it
therefore carries the full `search_path` discipline above. That is the price of
the guarantee, paid once, in a migration reviewed on its own
([data-model.md](data-model.md#migration-ordering), `0004` and `0007`).

## Views and RLS

`account_balances` and `goal_progress` are views over RLS-protected tables. A
view created normally runs with its **owner's** privileges, so it bypasses the
policies on its underlying tables — a view is a fully-functional RLS bypass if
you forget one option:

```sql
create view public.account_balances
  with (security_invoker = true)   -- ← without this, the view leaks everything
as select ...;
```

`security_invoker = true` makes the view execute as the caller, so
`accounts_select_own` and `transactions_select_own` apply to its underlying
scans and the view needs no policies of its own.

This is checked in CI alongside the RLS check — a view without
`security_invoker` fails the build. It is a one-line omission with total
blast radius, which makes it exactly the kind of thing to automate rather than
remember.

## Testing strategy

RLS is the control whose failure is worst and whose correctness is least visible
in normal use — a policy can be wide open and every feature still works
perfectly. It therefore gets tests that assert *absence* of access, not presence.

Location: `supabase/tests/rls/`, run with pgTAP against a local Supabase
([source-structure.md](source-structure.md#the-tree)).

### Fixture: two seeded users

```sql
-- supabase/tests/rls/00-fixtures.sql
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.local');
-- The on_auth_user_created trigger gives each a profile and default categories.

-- Each user gets one row in every table, so every cross-user assertion has
-- something real to fail against. A test that passes because the table is
-- empty is worse than no test.
```

Impersonation helper — this is the mechanism the whole suite rests on:

```sql
create or replace function tests.authenticate_as(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;
```

Tests run as `authenticated`, never as the migration role or `postgres`. A suite
that runs as the owner passes regardless of what the policies say — the single
most common way an RLS test suite becomes theatre.

### The reusable assertion

One function, applied to every table. New table, one line of test.

```sql
-- supabase/tests/rls/01-isolation.sql
create or replace function tests.assert_user_isolated(
  tbl        text,
  owner_id   uuid,
  intruder_id uuid
) returns setof text language plpgsql as $$
declare
  visible bigint;
begin
  -- 1. The owner can see their own row.
  perform tests.authenticate_as(owner_id);
  execute format('select count(*) from public.%I', tbl) into visible;
  return next ok(visible > 0,
    tbl || ': owner sees their own rows (fixture sanity)');

  -- 2. The intruder sees ZERO of the owner's rows.
  perform tests.authenticate_as(intruder_id);
  execute format(
    'select count(*) from public.%I where user_id = %L', tbl, owner_id
  ) into visible;
  return next is(visible, 0::bigint,
    tbl || ': cross-user select returns 0 rows');

  -- 3. The intruder cannot write a row owned by the owner.
  return next throws_ok(
    format('insert into public.%I (user_id) values (%L)', tbl, owner_id),
    '42501',
    'new row violates row-level security policy',
    tbl || ': cross-user insert is rejected'
  );

  -- 4. The intruder cannot update or delete the owner's rows.
  --    Note: RLS makes these no-ops, not errors — the rows are simply
  --    invisible. Assert ZERO ROWS AFFECTED, not an exception. Expecting a
  --    raised error here is the mistake that makes this test always pass.
  execute format(
    'update public.%I set updated_at = now() where user_id = %L', tbl, owner_id
  );
  return next is(
    (select count(*) from tests.rows_affected()), 0::bigint,
    tbl || ': cross-user update affects 0 rows'
  );

  execute format('delete from public.%I where user_id = %L', tbl, owner_id);
  return next is(
    (select count(*) from tests.rows_affected()), 0::bigint,
    tbl || ': cross-user delete affects 0 rows'
  );
end;
$$;
```

Step 4's comment is the trap worth calling out. `update` and `delete` under RLS
do not raise — the target rows are filtered out by `using`, so the statement
succeeds having changed nothing. A test written as `throws_ok` for those
operations passes when the policy is correct *and* when it is missing entirely.
Assert the row count.

Applied to every table:

```sql
select plan(45);

select tests.assert_user_isolated('accounts',               alice, bob);
select tests.assert_user_isolated('categories',             alice, bob);
select tests.assert_user_isolated('transactions',           alice, bob);
select tests.assert_user_isolated('budgets',                alice, bob);
select tests.assert_user_isolated('goals',                  alice, bob);
select tests.assert_user_isolated('goal_contributions',     alice, bob);
select tests.assert_user_isolated('recurring_transactions', alice, bob);
-- profiles and audit_log use variants: different id column, denied ops.

select * from finish();
```

### Cross-table ownership tests

The generic assertion cannot catch the
[cross-table](#cross-table-ownership) vulnerability — the malicious insert has a
*correct* `user_id`. These need explicit cases, one per foreign key:

```sql
-- supabase/tests/rls/02-cross-table-ownership.sql
select tests.authenticate_as(alice);

select throws_ok($$
  insert into public.transactions
    (user_id, account_id, amount_minor, currency, type, occurred_on)
  values
    (tests.alice(), tests.bob_account(), 1000, 'PHP', 'expense', current_date)
$$, '42501', null,
  'transactions: cannot attach own transaction to another user''s account');

select throws_ok($$
  insert into public.transactions
    (user_id, account_id, category_id, amount_minor, currency, type, occurred_on)
  values
    (tests.alice(), tests.alice_account(), tests.bob_category(),
     1000, 'PHP', 'expense', current_date)
$$, '42501', null,
  'transactions: cannot use another user''s category');

-- And the update variant, which is the half people forget:
select throws_ok($$
  update public.transactions
     set account_id = tests.bob_account()
   where id = tests.alice_transaction()
$$, '42501', null,
  'transactions: cannot re-point own transaction at another user''s account');

select throws_ok($$
  insert into public.budgets
    (user_id, category_id, amount_minor, currency, period, period_start)
  values
    (tests.alice(), tests.bob_category(), 500000, 'PHP', 'monthly',
     date_trunc('month', current_date))
$$, '42501', null,
  'budgets: cannot budget against another user''s category');

select throws_ok($$
  insert into public.goal_contributions
    (user_id, goal_id, amount_minor, currency, occurred_on)
  values
    (tests.alice(), tests.bob_goal(), 100000, 'PHP', current_date)
$$, '42501', null,
  'goal_contributions: cannot contribute to another user''s goal');
```

One test per foreign key per operation, and the update variant is mandatory. The
checklist is mechanical: read the FK column list in
[data-model.md](data-model.md), write two tests per column.

### Additional cases

| Test | Asserts |
|---|---|
| Anonymous access | With no JWT, every table returns 0 rows and every write fails. `to authenticated` should mean `anon` matches no policy at all |
| View isolation | `account_balances` and `goal_progress` return only the caller's rows. Directly catches a missing `security_invoker` |
| `audit_log` immutability | `update` and `delete` are rejected for the row's own owner |
| `profiles` insert denial | Even a user's own id cannot be inserted from a session |
| `force row level security` | Present on every table — queried from `pg_class.relforcerowsecurity` |
| `search_path` hygiene | Every `security definer` function in `pg_proc` has `search_path=` in its `proconfig`. Cheap, catches the worst mistake in the document |

## CI enforcement

Tests catch a policy that is wrong. This catches a table that has **no** policy —
the more likely mistake, because the developer who forgot RLS also forgot the
test.

The check is a SQL assertion run against the migrated database on every PR
([../../workflow/08-ci-gates.md](../../workflow/08-ci-gates.md)). It fails the build if
any of four conditions holds:

```sql
-- .github/workflows checks — any row returned fails the build.

-- 1. A public table without RLS enabled.
select 'RLS NOT ENABLED: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
  and c.relname not in ('default_categories')   -- explicit, reviewed allowlist

union all

-- 2. RLS enabled but not FORCEd (owner bypass still open).
select 'RLS NOT FORCED: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not c.relforcerowsecurity

union all

-- 3. RLS enabled with zero policies — an accidentally sealed table.
select 'RLS ENABLED BUT NO POLICIES: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname)

union all

-- 4. A security definer function without a pinned search_path.
select 'SECURITY DEFINER WITHOUT search_path: ' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (p.proconfig is null
       or not exists (select 1 from unnest(p.proconfig) cfg
                      where cfg like 'search_path=%'));
```

Plus a fifth check in the same job: every view in `public` has
`security_invoker = true` in its `reloptions`.

Design notes on this check, because how it fails matters:

- **The allowlist is in the check, not in a config file.** Adding a table to it
  is a diff in a security-relevant file, which `CODEOWNERS` flags. A config file
  becomes a place things get added quietly.
- **Condition 3 exists because default-deny is only safe if intentional.** A
  table with RLS and no policies is invisible to the whole application; better
  to fail CI than to spend an afternoon debugging empty result sets.
- **The check runs on the migrated schema, not by parsing SQL.** Grepping
  migrations for `enable row level security` is defeated by a later migration
  that creates a table, by a rename, or by a table created inside a function.
  Asking the database is the only answer that cannot drift.

## What is deliberately absent

- **No column-level security (`grant`s on specific columns).** RLS filters rows;
  the application filters columns via explicit allowlists in queries
  ([api-and-data-access.md](api-and-data-access.md)). Column grants would
  duplicate that in a second place with different syntax and no tests.
- **No `for all` policies.** See [Naming convention](#naming-convention).
- **No role hierarchy.** Two roles exist: `anon` (matches nothing) and
  `authenticated` (owns its rows). No admin role, no support role — a support
  tool that can read user financial data is a whole security design of its own,
  and the MVP does not have one. When it is needed, it gets an ADR.
- **No policies referencing JWT custom claims.** `auth.uid()` only. Custom
  claims are set at token issue time and go stale; a policy that trusts a stale
  claim is a policy that grants access after it should have been revoked.
- **No multi-tenant sharing.** Shared household budgets (spec §28) require a
  membership table and a rewrite of every predicate here — flagged in
  [system-architecture.md](system-architecture.md#non-goals) as the largest
  architectural change on the roadmap, and it will need its own ADR and its own
  full pgTAP suite before a single policy changes.
- **No reliance on the application layer alone.** The Server Action ownership
  re-checks are defence in depth and they stay
  ([system-architecture.md](system-architecture.md#write)). They are not a
  substitute for any policy in this document.
