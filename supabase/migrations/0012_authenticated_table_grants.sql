-- 0012 (CLD-01): the missing table-level GRANTs for 0010_rls.sql's policies.
--
-- Found 27 Nov 2026, the first time this schema ran against a real hosted Supabase project (every prior check ran
-- locally or against CI's stub) rather than a brand-new project created with "grant API access to new tables
-- automatically" left on. 0003_events.sql's own comment says it plainly: "Supabase default privileges give
-- authenticated and service_role every [privilege]" -- that default is what 0005/0006/0009 relied on when they added
-- their own explicit grant (open_sessions, sync_conflicts, the KPI views) and what every OTHER table in 0001-0002
-- silently relied on without ever stating it. Postgres RLS policies only apply within privileges a role already has
-- (`using`/`with check` never substitute for GRANT); a policy with no table privilege behind it answers "permission
-- denied", not "0 rows" -- which is exactly what a fresh hosted project with that default off returns to a
-- signed-in Console user on every single table except staff and devices (which already had explicit grants for
-- their own reasons: PIN material, device identity theft).
--
-- This migration adds the explicit grant 0010 should have had for: organizations, facilities (select only; update
-- was already explicit), zones, tariffs, passes, devices (select only; update was already explicit), memberships,
-- events, device_heartbeats, enrollment_codes, shift_reviews, conflict_resolutions. Column scoping follows 0010's
-- own established reasoning, applied consistently to every table that has the same shape of problem:
--   - A table whose UPDATE policy checks `facility_id` or `org_id` against the NEW row cannot stop a row being
--     reassigned to a different facility/org the same caller also owns (0010's own documented finding about
--     facilities.org_id, repeated here for zones, tariffs, passes, memberships.org_id): excluded from UPDATE grants.
--   - enrollment_codes.code_hash is excluded from SELECT for the same reason 0010 excludes staff.pin_hash/pin_salt:
--     a short one-time code's hash is brute-forced quickly, so a manager able to read it could derive a code the
--     policy never meant them to be able to use directly.
-- No RLS policy changes: 0010's policies already describe the intended access; this migration only grants the
-- table privileges they need to actually run.

grant select on table public.organizations to authenticated;
grant update (name) on table public.organizations to authenticated;

grant select on table public.facilities to authenticated;

grant select, insert, delete on table public.zones to authenticated;
grant update (name, capacity, vehicle_class) on table public.zones to authenticated;

grant select, insert, delete on table public.tariffs to authenticated;
grant update (vehicle_class, rule_json, effective_from) on table public.tariffs to authenticated;

grant select, insert, delete on table public.passes to authenticated;
grant update (vehicle_no, valid_to, dues) on table public.passes to authenticated;

grant select on table public.devices to authenticated;

grant select, insert, delete on table public.memberships to authenticated;
grant update (facility_id, role) on table public.memberships to authenticated;

-- code_hash excluded: same reasoning as staff.pin_hash/pin_salt in 0010. Insert still needs the full row (the
-- caller is choosing this code's hash, not reading one back), so only select and update are column-scoped.
grant select (id, facility_id, created_by, created_at, expires_at, used_at) on table public.enrollment_codes
  to authenticated;
grant insert, delete on table public.enrollment_codes to authenticated;
grant update (expires_at, used_at) on table public.enrollment_codes to authenticated;

grant select on table public.events to authenticated;
grant select on table public.device_heartbeats to authenticated;

grant select, insert on table public.shift_reviews to authenticated;
grant select, insert on table public.conflict_resolutions to authenticated;
