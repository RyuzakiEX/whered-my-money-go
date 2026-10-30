# RLS tests

pgTAP tests that prove **absence** of access: a policy can be wide open while
every feature still works, so these tests attack each table as another user and
as `anon`. Rationale and the policy matrix:
[docs/architecture/rls-policies.md](../../../docs/architecture/rls-policies.md#testing-strategy).

```bash
npm run test:rls           # this suite only (local Supabase must be running)
npm run test:integration   # Vitest integration suite, then this suite
```

Both run `supabase test db --local`. The CLI installs pgTAP for the run and
removes it afterwards, so no migration ships a test-only extension to hosted
databases. `--local` is explicit because this repository is linked to the
preview project: these tests create users and must never run there.

## How a test file is built

Every `*.sql` file here is run as a pgTAP test. Each one wraps itself in a
transaction and includes the harness, so all fixtures roll back and no file
depends on another:

```sql
begin;
\ir helpers.psql
select plan(N);
-- assertions
select * from finish();
rollback;
```

[`helpers.psql`](helpers.psql) is `.psql`, not `.sql`, precisely so it is not
itself run as a test. It provides:

| Helper | What it does |
|---|---|
| `tests.user_a()`, `tests.user_b()` | Two users with fixed ids, inserted into `auth.users` — so each gets a profile from the real sign-up trigger |
| `tests.authenticate_as(uuid)` | Become `authenticated` with that user's JWT claims |
| `tests.authenticate_anon()` | Become `anon` |
| `tests.reset_role()` | Back to the test runner's role |
| `tests.assert_user_isolated(tbl, owner_column, insert_sql)` | The reusable isolation assertion — **9 tests** |

Run assertions as `authenticated` or `anon`, never as the owner: a suite that
runs as `postgres` passes whatever the policies say.

## Adding a table — copy, paste, fill in

Every new user-owned table gets one file. Seed **one row for each of the two
users** first: the assertion's first test fails on an empty table, because an
isolation test that passes on no data proves nothing.

```sql
-- supabase/tests/rls/accounts_test.sql
begin;
\ir helpers.psql

-- Fixtures, as the runner: one row per user.
insert into public.accounts (user_id, name, type, opening_balance_minor, currency)
values
  (tests.user_a(), 'A wallet', 'cash', 0, 'PHP'),
  (tests.user_b(), 'B wallet', 'cash', 0, 'PHP');

select plan(9);   -- + any table-specific assertions

select tests.assert_user_isolated(
  'accounts',
  'user_id',
  -- One valid row, with %L where the owner id goes.
  $$insert into public.accounts (user_id, name, type, opening_balance_minor, currency)
    values (%L, 'stolen', 'cash', 0, 'PHP')$$
);

select * from finish();
rollback;
```

The 9 assertions, as `user_b` against `user_a`'s rows: both users own rows
(sanity); rows invisible; no update or delete **with** a `where` naming them;
no update or delete **without any** `where`; no handing one's own rows to
`user_a`; no insert carrying `user_a`'s id; and `user_a`'s rows survive.

The unfiltered steps are not redundant. Postgres applies select policies to an
`update`/`delete` only when it reads columns, so a filtered statement is also
stopped by the select policy — and a filtered-only assertion passed against an
update policy of `using (true)` in M1-B03, while an unfiltered update rewrote
every row.

## What the generic assertion cannot catch

- **Cross-table ownership.** A row with the right `user_id` pointing at another
  user's account or category passes every check above. Each foreign key needs
  explicit insert **and** update cases —
  [rls-policies.md](../../../docs/architecture/rls-policies.md#cross-table-ownership-tests).
- **Table-specific denials**, such as `profiles` refusing even a user's own
  insert — add those to the table's file, as
  [`profiles_test.sql`](profiles_test.sql) does.

## Proving a test catches something

A new assertion is not trusted until it has failed. Weaken the policy on the
local database, run the suite, and confirm the right test goes red:

```bash
docker exec -i supabase_db_whered-my-money-go psql -U postgres -d postgres \
  -c "drop policy profiles_select_own on public.profiles;
      create policy profiles_select_own on public.profiles for select using (true);"
npm run test:rls        # expect: not ok … rows are invisible
npm run db:reset        # restore
```

Use `docker exec` into this project's database container rather than a `psql`
on your PATH, which may point at a different database.
