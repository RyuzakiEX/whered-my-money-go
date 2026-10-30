-- M1-B01 — create the profile when an auth user is created.
--
-- Separate from the table so the security-sensitive half is reviewed on its
-- own (docs/architecture/data-model.md#migration-ordering).
--
-- WHY security definer (required justification,
-- docs/architecture/rls-policies.md#security-definer-functions):
--   The trigger fires inside GoTrue's insert into auth.users, before any
--   session exists, as a role with no policy on public.profiles. It must run
--   as the function owner to insert the row. This is the one place the
--   schema justifies definer rights, and it pays for them with the full
--   search_path discipline: `set search_path = ''` and every identifier
--   schema-qualified, so no object an attacker creates can be resolved here.
--
-- Why a trigger at all: every path into auth.users (email sign-up, OAuth, an
-- admin-created user, a seed script) gets a profile, atomically, with no
-- window in which a signed-in user has none.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text := pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name');
begin
  -- currency and timezone come from the column defaults (PHP, Asia/Manila):
  -- one place to change them, not two.
  --
  -- A metadata name the length check would reject becomes NULL instead of
  -- aborting the auth.users insert: sign-up must not fail on a cosmetic field.
  insert into public.profiles (id, display_name)
  values (
    new.id,
    case
      when pg_catalog.char_length(requested_name) between 1 and 80
        then requested_name
    end
  )
  -- Idempotent: a second invocation for the same id is a no-op, not an error.
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'security definer, search_path empty. Creates the profiles row on auth.users insert. Justified in its migration.';

-- Functions in public are exposed through the API; nothing but the trigger
-- should ever run this one.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
