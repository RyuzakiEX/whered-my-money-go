-- TEMPORARY (M0-B07 demonstration): adds a table WITHOUT regenerating
-- types/database.types.ts, to prove the schema-drift types gate fails.
-- Reverted in the next commit.
create table public.b07_demo (id bigint primary key);
alter table public.b07_demo enable row level security;
