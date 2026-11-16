-- M3-B04 (categories half) — row level security for categories.
--
-- Policy matrix: docs/architecture/rls-policies.md#categories. Like accounts,
-- `categories` has no foreign key to another user-owned table, so a plain
-- user_id check is sufficient. Transactions, which reference both, need the
-- cross-table checks (rls-policies.md#cross-table-ownership).

alter table public.categories enable row level security;

-- FORCE applies the policies to the table owner too, so nothing running as the
-- owner silently bypasses them.
alter table public.categories force row level security;

-- `(select auth.uid())`, not `auth.uid()`: evaluated once per statement
-- instead of once per row.
create policy categories_select_own on public.categories
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy categories_insert_own on public.categories
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- WITH CHECK stated, not inherited from USING: it is what stops
-- `update categories set user_id = <someone else>` on a row the caller owns.
create policy categories_update_own on public.categories
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy categories_delete_own on public.categories
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The anon role has no policy at all, and therefore no access.
