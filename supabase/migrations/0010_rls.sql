-- 0010 (CLD-03): helper functions and RLS policies for every table created by 0001-0008. Until this migration every
-- table had RLS enabled and no policy, so every non-superuser role was denied. The 0009 KPI views are security_invoker,
-- so they show a caller exactly the events these policies let the caller read.
-- Requires Afzal's review as a permission change (member-04-akanksha.md A.8). Follows the D.3 matrix; where the matrix
-- is silent or ambiguous the choice is fail-closed and recorded as assumption OQ-58 in
-- docs/team/open-questions-and-assumptions.md (devices read no events, no device read of heartbeats, only owner and
-- manager memberships grant access, managers keep full write on enrollment_codes as the matrix says, no default-privilege
-- rule). Policies for tables that do not exist yet (job_runs, audit_log, alert_log) belong with the migration that
-- creates each table.
-- No policy here is literally true. Only owner and manager memberships grant access; the 'guard' membership role has
-- no policy because guards act through enrolled devices. Tested by supabase/tests/rls_policies.test.sql (base tables,
-- devices, heartbeats) and supabase/tests/rls_sync_tables.test.sql (0005-0007 tables, facilities column privileges).

-- True when the caller holds one of `roles` for the facility: directly, or through an organization-wide membership
-- (memberships.facility_id is null) in the facility's organization.
create function public.is_member(facility_id uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.facilities f
    join public.memberships m on m.org_id = f.org_id
    where f.id = is_member.facility_id
      and m.user_id = (select auth.uid())
      and m.role = any (is_member.roles)
      and (m.facility_id is null or m.facility_id = f.id)
  );
$$;

-- Organization-level variant for tables keyed by organization (organizations, memberships).
-- Only organization-wide memberships (facility_id null) count here.
create function public.is_org_member(org_id uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = is_org_member.org_id
      and m.user_id = (select auth.uid())
      and m.role = any (is_org_member.roles)
      and m.facility_id is null
  );
$$;

-- The facility of the calling device, or null. Unlike a bare claim read it also checks the devices row, so a revoked
-- or deleted device, or a token whose claims do not match the row, resolves to null (fails closed).
create function public.device_facility() returns uuid
language sql stable security definer set search_path = '' as $$
  select d.facility_id
  from public.devices d
  where d.auth_user_id = (select auth.uid())
    and d.revoked_at is null
    and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'device'
    and (select auth.jwt()) -> 'app_metadata' ->> 'device_id' = d.id::text
    and (select auth.jwt()) -> 'app_metadata' ->> 'facility_id' = d.facility_id::text;
$$;

revoke all on function public.is_member(uuid, text[]), public.is_org_member(uuid, text[]), public.device_facility()
  from public, anon;
grant execute on function public.is_member(uuid, text[]), public.is_org_member(uuid, text[]), public.device_facility()
  to authenticated;

-- organizations: members read their organization; only an owner updates. No insert or delete for any role.
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id, array['owner', 'manager']) or exists (
    select 1 from public.facilities f
    where f.org_id = organizations.id and public.is_member(f.id, array['owner', 'manager'])));
create policy organizations_update on public.organizations for update to authenticated
  using (public.is_org_member(id, array['owner']))
  with check (public.is_org_member(id, array['owner']));

-- facilities: members and the facility's own devices read; only an owner updates.
create policy facilities_select on public.facilities for select to authenticated
  using (public.is_member(id, array['owner', 'manager']) or id = (select public.device_facility()));
create policy facilities_update on public.facilities for update to authenticated
  using (public.is_member(id, array['owner']))
  with check (public.is_member(id, array['owner']));
-- The policy above checks the facility id only, so by itself it would let an owner change facilities.org_id and move
-- the facility (with its data) into another organization (verified in review). RLS cannot compare old and new values,
-- so the column list is limited with privileges instead: no application role may update id, org_id or created_at.
-- A later migration that adds an editable facility column must extend this grant in the same file.
revoke update on table public.facilities from authenticated;
grant update (name, timezone, slot_count) on table public.facilities to authenticated;

-- zones, tariffs, passes: read for members and the facility's devices; write for owner and manager only.
create policy zones_select on public.zones for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']) or facility_id = (select public.device_facility()));
create policy zones_insert on public.zones for insert to authenticated
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy zones_update on public.zones for update to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']))
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy zones_delete on public.zones for delete to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));

create policy tariffs_select on public.tariffs for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']) or facility_id = (select public.device_facility()));
create policy tariffs_insert on public.tariffs for insert to authenticated
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy tariffs_update on public.tariffs for update to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']))
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy tariffs_delete on public.tariffs for delete to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));

create policy passes_select on public.passes for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']) or facility_id = (select public.device_facility()));
create policy passes_insert on public.passes for insert to authenticated
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy passes_update on public.passes for update to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']))
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy passes_delete on public.passes for delete to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));

-- staff: owner and manager only. Devices never read the base table; they use staff_for_device below.
create policy staff_select on public.staff for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));
create policy staff_update on public.staff for update to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']))
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy staff_delete on public.staff for delete to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));
-- PIN material is never readable or writable by an application role (found in review): a 4-6 digit PIN behind a salted
-- hash is brute-forced in seconds, so a manager who could read pin_hash and pin_salt could learn a guard's PIN and sign
-- in as them. Column privileges, not RLS, are what limit columns. Devices still read the hashes through
-- staff_for_device (it runs as its owner). There is no insert privilege and no insert policy: pin_hash and pin_salt are
-- NOT NULL, so a staff row can only be created, and a PIN only set, by a security definer function such as
-- set_staff_pin (IC-06, not written yet; OQ-58 item 8). Moving staff to another facility (facility_id) is not allowed.
revoke select, insert, update on table public.staff from authenticated;
grant select (id, facility_id, name, phone, active, created_at) on table public.staff to authenticated;
grant update (name, phone, active) on table public.staff to authenticated;

