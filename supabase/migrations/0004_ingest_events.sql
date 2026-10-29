-- SYNC-02 (part 1): idempotent, batched event ingestion.
-- Decision (Afzal): ingest_events is SECURITY DEFINER. Devices get EXECUTE on the function only; they hold no INSERT
-- privilege on public.events, so a device cannot write events by any other route. The function therefore has to
-- verify every claim itself: the caller must be an enrolled, non-revoked device, and each event must carry that
-- device's own facility_id and device_id and an active staff member of that facility.
-- Envelope rules follow docs/integrations/event-envelope.md. The zod schema in packages/contracts is the source of
-- truth for payload shape; SQL only checks the envelope and the required payload keys per type (parity test: T-IC01-C1).

-- Schema versions this database accepts. Bump max_supported together with SCHEMA_VERSION in packages/contracts.
create function public.min_supported_schema_version() returns integer
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select 1 $$;
create function public.max_supported_schema_version() returns integer
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select 1 $$;

create function public.ingest_events(events jsonb) returns jsonb
    language plpgsql
    security definer
    set search_path = pg_catalog, public, pg_temp
as $$
declare
    max_batch constant integer := 500;
    dev public.devices%rowtype;
    item jsonb;
    ev_id uuid;
    ev_type text;
    ev_facility uuid;
    ev_device uuid;
    ev_staff uuid;
    ev_session uuid;
    ev_time timestamptz;
    ev_source text;
    ev_version integer;
    schema_number numeric;
    ev_payload jsonb;
    inserted_id uuid;
    existing public.events%rowtype;
    results jsonb := '[]'::jsonb;
    n_accepted integer := 0;
    n_duplicate integer := 0;
    n_rejected integer := 0;
    outcome text;
    reason text;
    required_keys text[];
    k text;
