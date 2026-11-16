-- categories: user isolation plus the category-specific rules (M3-B01, M3-B04).
begin;
\ir helpers.psql

-- Fixtures, as the runner: one row per user. Names chosen not to collide with
-- any seeded default.
insert into public.categories (user_id, name, type, icon)
values
  (tests.user_a(), 'A groceries', 'expense', 'shopping-cart'),
  (tests.user_b(), 'B groceries', 'expense', 'shopping-cart');

select plan(27);

-- The reusable assertion: 9 tests.
select tests.assert_user_isolated(
  'categories',
  'user_id',
  $$insert into public.categories (user_id, name, type, icon)
    values (%L, 'stolen', 'expense', 'tag')$$
);

-- The owner's own path works: a policy that denies everything also passes
-- every isolation test above.
select tests.authenticate_as(tests.user_a());
select lives_ok(
  $$ insert into public.categories (user_id, name, type, icon)
     values (tests.user_a(), 'A side gig', 'income', 'briefcase') $$,
  'categories: a user can insert their own category'
);
update public.categories set name = 'A side gig, renamed'
  where user_id = tests.user_a() and name = 'A side gig';
select is(
  (select count(*) from public.categories where name = 'A side gig, renamed'),
  1::bigint,
  'categories: a user can update their own category'
);
delete from public.categories where name = 'A side gig, renamed';
select is(
  (select count(*) from public.categories where name = 'A side gig, renamed'),
  0::bigint,
  'categories: a user can delete their own category'
);

select throws_ok(
  $$ update public.categories set user_id = tests.user_b()
     where user_id = tests.user_a() $$,
  '42501', null,
  'categories: an update moving user_id to another user fails the with check'
);

-- Anonymous: no rows, no writes.
select tests.authenticate_anon();
select is(
  (select count(*) from public.categories), 0::bigint,
  'categories: anon sees no rows'
);
select throws_ok(
  $$ insert into public.categories (user_id, name, type, icon)
     values (tests.user_a(), 'anon', 'expense', 'tag') $$,
  '42501', null,
  'categories: anon cannot insert'
);
select tests.reset_role();

-- The unique name rule: case-insensitive within a type, free across types.
select throws_ok(
  $$ insert into public.categories (user_id, name, type, icon)
     values (tests.user_a(), 'a GROCERIES', 'expense', 'tag') $$,
  '23505', null,
  'categories: a second expense category differing only in case is refused'
);
select lives_ok(
  $$ insert into public.categories (user_id, name, type, icon)
     values (tests.user_a(), 'A groceries', 'income', 'tag') $$,
  'categories: the same name is allowed under the other type'
);
select lives_ok(
  $$ insert into public.categories (user_id, name, type, icon)
     values (tests.user_b(), 'A groceries', 'expense', 'tag') $$,
  'categories: the same name is allowed for a different user'
);

-- Column checks.
select throws_ok(
  $$ insert into public.categories (user_id, name, type, icon)
     values (tests.user_a(), '   ', 'expense', 'tag') $$,
  '23514', null,
  'categories: a blank name is refused'
);
select throws_ok(
  $$ insert into public.categories (user_id, name, type, icon)
     values (tests.user_a(), repeat('x', 41), 'expense', 'tag') $$,
  '23514', null,
  'categories: a name over 40 characters is refused'
);
select throws_ok(
  $$ insert into public.categories (user_id, name, type, icon, color)
     values (tests.user_a(), 'Bad colour', 'expense', 'tag', 'red') $$,
  '23514', null,
  'categories: a colour that is not #rrggbb is refused'
);
select throws_ok(
  $$ insert into public.categories (user_id, name, type, icon)
     values (tests.user_a(), 'Bad icon', 'expense', '<svg onload=x>') $$,
  '23514', null,
  'categories: an icon that is not an icon name is refused'
);

-- Structure: forced RLS, exactly the four documented policies.
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.categories'::regclass),
  'categories: row level security is forced'
);
select set_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.categories'::regclass $$,
  array['categories_select_own', 'categories_insert_own',
        'categories_update_own', 'categories_delete_own'],
  'categories: exactly the four *_own policies'
);
select enum_has_labels(
  'public', 'category_type', array['income', 'expense'],
  'category_type: exactly income and expense, in order'
);
select has_index('public', 'categories', 'categories_unique_name',
  'categories: the case-insensitive unique name index exists');
select has_index('public', 'categories', 'categories_user_type_idx',
  'categories: the (user_id, type) index exists');

select * from finish();
rollback;
