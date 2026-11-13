-- CI only (scripts/test-db-ci.mjs). A plain Postgres has none of the objects Supabase provides, so this creates the
-- minimum the migrations and tests use: the three API roles, auth.users, and auth.uid() / auth.jwt() / auth.role().
-- These three mirror the real Supabase-provided definitions exactly (checked against a running local Supabase
-- Postgres container: `select pg_get_functiondef('auth.uid()'::regprocedure)`, same for auth.jwt()/auth.role()),
-- including the coalesce between the flat per-claim GUC (request.jwt.claim.sub, .role) that some tests set and the
-- full JSON GUC (request.jwt.claims) that others set (for example supabase/tests/device_heartbeats.test.sql, which
-- also needs auth.jwt() itself to read app_metadata). It is still NOT a full Supabase emulation: anything that
-- depends on other Supabase internals (storage, realtime, Edge Functions) needs the real local stack (`pnpm test:db`).
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
