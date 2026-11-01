-- accounts: user isolation plus the account-specific rules (M2-B01, M2-B03).
begin;
\ir helpers.psql

-- Fixtures, as the runner: one row per user.
insert into public.accounts (user_id, name, type, opening_balance_minor, currency)
values
  (tests.user_a(), 'A wallet', 'cash', 0, 'PHP'),
  (tests.user_b(), 'B wallet', 'cash', 0, 'PHP');

select plan(21);

-- The reusable assertion: 9 tests. It covers user_b selecting, updating, and
-- deleting user_a's accounts (filtered and unfiltered), user_b inserting a row
-- carrying user_a's id, and user_b handing their own row to user_a.
select tests.assert_user_isolated(
  'accounts',
  'user_id',
  $$insert into public.accounts (user_id, name, type, opening_balance_minor, currency)
    values (%L, 'stolen', 'cash', 0, 'PHP')$$
);

-- The owner's own path works: a policy that denies everything also passes
-- every isolation test above.
select tests.authenticate_as(tests.user_a());
select lives_ok(
  $$ insert into public.accounts (user_id, name, type, currency)
     values (tests.user_a(), 'A bank', 'bank', 'PHP') $$,
  'accounts: a user can insert their own account'
);
update public.accounts set name = 'A bank, renamed'
  where user_id = tests.user_a() and name = 'A bank';
select is(
  (select count(*) from public.accounts where name = 'A bank, renamed'),
  1::bigint,
  'accounts: a user can update their own account'
);
delete from public.accounts where name = 'A bank, renamed';
select is(
  (select count(*) from public.accounts where name = 'A bank, renamed'),
  0::bigint,
  'accounts: a user can delete their own account'
);

-- An update moving user_id away, stated directly as M2-B03 requires. This
-- filtered form is ALSO stopped by the select policy (the new row must stay
-- visible to the caller), so it passes even with `with check (true)` —
-- verified by sabotage. The assertion's unfiltered step 7 above is the test
-- that isolates WITH CHECK; it failed under that sabotage.
select throws_ok(
  $$ update public.accounts set user_id = tests.user_b()
     where user_id = tests.user_a() $$,
  '42501', null,
  'accounts: an update moving user_id to another user fails the with check'
);

-- Anonymous: no rows, no writes.
select tests.authenticate_anon();
select is(
  (select count(*) from public.accounts), 0::bigint,
  'accounts: anon sees no rows'
);
select throws_ok(
  $$ insert into public.accounts (user_id, name, type, currency)
     values (tests.user_a(), 'anon', 'cash', 'PHP') $$,
  '42501', null,
  'accounts: anon cannot insert'
);
select tests.reset_role();

-- Structure: forced RLS, exactly the four documented policies.
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.accounts'::regclass),
  'accounts: row level security is forced'
);
select set_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.accounts'::regclass $$,
  array['accounts_select_own', 'accounts_insert_own',
        'accounts_update_own', 'accounts_delete_own'],
  'accounts: exactly the four *_own policies'
);

-- Structure: the closed enum, and the unit on the money column.
select enum_has_labels(
  'public', 'account_type',
  array['cash', 'bank', 'ewallet', 'credit_card', 'savings', 'other'],
  'account_type: exactly the six values, in order'
);
select matches(
  col_description('public.accounts'::regclass,
    (select attnum from pg_attribute
     where attrelid = 'public.accounts'::regclass and attname = 'opening_balance_minor')),
  'integer minor units',
  'accounts.opening_balance_minor: the column comment states its unit'
);

-- Structure: the indexes M2-B01 names. The unique one is what makes
-- "GCash" and "gcash" a conflict; both lead with user_id.
select has_index('public', 'accounts', 'accounts_unique_name',
  'accounts: the case-insensitive unique name index exists');
select has_index('public', 'accounts', 'accounts_user_archived_idx',
  'accounts: the (user_id, archived_at) index exists');

select * from finish();
rollback;
