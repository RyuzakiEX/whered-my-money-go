-- M3-B03 — an income transaction takes an income category, an expense an
-- expense one.
--
-- A check constraint cannot see another table, so this is a trigger
-- (data-model.md#constraints-summary, `transactions_category_type_matches`).
-- Without it, "Salary" can appear in the expense breakdown, and every figure
-- built on categories inherits the error. The Server Action checks too
-- (M3-B07) so the user gets a field error; this is the backstop for every
-- other writer.
--
-- Separate from the table so it is a reviewable unit
-- (data-model.md#migration-ordering).
--
-- NOT security definer: it runs as the caller and reads only a category the
-- caller can already see. A category it cannot see (another user's) is left
-- to the insert policy, which refuses it (M3-B04).

create function public.transactions_category_type_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category_type public.category_type;
begin
  -- A transfer with a category is refused by transactions_transfer_no_category.
  -- A BEFORE trigger fires ahead of check constraints, so step aside here and
  -- let that constraint name the real problem.
  if new.category_id is null or new.type = 'transfer' then
    return new;
  end if;

  select c.type into v_category_type
  from public.categories c
  where c.id = new.category_id;

  -- Not visible: another user's category, or none. RLS and the foreign key
  -- answer that; this trigger answers only "does the type match".
  if not found then
    return new;
  end if;

  -- Only income and expense reach here; category_type has the same labels.
  if v_category_type::text <> new.type::text then
    raise exception 'transaction type % does not match category type % (category %)',
        new.type, v_category_type, new.category_id
      using errcode = 'check_violation',
            constraint = 'transactions_category_type_matches',
            table = 'transactions',
            schema = 'public';
  end if;

  return new;
end;
$$;

comment on function public.transactions_category_type_guard() is
  'Enforces transactions_category_type_matches: a category''s type equals its transaction''s. Not security definer.';

revoke execute on function public.transactions_category_type_guard() from public, anon, authenticated;

-- `of type, category_id`: an edit to the amount or the description cannot
-- change whether the pair matches, so it skips the lookup.
create trigger transactions_category_type_guard
  before insert or update of type, category_id on public.transactions
  for each row execute function public.transactions_category_type_guard();
