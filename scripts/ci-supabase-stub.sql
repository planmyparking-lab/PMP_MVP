-- CI only (scripts/test-db-ci.mjs). A plain Postgres has none of the objects Supabase provides, so this creates the
-- minimum the migrations and tests use: the three API roles, auth.users and auth.uid() (reads the same
-- request.jwt.claim.sub setting the tests use to act as a device). It is NOT a Supabase emulation: RLS policies that
-- depend on other Supabase internals (auth.jwt(), storage, realtime) need the real local stack (`pnpm test:db`).
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