begin
    if auth.uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    select * into dev from public.devices where auth_user_id = auth.uid() and revoked_at is null;
    if not found then
        raise exception 'caller is not an active enrolled device' using errcode = '42501';
    end if;

    if events is null or jsonb_typeof(events) <> 'array' then
        raise exception 'events must be a JSON array' using errcode = '22023';
    end if;
    if jsonb_array_length(events) > max_batch then
        raise exception 'batch too large (max %)', max_batch using errcode = '22023';
    end if;

    for item in select value from jsonb_array_elements(events) loop
        outcome := null;
        reason := null;
        ev_id := null;

        begin
            if jsonb_typeof(item) <> 'object' then
                raise exception 'event is not an object' using errcode = '22023';
            end if;
            -- Missing keys give NULL here, which the NOT NULL checks below turn into a rejection.
            -- Postgres accepts many spellings ('yesterday', braces, no hyphens); the contract allows exactly one.
            if item ->> 'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
               or item ->> 'device_time' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
               or jsonb_typeof(item -> 'schema_version') is distinct from 'number' then
                raise exception 'malformed envelope field' using errcode = '22023';
            end if;
            -- schema_version must be a whole number that fits the integer column. 1.0 is accepted because it is the
            -- same number as 1 (the contract's z.number().int() accepts it too; JSON.stringify never emits it).
            -- 1.4 is rejected here, before any cast, instead of relying on the cast's error.
            schema_number := (item -> 'schema_version')::numeric;
            if schema_number <> trunc(schema_number) or schema_number not between -2147483648 and 2147483647 then
                raise exception 'schema_version must be an integer' using errcode = '22023';
            end if;
            ev_id := (item ->> 'id')::uuid;
            ev_type := item ->> 'type';
            ev_facility := (item ->> 'facility_id')::uuid;
            ev_device := (item ->> 'device_id')::uuid;
            ev_staff := (item ->> 'staff_id')::uuid;
            ev_session := (item ->> 'session_id')::uuid;
            ev_time := (item ->> 'device_time')::timestamptz;
            ev_source := item ->> 'source';
            ev_version := schema_number::integer;
            ev_payload := item -> 'payload';

            if ev_id is null or ev_type is null or ev_facility is null or ev_device is null or ev_staff is null
               or ev_time is null or ev_source is null or ev_version is null or ev_payload is null then
                outcome := 'REJECTED'; reason := 'INVALID_ENVELOPE';
            elsif jsonb_typeof(ev_payload) <> 'object' then
                outcome := 'REJECTED'; reason := 'INVALID_PAYLOAD';
            elsif ev_version < public.min_supported_schema_version() then
                outcome := 'REJECTED'; reason := 'SCHEMA_VERSION_TOO_OLD';
            elsif ev_version > public.max_supported_schema_version() then
                outcome := 'REJECTED'; reason := 'SCHEMA_VERSION_TOO_NEW';
            elsif ev_facility <> dev.facility_id or ev_device <> dev.id then
                outcome := 'REJECTED'; reason := 'CLAIM_MISMATCH';
            elsif not exists (
                select 1 from public.staff s
                where s.id = ev_staff and s.facility_id = dev.facility_id and s.active
            ) then
                outcome := 'REJECTED'; reason := 'STAFF_NOT_ACTIVE';
            end if;

            if outcome is null then
                required_keys := case ev_type
                    when 'ENTRY' then array['vehicle_class', 'zone_id', 'short_code']
                    when 'EXIT' then array['fare_paise', 'exit_method']
                    when 'PAYMENT' then array['mode', 'amount_paise', 'upi_attested']
                    when 'OVERRIDE' then array['target_event_id', 'reason_code']
                    when 'ZONE_COUNT' then array['zone_id', 'counted', 'system_count_at_time']
                    when 'SHIFT_OPEN' then array['shift_id', 'opening_float_paise']
                    when 'SHIFT_CLOSE' then array['shift_id', 'counted_cash_paise', 'expected_cash_paise',
                        'upi_total_declared_paise', 'upi_attested_sum_paise', 'variance_cash_paise',
                        'variance_upi_paise']
                    else null
                end;
                if required_keys is null then
                    outcome := 'REJECTED'; reason := 'INVALID_ENVELOPE';  -- unknown type
                else
                    foreach k in array required_keys loop
                        if not (ev_payload ? k) or jsonb_typeof(ev_payload -> k) = 'null' then
                            outcome := 'REJECTED'; reason := 'INVALID_PAYLOAD';
                            exit;
                        end if;
                    end loop;
                end if;
            end if;

            if outcome is null then
                insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload,
                                           device_time, source, schema_version)
                values (ev_id, ev_facility, ev_device, ev_staff, ev_type, ev_session, ev_payload,
                        ev_time, ev_source, ev_version)
                on conflict (id) do nothing
                returning id into inserted_id;

                if inserted_id is not null then
                    outcome := 'ACCEPTED';
                else
                    select * into existing from public.events where id = ev_id;
                    -- Same id re-sent unchanged is a harmless retry. Same id with different content (or from
                    -- another facility) is a collision and must not be silently merged.
                    if existing.facility_id = ev_facility and existing.device_id = ev_device
                       and existing.staff_id = ev_staff and existing.type = ev_type
                       and existing.session_id is not distinct from ev_session
                       and existing.device_time = ev_time and existing.source = ev_source
                       and existing.schema_version = ev_version and existing.payload = ev_payload then
                        outcome := 'DUPLICATE';
                    else
                        outcome := 'REJECTED'; reason := 'ID_COLLISION';
                    end if;
                end if;
                inserted_id := null;
            end if;
        exception
            when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
                 or numeric_value_out_of_range or check_violation or foreign_key_violation
                 or not_null_violation or invalid_parameter_value then
                -- The failed insert (if any) is rolled back with this block's subtransaction.
                outcome := 'REJECTED'; reason := 'INVALID_ENVELOPE';
        end;

        if outcome = 'ACCEPTED' then n_accepted := n_accepted + 1;
        elsif outcome = 'DUPLICATE' then n_duplicate := n_duplicate + 1;
        else n_rejected := n_rejected + 1;
        end if;

        results := results || jsonb_build_array(
            jsonb_strip_nulls(jsonb_build_object('id', ev_id, 'status', outcome, 'reason', reason)));
    end loop;

    return jsonb_build_object(
        'results', results,
        'accepted', n_accepted,
        'duplicates', n_duplicate,
        'rejected', n_rejected,
        'min_supported_version', public.min_supported_schema_version(),
        'server_time', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
end;
$$;

revoke all on function public.ingest_events(jsonb) from public, anon;
grant execute on function public.ingest_events(jsonb) to authenticated;

-- With ingest_events as the only write path, application roles no longer need INSERT (see 0003's closing note).
revoke insert on table public.events from authenticated, service_role;
