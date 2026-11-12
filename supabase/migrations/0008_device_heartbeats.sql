-- 0008: device_heartbeats table and heartbeat() function (CLD-04).
-- Shape follows docs/team/member-04-akanksha.md CLD-04 (signature (H); columns and window (R)). One row per device holds
-- the latest accepted heartbeat; there is no history. IC-09 is not yet confirmed with the sender (Afzal) or the reader
-- (Anamika). Depends on 0003 for the unique (id, facility_id) key on devices. The read policy (owner and manager) arrives
-- in 0010_rls.sql; until then RLS denies every non-superuser role.

create table public.device_heartbeats (
  device_id uuid primary key,
  facility_id uuid not null,
  received_at timestamptz not null default now(), -- database clock only; device clocks are never trusted
  queue_depth integer not null check (queue_depth >= 0),
  oldest_unsynced_age_s integer not null check (oldest_unsynced_age_s >= 0),
  app_version text not null check (length(btrim(app_version)) > 0),
  schema_version integer not null check (schema_version > 0),
  battery_pct integer not null check (battery_pct between 0 and 100),
  -- a heartbeat can only carry the facility its device belongs to
  constraint device_heartbeats_device_facility_fkey
    foreign key (device_id, facility_id) references public.devices (id, facility_id) on delete cascade
);
-- Health page and the stale-device job read the latest heartbeat per facility.
create index device_heartbeats_facility_received_idx on public.device_heartbeats (facility_id, received_at);

alter table public.device_heartbeats enable row level security;

-- Writes only through heartbeat().
revoke all on table public.device_heartbeats from anon;
revoke insert, update, delete, truncate on table public.device_heartbeats from authenticated;

-- Parameter names are the H signature and are what supabase-js rpc() sends. Returns true when the row was written
-- and false when the call fell inside the 5-minute window (ignored, not an error).
create function public.heartbeat(
  device_id uuid,
  queue_depth integer,
  oldest_unsynced_age integer,
  app_version text,
  schema_version integer,
  battery integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_facility uuid;
  v_rows integer;
begin
  -- Validation first: malformed values are rejected, never clamped. Parameters are always schema-qualified
  -- (heartbeat.x) because their names equal column names.
  if heartbeat.device_id is null
     or heartbeat.queue_depth is null or heartbeat.queue_depth < 0
     or heartbeat.oldest_unsynced_age is null or heartbeat.oldest_unsynced_age < 0
     or heartbeat.app_version is null or length(btrim(heartbeat.app_version)) = 0
     or heartbeat.schema_version is null or heartbeat.schema_version <= 0
     or heartbeat.battery is null or heartbeat.battery < 0 or heartbeat.battery > 100 then
    raise exception 'invalid heartbeat' using errcode = '22023';
  end if;

  -- Identity: the caller must be the auth user of this very device, carry the same device claim, and the device must
  -- not be revoked. One generic error for every failure (no hint which check failed). Fails closed.
  select d.facility_id into v_facility
  from public.devices d
  where d.id = heartbeat.device_id
    and d.auth_user_id = (select auth.uid())
    and d.revoked_at is null
    and (select auth.jwt()) -> 'app_metadata' ->> 'device_id' = d.id::text
    and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'device';
  if v_facility is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  insert into public.device_heartbeats as h
    (device_id, facility_id, received_at, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct)
  values
    (heartbeat.device_id, v_facility, now(), heartbeat.queue_depth, heartbeat.oldest_unsynced_age,
     heartbeat.app_version, heartbeat.schema_version, heartbeat.battery)
  on conflict (device_id) do update
    set received_at = excluded.received_at,
        queue_depth = excluded.queue_depth,
        oldest_unsynced_age_s = excluded.oldest_unsynced_age_s,
        app_version = excluded.app_version,
        schema_version = excluded.schema_version,
        battery_pct = excluded.battery_pct
    where h.received_at < now() - interval '5 minutes';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.heartbeat(uuid, integer, integer, text, integer, integer) from public, anon;
grant execute on function public.heartbeat(uuid, integer, integer, text, integer, integer) to authenticated;
