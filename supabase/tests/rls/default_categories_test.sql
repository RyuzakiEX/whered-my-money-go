-- The spec §7 default-category seed (M3-B02): idempotent, atomic with
-- sign-up, and unreachable from a session.
begin;
\ir helpers.psql

select plan(9);

-- helpers.psql inserted both users into auth.users, so the real trigger has
-- already seeded them.
select is(
  (select count(*) from public.categories where user_id = tests.user_a()),
  16::bigint,
  'seed: sign-up gives a user the 16 spec §7 categories'
);
select is(
  (select count(*) from public.categories
   where user_id = tests.user_a() and is_default),
  16::bigint,
  'seed: every seeded category is marked is_default'
);

-- Idempotent: calling it twice more inserts nothing.
select public.seed_default_categories(tests.user_a());
select public.seed_default_categories(tests.user_a());
select is(
  (select count(*) from public.categories where user_id = tests.user_a()),
  16::bigint,
  'seed: two further calls for the same user insert nothing'
);

-- Atomic with sign-up: a seed that fails takes the profile and the auth user
-- with it, so no user can exist without categories. Sabotage the seed with a
-- constraint one default violates, inside a savepoint-safe throws_ok.
alter table public.categories
  add constraint zz_no_gift check (name <> 'Gift') not valid;
select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email)
     values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             '00000000-0000-0000-0000-000000000000',
             'authenticated', 'authenticated', 'atomic@test.local') $$,
  '23514', null,
  'seed: a failing seed aborts the sign-up insert'
);
select is(
  (select count(*) from public.profiles
   where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  0::bigint,
  'seed: and leaves no profile behind'
);
select is(
  (select count(*) from public.categories
   where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  0::bigint,
  'seed: and no partial set of categories'
);
alter table public.categories drop constraint zz_no_gift;

-- Not callable from a session. Asserted on the caller's OWN id and on the
-- exact message: with execute granted, a call for another user's id is ALSO
-- refused with 42501 — by the categories insert policy — so a looser
-- assertion passes for the wrong reason (found by sabotage in M3-B02).
select tests.authenticate_as(tests.user_b());
select throws_ok(
  $$ select public.seed_default_categories(tests.user_b()) $$,
  '42501', 'permission denied for function seed_default_categories',
  'seed: authenticated cannot execute the seed function'
);
select tests.authenticate_anon();
select throws_ok(
  $$ select public.seed_default_categories(tests.user_a()) $$,
  '42501', 'permission denied for function seed_default_categories',
  'seed: anon cannot execute the seed function'
);
select tests.reset_role();

-- search_path hygiene: every security definer function in public pins an
-- empty search_path (rls-policies.md#additional-cases).
select is_empty(
  $$ select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'seed: every security definer function in public sets search_path to empty'
);

select * from finish();
rollback;
