-- profiles: user isolation plus the profile-specific rules (M1-B01, M1-B02).
begin;
\ir helpers.psql

select plan(17);

-- The reusable assertion: 9 tests. Profiles key on `id`, not `user_id`.
select tests.assert_user_isolated(
  'profiles',
  'id',
  'insert into public.profiles (id) values (%L)'
);

-- Profile-specific: not even a user's own id can be inserted from a session.
-- (The trigger already made user_a's profile, so a permissive insert policy
-- would surface as a unique violation — still not 42501, still a failure.)
select tests.authenticate_as(tests.user_a());
select throws_ok(
  $$ insert into public.profiles (id) values (tests.user_a()) $$,
  '42501', null,
  'profiles: a user cannot insert even their own profile'
);

-- A user can update their own row, and cannot move it to another id.
update public.profiles set display_name = 'Ana' where id = tests.user_a();
select is(
  (select display_name from public.profiles where id = tests.user_a()),
  'Ana',
  'profiles: a user can update their own profile'
);
select throws_ok(
  $$ update public.profiles set id = tests.user_b() where id = tests.user_a() $$,
  '42501', null,
  'profiles: a user cannot move their row to another user''s id'
);

-- Anonymous: no rows, no writes.
select tests.authenticate_anon();
select is(
  (select count(*) from public.profiles), 0::bigint,
  'profiles: anon sees no rows'
);
select tests.reset_role();

-- Structure: forced RLS, exactly the two documented policies.
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles: row level security is forced'
);
select set_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.profiles'::regclass $$,
  array['profiles_select_own', 'profiles_update_own'],
  'profiles: exactly the select_own and update_own policies'
);

-- The sign-up trigger: idempotent, and definer-safe.
create trigger zz_second_invocation after insert on auth.users
  for each row execute function public.handle_new_user();
select lives_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email)
     values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
             '00000000-0000-0000-0000-000000000000',
             'authenticated', 'authenticated', 'twice@test.local') $$,
  'handle_new_user: a second invocation for the same id does not error'
);
select is(
  (select count(*) from public.profiles
   where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  1::bigint,
  'handle_new_user: still exactly one profile'
);

select * from finish();
rollback;
