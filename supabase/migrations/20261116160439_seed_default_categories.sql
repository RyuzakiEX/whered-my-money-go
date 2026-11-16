-- M3-B02 — seed spec §7's default categories on sign-up.
--
-- A separate migration because it CHANGES M1-B01's sign-up function, and that
-- change must be reviewable on its own (data-model.md#migration-ordering).
--
-- The seed runs inside handle_new_user(), which runs inside the insert into
-- auth.users: one transaction. If the seed fails, the sign-up fails with it,
-- so no user can exist without categories.

-- The defaults, in one place. Spec §7's lists exactly: ten expense, six
-- income. Each colour is distinct and reaches 3:1 (WCAG 1.4.11 non-text
-- contrast) against the background and card of both themes — asserted by
-- tests/integration/default-categories.test.ts against app/globals.css. Icons
-- are lucide names.
--
-- NOT security definer: it is only ever reached through handle_new_user(),
-- which already runs as the owner, or by the service role. Execute is revoked
-- from every session role below, because a callable seed would let a user
-- write categories into another user's id.
create function public.seed_default_categories(p_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.categories (user_id, name, type, color, icon, is_default)
  select p_user_id, d.name, d.type::public.category_type, d.color, d.icon, true
  from (values
    ('Food',           'expense', '#EA580C', 'utensils'),
    ('Transportation', 'expense', '#0284C7', 'bus'),
    ('Bills',          'expense', '#B45309', 'receipt'),
    ('Shopping',       'expense', '#DB2777', 'shopping-bag'),
    ('Entertainment',  'expense', '#7C3AED', 'clapperboard'),
    ('Health',         'expense', '#DC2626', 'heart-pulse'),
    ('Education',      'expense', '#6366F1', 'graduation-cap'),
    ('Subscriptions',  'expense', '#C026D3', 'repeat'),
    ('Housing',        'expense', '#0D9488', 'house'),
    ('Other',          'expense', '#64748B', 'ellipsis'),
    ('Salary',         'income',  '#16A34A', 'banknote'),
    ('Freelance',      'income',  '#0891B2', 'laptop'),
    ('Business',       'income',  '#2563EB', 'briefcase'),
    ('Investment',     'income',  '#047857', 'trending-up'),
    ('Gift',           'income',  '#E11D48', 'gift'),
    ('Other',          'income',  '#78716C', 'ellipsis')
  ) as d (name, type, color, icon)
  -- Idempotent: a category the user already has under that name and type —
  -- seeded earlier, or created by hand — is left alone, so a second call
  -- inserts nothing. The target matches categories_unique_name.
  on conflict (user_id, pg_catalog.lower(name), type) do nothing;
$$;

comment on function public.seed_default_categories(uuid) is
  'Inserts spec §7''s default categories for one user; idempotent. Called by handle_new_user(). Not executable by anon or authenticated.';

revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- handle_new_user(), unchanged from M1-B01 except for the seed call. The
-- security definer justification and search_path discipline are in
-- 20261030015140_create_profile_on_signup.sql.
create or replace function public.handle_new_user()
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

  -- Same transaction as the profile: both exist, or the sign-up fails.
  perform public.seed_default_categories(new.id);

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'security definer, search_path empty. Creates the profiles row and seeds the default categories on auth.users insert. Justified in its migration.';

-- create or replace keeps the existing grants, but state the revoke again so
-- this file is correct read on its own.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Backfill: users who signed up before this migration have no categories.
-- The seed is idempotent, so this is safe to replay and a no-op on an empty
-- database.
select public.seed_default_categories(u.id) from auth.users u;
