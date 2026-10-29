-- SYNC-02 (part 2): open_sessions, the set of vehicles currently inside, maintained from the event log.
-- A row is inserted for an ENTRY and deleted when an EXIT for the same session arrives. It is derived data: the
-- events table stays the source of truth and the projection can be rebuilt from it. Phones sync this table down (SYNC-03).
-- Out-of-order arrival: an EXIT that reached the server before its ENTRY is remembered through the events table, so
-- the late ENTRY does not create an open session (it is already closed).
-- Policies come with CLD-03 (0010_rls.sql); until then RLS denies every non-superuser role. REQUIREMENT for that migration:
-- a device (and a guard) may read only the rows of its own facility_id, and nobody may write this table (the trigger does).
-- supabase/tests/open_sessions.test.sql holds a TODO assertion for this that CLD-03 must switch on.

-- Uppercase letters and digits only, as GATE-01 normalizes plates. NULL when nothing is left.
create function public.normalize_vehicle_no(v text) returns text
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select nullif(upper(regexp_replace(coalesce(v, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;

create table public.open_sessions (
    session_id uuid not null,
    facility_id uuid not null references public.facilities (id) on delete restrict,
    entry_event_id uuid not null,
    zone_id uuid not null,
    vehicle_class text not null,
    short_code text not null,
    vehicle_no text,           -- normalized, see normalize_vehicle_no
    pass_id uuid,
    entry_time timestamptz not null,  -- device_time of the ENTRY event
    created_at timestamptz not null default now(),
    -- Keyed per facility: session ids are UUIDv7 generated on the device and are practically unique, but nothing in the
    -- database enforces that across tenants, so one facility must never be able to collide with (or block) another's id.
    primary key (facility_id, session_id),
    constraint open_sessions_entry_event_fkey
        foreign key (entry_event_id, facility_id) references public.events (id, facility_id) on delete restrict
);
create index open_sessions_facility_zone_idx on public.open_sessions (facility_id, zone_id);
create index open_sessions_facility_vehicle_idx on public.open_sessions (facility_id, vehicle_no)
    where vehicle_no is not null;

alter table public.open_sessions enable row level security;
revoke all on table public.open_sessions from anon;
-- Only the trigger below writes this table. service_role is left alone for repair tools (it bypasses RLS anyway).
revoke insert, update, delete, truncate, trigger, references on table public.open_sessions from authenticated;

create function public.apply_open_sessions() returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, public, pg_temp
as $$
begin
    if new.type = 'ENTRY' then
        -- The event log is the source of truth and an event that passed the envelope checks is never refused because
        -- of the projection. If the payload cannot be projected (missing keys, or a zone_id / pass_id that is not a
        -- UUID) the event stays in `events`, no session is opened and a WARNING is raised.
        begin
            if new.payload ->> 'zone_id' is null or new.payload ->> 'vehicle_class' is null
               or new.payload ->> 'short_code' is null then
                raise warning 'ENTRY event % has no zone_id/vehicle_class/short_code; no open session created', new.id;
            elsif not exists (
                select 1 from public.events x
                where x.type = 'EXIT' and x.session_id = new.session_id and x.facility_id = new.facility_id
            ) then
                -- A second ENTRY event for the same session keeps the first row (the first one wins).
                insert into public.open_sessions (session_id, facility_id, entry_event_id, zone_id, vehicle_class,
                                                  short_code, vehicle_no, pass_id, entry_time)
                values (new.session_id, new.facility_id, new.id,
                        (new.payload ->> 'zone_id')::uuid,
                        new.payload ->> 'vehicle_class',
                        new.payload ->> 'short_code',
                        public.normalize_vehicle_no(new.payload ->> 'vehicle_no'),
                        (new.payload ->> 'pass_id')::uuid,
                        new.device_time)
                on conflict (facility_id, session_id) do nothing;
            end if;
        exception when others then
            raise warning 'open_sessions projection failed for event %: % (%)', new.id, sqlerrm, sqlstate;
        end;
    elsif new.type = 'EXIT' then
        delete from public.open_sessions
        where session_id = new.session_id and facility_id = new.facility_id;
    end if;
    return null;
end;
$$;
revoke all on function public.apply_open_sessions() from public, anon, authenticated;

-- Name sorts before the conflict detector's trigger (0006), which reads open_sessions.
create trigger events_10_apply_open_sessions
    after insert on public.events
    for each row execute function public.apply_open_sessions();

grant select on table public.open_sessions to authenticated;