-- IC-06: the only staff data a device may read. Runs with the view owner's rights on purpose (it must read the base
-- table that devices cannot), so its WHERE clause is the whole access control: own facility, active staff only.
create view public.staff_for_device with (security_invoker = false) as
  select s.id, s.name, s.pin_hash, s.pin_salt, s.active
  from public.staff s
  where s.active and s.facility_id = (select public.device_facility());
revoke all on public.staff_for_device from public, anon, authenticated;
grant select on public.staff_for_device to authenticated;

-- devices and enrollment_codes: owner and manager of the facility; a device cannot read any device row.
create policy devices_select on public.devices for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));
create policy devices_update on public.devices for update to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']))
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy devices_delete on public.devices for delete to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));
-- devices.auth_user_id is the device's identity: ingest_events (0004) and device_facility() find the calling device by
-- it. If a manager could write it, they could point a guard's device at their own user and write events in that
-- device's and guard's name (found in review). So no application role inserts devices (they are created by the
-- enrollment function, IC-05, not written yet), and an update may change only the name and the revocation time.
revoke insert, update on table public.devices from authenticated;
grant update (name, revoked_at) on table public.devices to authenticated;

create policy enrollment_codes_select on public.enrollment_codes for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));
create policy enrollment_codes_insert on public.enrollment_codes for insert to authenticated
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy enrollment_codes_update on public.enrollment_codes for update to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']))
  with check (public.is_member(facility_id, array['owner', 'manager']));
create policy enrollment_codes_delete on public.enrollment_codes for delete to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));

-- memberships: everyone reads their own rows (the Console needs its role); an owner reads and manages the whole
-- organization; a manager also reads the rows of their facility. Only an owner writes.
create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_member(org_id, array['owner'])
    or (facility_id is not null and public.is_member(facility_id, array['manager']))
  );
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.is_org_member(org_id, array['owner']));
create policy memberships_update on public.memberships for update to authenticated
  using (public.is_org_member(org_id, array['owner']))
  with check (public.is_org_member(org_id, array['owner']));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.is_org_member(org_id, array['owner']));

-- events: read for owner and manager of the facility. No insert, update or delete policy exists for any role:
-- ingest_events (Afzal) is the only writer. Devices read no events (the matrix says "none or own facility per sync
-- design"; fail closed until the sync design says otherwise).
create policy events_select on public.events for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));

-- device_heartbeats: read for owner and manager; writes only through heartbeat() (no write policy, writes revoked).
create policy device_heartbeats_select on public.device_heartbeats for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));

-- Privilege boundary (found in review): Supabase default privileges give `authenticated` TRUNCATE, REFERENCES and
-- TRIGGER on every new table. RLS does not govern TRUNCATE, so without this any signed-in role could empty a table
-- across all tenants. No application role needs these rights; events already had them revoked in 0003.
-- service_role is left alone (server side only). Tables created by later migrations must repeat this revoke:
-- the catalog assertions in supabase/tests/rls_policies.test.sql fail for ANY public table that still gives
-- authenticated these rights or anon any right. An ALTER DEFAULT PRIVILEGES rule is deliberately not used (OQ-58:
-- defaults come from two creator roles and are project-wide; needs Afzal's decision).
revoke truncate, references, trigger on table
  public.organizations, public.facilities, public.zones, public.tariffs, public.passes,
  public.staff, public.devices, public.memberships, public.enrollment_codes, public.device_heartbeats
  from authenticated;

-- ---- Policies for tables created by 0005-0007 (Afzal's 0005/0006 defer their policies to 0010) ----

-- open_sessions (0005, derived data written only by its trigger): owner/manager of the facility and the facility's own
-- devices read; no write policy exists, and writes are revoked in 0005.
create policy open_sessions_select on public.open_sessions for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']) or facility_id = (select public.device_facility()));

-- sync_conflicts (0006, written by the detector): owner and manager read; devices read nothing. No write policy.
create policy sync_conflicts_select on public.sync_conflicts for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));

-- shift_reviews (0007): owner/manager read and insert for their facility. The reviewer is always the caller, and only a
-- shift that has a SHIFT_CLOSE event in that facility can be reviewed (CON-06: closed shifts only). Append-only.
create policy shift_reviews_select on public.shift_reviews for select to authenticated
  using (public.is_member(facility_id, array['owner', 'manager']));
create policy shift_reviews_insert on public.shift_reviews for insert to authenticated
  with check (
    reviewed_by = (select auth.uid())
    and public.is_member(facility_id, array['owner', 'manager'])
    and exists (
      select 1 from public.events e
      where e.facility_id = shift_reviews.facility_id
        and e.type = 'SHIFT_CLOSE'
        and e.payload ->> 'shift_id' = shift_reviews.shift_id::text
    )
  );

-- conflict_resolutions (0007): owner/manager of the conflict's facility read and insert; the resolver is always the
-- caller. Resolutions never touch events or sync_conflicts rows (changing a conflict's status needs a database
-- function whose contract is not agreed yet, OQ-49). Append-only.
create policy conflict_resolutions_select on public.conflict_resolutions for select to authenticated
  using (exists (
    select 1 from public.sync_conflicts c
    where c.id = conflict_resolutions.conflict_id and public.is_member(c.facility_id, array['owner', 'manager'])));
create policy conflict_resolutions_insert on public.conflict_resolutions for insert to authenticated
  with check (
    resolved_by = (select auth.uid())
    and exists (
      select 1 from public.sync_conflicts c
      where c.id = conflict_resolutions.conflict_id and public.is_member(c.facility_id, array['owner', 'manager']))
  );
