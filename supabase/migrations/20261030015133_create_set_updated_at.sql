-- M1-B01 — shared `updated_at` maintenance.
--
-- One function for every table with an `updated_at` column. Each later table's
-- migration wires its own `before update` trigger to it rather than defining
-- another copy (docs/architecture/data-model.md#triggers).
--
-- A trigger, not application code: `updated_at` set in a Server Action is wrong
-- the first time anyone writes from a migration, a seed script, or the SQL
-- editor — and it is the column you most need to trust while debugging.
--
-- security invoker (the default), deliberately. It modifies NEW, touches no
-- table, and needs no privilege; `security definer` here would be a needless
-- escalation (docs/architecture/rls-policies.md#security-definer-functions).

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared before-update trigger: sets updated_at = now(). Reused by every table with an updated_at column.';
