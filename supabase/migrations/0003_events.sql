-- CLD-02: Append-only event storage.
-- Event types follow packages/contracts/src/events.ts.
-- Payload validation and ingestion are handled by IC-01 / IC-03.

-- Same-facility integrity (provisional team assumption): an event must reference a device and a staff member that
-- belong to the event's own facility. The composite foreign keys below need these referenced keys. (id) is already
-- the primary key of both tables, so the constraints cannot fail on existing rows. They are added here, not in
-- 0002, so no already-applied migration changes.
alter table public.devices
    add constraint devices_id_facility_unique unique (id, facility_id);
alter table public.staff
    add constraint staff_id_facility_unique unique (id, facility_id);

create table public.events (
    id uuid primary key,
    facility_id uuid not null
        references public.facilities(id) on delete restrict,
    device_id uuid not null,
    staff_id uuid not null,
    type text not null
        check (type in (
            'ENTRY',
            'EXIT',
            'PAYMENT',
            'OVERRIDE',
            'ZONE_COUNT',
            'SHIFT_OPEN',
            'SHIFT_CLOSE'
        )),
    session_id uuid,
    payload jsonb not null default '{}'::jsonb,
    device_time timestamptz not null,
    received_at timestamptz not null default now(),
    -- Vocabulary confirmed by Afzal (envelope decision 6). Proposed until the SYNC-01 PR updates the TypeScript contract.
    source text not null default 'LIVE'
        check (source in ('LIVE', 'PAPER_BACKFILL')),
    schema_version integer not null
        check (schema_version > 0),

    constraint events_session_id_by_type_check
        check (
            (type in ('ENTRY', 'EXIT', 'PAYMENT', 'OVERRIDE')) = (session_id is not null)
        ),

    -- These replace single-column keys on device_id and staff_id: a composite key already requires the row to exist.
    constraint events_device_facility_fkey
        foreign key (device_id, facility_id) references public.devices (id, facility_id) on delete restrict,
    constraint events_staff_facility_fkey
        foreign key (staff_id, facility_id) references public.staff (id, facility_id) on delete restrict,

    constraint events_id_facility_unique unique (id, facility_id)
);

create index events_facility_device_time_idx
    on public.events (facility_id, device_time);

alter table public.events enable row level security;

-- Access is granted explicitly by the later RLS/security migrations.
revoke all on table public.events from anon;
revoke update, delete on table public.events from public, anon, authenticated;

-- Append-only for application roles: Supabase default privileges give authenticated and service_role every
-- privilege on new tables. RLS does not govern TRUNCATE and service_role bypasses RLS, so revoke explicitly.
-- This does NOT constrain the table owner (postgres) or superusers; see docs/team/cld-02-events-review.md.
revoke update, delete, truncate on table public.events from authenticated, service_role;
-- Rights no application role needs (TRIGGER: attach triggers; REFERENCES: create foreign keys to the table).
revoke trigger, references on table public.events from authenticated, service_role;
-- Deliberately NOT revoked here: INSERT for authenticated. It depends on whether ingest_events is SECURITY DEFINER
-- or SECURITY INVOKER (Afzal's decision, pending). Direct inserts stay blocked by RLS until a policy exists.
