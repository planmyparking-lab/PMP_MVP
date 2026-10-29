-- SYNC-05: conflict detection. Events are never edited or dropped; disagreement is recorded for a person (IC-10).
-- Types: DUPLICATE_EXIT, ORPHAN_EXIT, DUPLICATE_ENTRY, CLOCK_SKEW. See docs/team/member-01-afzal.md (SYNC-05).
-- Rules: one OPEN conflict per (facility, type, dedupe_key); detection never blocks or rolls back the event insert.

create table public.sync_conflicts (
    id uuid primary key default gen_random_uuid(),
    facility_id uuid not null references public.facilities (id) on delete restrict,
    type text not null
        check (type in ('DUPLICATE_EXIT', 'ORPHAN_EXIT', 'DUPLICATE_ENTRY', 'CLOCK_SKEW')),
    event_ids uuid[] not null check (cardinality(event_ids) >= 1),
    session_id uuid,
    -- What "the same conflict" means (within one facility): the session for the three session types, the event itself for CLOCK_SKEW.
    dedupe_key uuid not null,
    status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
    detail jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    resolved_by uuid references auth.users (id) on delete set null,
    resolved_at timestamptz,
    check ((status = 'RESOLVED') = (resolved_at is not null))
);
create unique index sync_conflicts_one_open_idx
    on public.sync_conflicts (facility_id, type, dedupe_key) where status = 'OPEN';
create index sync_conflicts_facility_status_idx on public.sync_conflicts (facility_id, status, created_at);

alter table public.sync_conflicts enable row level security;
revoke all on table public.sync_conflicts from anon;
-- Written by the trigger; the Console resolves through conflict_resolutions (CON-07), not by editing rows.
revoke insert, update, delete, truncate, trigger, references on table public.sync_conflicts from authenticated;
grant select on table public.sync_conflicts to authenticated;

create function public.detect_conflicts() returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, public, pg_temp
as $$
declare
    clock_skew_seconds constant integer := 300;  -- SPEC: 5 minutes
    other_ids uuid[];
    other_entry public.open_sessions%rowtype;
    plate text;
begin
    begin
        -- Paper backfill carries an old device_time on purpose, so it is not a clock problem.
        if new.source = 'LIVE'
           and abs(extract(epoch from (new.device_time - new.received_at))) > clock_skew_seconds then
            insert into public.sync_conflicts (facility_id, type, event_ids, session_id, dedupe_key, detail)
            values (new.facility_id, 'CLOCK_SKEW', array[new.id], new.session_id, new.id,
                    jsonb_build_object(
                        'device_time', new.device_time,
                        'received_at', new.received_at,
                        'skew_seconds', round(extract(epoch from (new.device_time - new.received_at)))))
            on conflict (facility_id, type, dedupe_key) where status = 'OPEN' do nothing;
        end if;

        if new.type = 'EXIT' then
            select array_agg(x.id order by x.device_time, x.id) into other_ids
            from public.events x
            where x.type = 'EXIT' and x.session_id = new.session_id and x.facility_id = new.facility_id
              and x.id <> new.id;
            if other_ids is not null then
                -- Both (or all) exits go on one conflict; a third exit is appended to the open one.
                insert into public.sync_conflicts (facility_id, type, event_ids, session_id, dedupe_key)
                values (new.facility_id, 'DUPLICATE_EXIT', other_ids || new.id, new.session_id, new.session_id)
                on conflict (facility_id, type, dedupe_key) where status = 'OPEN' do update
                    set event_ids = case
                        when new.id = any (public.sync_conflicts.event_ids) then public.sync_conflicts.event_ids
                        else public.sync_conflicts.event_ids || new.id
                    end;
            end if;

            if not exists (
                select 1 from public.events x
                where x.type = 'ENTRY' and x.session_id = new.session_id and x.facility_id = new.facility_id
            ) then
                insert into public.sync_conflicts (facility_id, type, event_ids, session_id, dedupe_key)
                values (new.facility_id, 'ORPHAN_EXIT', array[new.id], new.session_id, new.session_id)
                on conflict (facility_id, type, dedupe_key) where status = 'OPEN' do nothing;
            end if;

        elsif new.type = 'ENTRY' then
            -- Out-of-order sync: the entry that an exit was waiting for has arrived.
            update public.sync_conflicts
               set status = 'RESOLVED', resolved_at = now(),
                   detail = detail || jsonb_build_object('resolution', 'entry_arrived')
             where facility_id = new.facility_id and type = 'ORPHAN_EXIT' and dedupe_key = new.session_id and status = 'OPEN';

            plate := public.normalize_vehicle_no(new.payload ->> 'vehicle_no');
            if plate is not null then
                select * into other_entry from public.open_sessions o
                where o.facility_id = new.facility_id and o.vehicle_no = plate
                  and o.session_id <> new.session_id
                order by o.entry_time, o.session_id limit 1;
                if found then
                    insert into public.sync_conflicts (facility_id, type, event_ids, session_id, dedupe_key, detail)
                    values (new.facility_id, 'DUPLICATE_ENTRY', array[other_entry.entry_event_id, new.id],
                            new.session_id, new.session_id,
                            jsonb_build_object('other_session_id', other_entry.session_id))
                    on conflict (facility_id, type, dedupe_key) where status = 'OPEN' do nothing;
                end if;
            end if;
        end if;
    exception when others then
        -- Detection must never lose the event (SYNC-05 rule): report and carry on.
        raise warning 'detect_conflicts failed for event %: % (%)', new.id, sqlerrm, sqlstate;
    end;
    return null;
end;
$$;
revoke all on function public.detect_conflicts() from public, anon, authenticated;

create trigger events_20_detect_conflicts
    after insert on public.events
    for each row execute function public.detect_conflicts();
