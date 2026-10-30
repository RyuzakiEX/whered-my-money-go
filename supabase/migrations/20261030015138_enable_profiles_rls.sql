-- M1-B02 — row level security for profiles.
--
-- Policy matrix: docs/architecture/rls-policies.md#profiles.

alter table public.profiles enable row level security;

-- FORCE applies the policies to the table owner too. Without it, anything
-- that runs as the owner (a future function, a migration helper) silently
-- bypasses them.
alter table public.profiles force row level security;

-- `(select auth.uid())`, not `auth.uid()`: the subquery is evaluated once per
-- statement instead of once per row.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- Both USING and WITH CHECK, identical. USING gates which rows you may
-- target; WITH CHECK gates what the row looks like afterwards. Postgres
-- reuses USING as the check when WITH CHECK is omitted, so stating it is for
-- the reader: the real hazard is a WITH CHECK *looser* than USING, which
-- would let a user `update profiles set id = <someone else's id>`.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Deliberately NO insert policy and NO delete policy for any role.
--
--   insert: profiles are created only by the security-definer
--           on_auth_user_created trigger. Application code that could insert
--           a profile could insert one with a mismatched or duplicate id, and
--           there is no product reason to allow it.
--   delete: account deletion goes through Supabase Auth, and
--           `on delete cascade` from auth.users removes the profile. A user
--           deleting their profile while their auth user survives leaves an
--           unusable account.
--
-- The anon role has no policy at all, and therefore no access.
