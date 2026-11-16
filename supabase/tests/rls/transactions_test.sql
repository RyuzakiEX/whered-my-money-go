-- transactions: user isolation, CROSS-TABLE OWNERSHIP, and the ledger's own
-- invariants (M3-B03, M3-B04).
begin;
\ir helpers.psql

-- Fixed ids, so an insert attempted AS user_b can name user_a's rows without
-- reading them (which RLS would prevent).
create function tests.account_a() returns uuid language sql immutable
  as $$ select 'a0000000-0000-4000-8000-0000000000a1'::uuid $$;
create function tests.account_b() returns uuid language sql immutable
  as $$ select 'b0000000-0000-4000-8000-0000000000b1'::uuid $$;
create function tests.expense_category_a() returns uuid language sql immutable
  as $$ select 'a0000000-0000-4000-8000-0000000000a2'::uuid $$;
create function tests.income_category_a() returns uuid language sql immutable
  as $$ select 'a0000000-0000-4000-8000-0000000000a3'::uuid $$;
create function tests.expense_category_b() returns uuid language sql immutable
  as $$ select 'b0000000-0000-4000-8000-0000000000b2'::uuid $$;
create function tests.transaction_b() returns uuid language sql immutable
  as $$ select 'b0000000-0000-4000-8000-0000000000b4'::uuid $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Fixtures, as the runner.
insert into public.accounts (id, user_id, name, type, currency)
values
  (tests.account_a(), tests.user_a(), 'A wallet', 'cash', 'PHP'),
  (tests.account_b(), tests.user_b(), 'B wallet', 'cash', 'PHP');
insert into public.categories (id, user_id, name, type, icon)
values
  (tests.expense_category_a(), tests.user_a(), 'A test expense', 'expense', 'tag'),
  (tests.income_category_a(), tests.user_a(), 'A test income', 'income', 'tag'),
  (tests.expense_category_b(), tests.user_b(), 'B test expense', 'expense', 'tag');
insert into public.transactions
  (id, user_id, account_id, category_id, amount_minor, currency, type, occurred_on)
values
  (gen_random_uuid(), tests.user_a(), tests.account_a(), tests.expense_category_a(),
   45000, 'PHP', 'expense', '2026-11-16'),
  (tests.transaction_b(), tests.user_b(), tests.account_b(), tests.expense_category_b(),
   12500, 'PHP', 'expense', '2026-11-16');

select plan(45);

-- The reusable assertion: 9 tests. Its insert carries user_a's id with
-- user_a's account, so the refusal comes from the user_id predicate.
select tests.assert_user_isolated(
  'transactions',
  'user_id',
  $$insert into public.transactions
      (user_id, account_id, amount_minor, currency, type, occurred_on)
    values (%L, tests.account_a(), 100, 'PHP', 'expense', '2026-11-16')$$
);

