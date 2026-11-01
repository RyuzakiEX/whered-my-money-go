-- M2-B03 — row level security for accounts.
--
-- Policy matrix: docs/architecture/rls-policies.md#accounts. `accounts` has no
-- foreign key to another user-owned table, so a plain user_id check is
-- sufficient here; tables that reference accounts are not so lucky
-- (rls-policies.md#cross-table-ownership).

alter table public.accounts enable row level security;

-- FORCE applies the policies to the table owner too, so nothing running as the
-- owner silently bypasses them.
alter table public.accounts force row level security;

-- `(select auth.uid())`, not `auth.uid()`: evaluated once per statement
-- instead of once per row.
create policy accounts_select_own on public.accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy accounts_insert_own on public.accounts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- WITH CHECK stated, not inherited from USING: it is what stops
-- `update accounts set user_id = <someone else>` on a row the caller owns.
create policy accounts_update_own on public.accounts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy accounts_delete_own on public.accounts
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The anon role has no policy at all, and therefore no access.
