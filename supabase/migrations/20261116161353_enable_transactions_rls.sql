-- M3-B04 (transactions half) — row level security for transactions, with
-- cross-table ownership.
--
-- THE MOST SECURITY-CRITICAL MIGRATION IN THE MVP. Policy matrix and the
-- reasoning: docs/architecture/rls-policies.md#cross-table-ownership.
--
-- A plain `user_id = auth.uid()` is not enough here. A user inserting a row
-- with THEIR user_id and SOMEONE ELSE'S account_id passes that predicate, and
-- the foreign key check passes too — FK checks do not apply RLS. The result
-- is a transaction attached to another user's account, moving that user's
-- derived balance. So insert and update also require that the referenced
-- account, and the category when there is one, belong to the caller.

alter table public.transactions enable row level security;

-- FORCE applies the policies to the table owner too, so nothing running as the
-- owner silently bypasses them.
alter table public.transactions force row level security;

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

-- The whole WITH CHECK again. Guarding insert but not update would let a user
-- create a legitimate row and then re-point it at another user's account:
-- the same end state as the attack the insert policy blocks.
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

-- The anon role has no policy at all, and therefore no access.