-- ---------------------------------------------------------------------------
-- CROSS-TABLE OWNERSHIP. Every insert below carries user_b's OWN user_id, so
-- a policy checking only user_id passes it — and the foreign key passes too,
-- because FK checks do not apply RLS. These are the tests that fail against
-- the plausible-looking policy (rls-policies.md#cross-table-ownership).
-- ---------------------------------------------------------------------------
select tests.authenticate_as(tests.user_b());

select throws_ok(
  $$ insert into public.transactions
       (user_id, account_id, amount_minor, currency, type, occurred_on)
     values (tests.user_b(), tests.account_a(), 100, 'PHP', 'expense', '2026-11-16') $$,
  '42501', null,
  'transactions: cannot attach own transaction to another user''s account'
);
select throws_ok(
  $$ insert into public.transactions
       (user_id, account_id, category_id, amount_minor, currency, type, occurred_on)
     values (tests.user_b(), tests.account_b(), tests.expense_category_a(),
             100, 'PHP', 'expense', '2026-11-16') $$,
  '42501', null,
  'transactions: cannot file own transaction under another user''s category'
);
-- The update variants: the half people forget.
select throws_ok(
  $$ update public.transactions set account_id = tests.account_a()
     where id = tests.transaction_b() $$,
  '42501', null,
  'transactions: cannot re-point own transaction at another user''s account'
);
select throws_ok(
  $$ update public.transactions set category_id = tests.expense_category_a()
     where id = tests.transaction_b() $$,
  '42501', null,
  'transactions: cannot re-file own transaction under another user''s category'
);
select tests.reset_role();
select is(
  (select count(*) from public.transactions where account_id = tests.account_a()),
  1::bigint,
  'transactions: user_a''s account still holds only user_a''s transaction'
);

-- The owner's own path works: a policy that denies everything also passes
-- every isolation test above.
select tests.authenticate_as(tests.user_a());
select lives_ok(
  $$ insert into public.transactions
       (user_id, account_id, category_id, amount_minor, currency, type, occurred_on, description)
     values (tests.user_a(), tests.account_a(), tests.income_category_a(),
             3500000, 'PHP', 'income', '2026-11-15', 'A salary') $$,
  'transactions: a user can insert their own transaction with their own category'
);
select lives_ok(
  $$ insert into public.transactions
       (user_id, account_id, amount_minor, currency, type, occurred_on)
     values (tests.user_a(), tests.account_a(), 100, 'PHP', 'expense', '2026-11-15') $$,
  'transactions: a user can insert an uncategorised transaction'
);
update public.transactions set amount_minor = 3600000 where description = 'A salary';
select is(
  (select amount_minor from public.transactions where description = 'A salary'),
  3600000::bigint,
  'transactions: a user can update their own transaction'
);
delete from public.transactions where description = 'A salary';
select is(
  (select count(*) from public.transactions where description = 'A salary'),
  0::bigint,
  'transactions: a user can delete their own transaction'
);
select throws_ok(
  $$ update public.transactions set user_id = tests.user_b()
     where user_id = tests.user_a() $$,
  '42501', null,
  'transactions: an update moving user_id to another user fails the with check'
);

-- Anonymous: no rows, no writes.
select tests.authenticate_anon();
select is(
  (select count(*) from public.transactions), 0::bigint,
  'transactions: anon sees no rows'
);
select throws_ok(
  $$ insert into public.transactions
       (user_id, account_id, amount_minor, currency, type, occurred_on)
     values (tests.user_a(), tests.account_a(), 100, 'PHP', 'expense', '2026-11-16') $$,
  '42501', null,
  'transactions: anon cannot insert'
);
select tests.reset_role();

-- ---------------------------------------------------------------------------
-- Ledger invariants, as the runner (constraints bind every writer).
-- ---------------------------------------------------------------------------
create function tests.tx(
  amount bigint default 100,
  kind text default 'expense',
  category uuid default null,
  cur text default 'PHP',
  group_id uuid default null,
  direction text default null,
  descr text default null
) returns void language sql as $$
  insert into public.transactions
    (user_id, account_id, category_id, amount_minor, currency, type,
     occurred_on, transfer_group_id, transfer_direction, description)
  values (tests.user_a(), tests.account_a(), category, amount, cur,
          kind::public.transaction_type, '2026-11-16', group_id,
          direction::public.transfer_direction, descr)
$$;

select throws_ok($$ select tests.tx(amount => 0) $$, '23514',
  'new row for relation "transactions" violates check constraint "transactions_amount_positive"',
  'transactions: a zero amount is refused');
select throws_ok($$ select tests.tx(amount => -500) $$, '23514',
  'new row for relation "transactions" violates check constraint "transactions_amount_positive"',
  'transactions: a negative amount is refused (the sign lives in type)');
select throws_ok($$ select tests.tx(cur => 'php') $$, '23514',
  'new row for relation "transactions" violates check constraint "transactions_currency_allowed"',
  'transactions: a currency outside the allowlist is refused');
select throws_ok($$ select tests.tx(descr => repeat('x', 201)) $$, '23514',
  'new row for relation "transactions" violates check constraint "transactions_description_length"',
  'transactions: a description over 200 characters is refused');
select throws_ok(
  $$ select tests.tx(kind => 'transfer', category => tests.expense_category_a(),
                     group_id => gen_random_uuid(), direction => 'out') $$, '23514',
  'new row for relation "transactions" violates check constraint "transactions_transfer_no_category"',
  'transactions: a categorised transfer is refused');
select throws_ok($$ select tests.tx(kind => 'transfer', direction => 'out') $$, '23514',
  'new row for relation "transactions" violates check constraint "transactions_transfer_group_shape"',
  'transactions: a transfer leg without a group is refused');
select throws_ok($$ select tests.tx(group_id => gen_random_uuid()) $$, '23514',
  'new row for relation "transactions" violates check constraint "transactions_transfer_group_shape"',
  'transactions: a group id on an expense is refused');
select throws_ok($$ select tests.tx(kind => 'transfer', group_id => gen_random_uuid()) $$, '23514',
  'new row for relation "transactions" violates check constraint "transactions_transfer_direction_shape"',
  'transactions: a transfer leg without a direction is refused');
select lives_ok(
  $$ select tests.tx(kind => 'transfer', group_id => gen_random_uuid(), direction => 'out') $$,
  'transactions: a well-formed transfer leg is accepted');

-- The category-type guard (transactions_category_type_matches).
select throws_ok(
  $$ select tests.tx(kind => 'expense', category => tests.income_category_a()) $$, '23514',
  'transaction type expense does not match category type income (category a0000000-0000-4000-8000-0000000000a3)',
  'transactions: an expense under an income category is refused');
select throws_ok(
  $$ select tests.tx(kind => 'income', category => tests.expense_category_a()) $$, '23514',
  'transaction type income does not match category type expense (category a0000000-0000-4000-8000-0000000000a2)',
  'transactions: an income under an expense category is refused');
select throws_ok(
  $$ update public.transactions set type = 'income'
     where category_id = tests.expense_category_a() $$, '23514', null,
  'transactions: flipping an expense to income under its expense category is refused');

-- Foreign keys: restrict on account, set null on category.
select throws_ok(
  $$ delete from public.accounts where id = tests.account_a() $$, '23503', null,
  'transactions: an account with transactions cannot be deleted (on delete restrict)');
delete from public.categories where id = tests.expense_category_a();
select is(
  (select count(*) from public.transactions
   where user_id = tests.user_a() and amount_minor = 45000 and category_id is null),
  1::bigint,
  'transactions: deleting a category leaves its transactions uncategorised');
-- Deleting the user removes everything, through the restrict: the user's
-- transactions and accounts go in one cascade.
delete from auth.users where id = tests.user_a();
select is(
  (select count(*) from public.transactions where user_id = tests.user_a()),
  0::bigint,
  'transactions: deleting the auth user removes their transactions and accounts');

-- ---------------------------------------------------------------------------
-- Structure.
-- ---------------------------------------------------------------------------
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.transactions'::regclass),
  'transactions: row level security is forced'
);
select set_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.transactions'::regclass $$,
  array['transactions_select_own', 'transactions_insert_own',
        'transactions_update_own', 'transactions_delete_own'],
  'transactions: exactly the four *_own policies'
);
select enum_has_labels('public', 'transaction_type', array['income', 'expense', 'transfer'],
  'transaction_type: exactly income, expense, transfer');
select enum_has_labels('public', 'transfer_direction', array['out', 'in'],
  'transfer_direction: exactly out and in');
select matches(
  col_description('public.transactions'::regclass,
    (select attnum from pg_attribute
     where attrelid = 'public.transactions'::regclass and attname = 'amount_minor')),
  'Always positive, in integer minor units',
  'transactions.amount_minor: the column comment states its unit and sign');
select has_index('public', 'transactions', 'transactions_user_occurred_idx',
  'transactions: the (user_id, occurred_on desc) index exists');
select has_index('public', 'transactions', 'transactions_user_category_occurred_idx',
  'transactions: the (user_id, category_id, occurred_on) index exists');
select has_index('public', 'transactions', 'transactions_account_idx',
  'transactions: the (account_id) index exists');
select has_index('public', 'transactions', 'transactions_transfer_group_idx',
  'transactions: the partial transfer group index exists');

select * from finish();
rollback;
