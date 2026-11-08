-- SYNC-02 (part 1): idempotent, batched event ingestion.
-- Decision (Afzal): ingest_events is SECURITY DEFINER. Devices get EXECUTE on the function only; they hold no INSERT
-- privilege on public.events, so a device cannot write events by any other route. The function therefore has to
-- verify every claim itself: the caller must be an enrolled, non-revoked device, and each event must carry that
-- device's own facility_id and device_id and an active staff member of that facility.
--
-- Validation: EXECUTE is granted to authenticated users, so a caller can invoke the function directly and bypass the
-- gate app's zod validation. The database therefore validates every event completely (envelope AND payload) with
-- event_envelope_error / event_payload_error, which mirror packages/contracts/src/events.ts. Zod stays the source of
-- truth; supabase/tests/event_parity.test.sql (generated from packages/contracts/fixtures/events) runs the shared
-- fixtures through ingest_events and fails when SQL and zod disagree. Change both together.

-- OQ-42: PAPER_BACKFILL events may carry the time the paper record was keyed in. Optional, any source (as in zod).
alter table public.events add column recorded_at timestamptz;

-- Schema versions this database accepts. Bump max_supported together with SCHEMA_VERSION in packages/contracts.
create function public.min_supported_schema_version() returns integer
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select 1 $$;
create function public.max_supported_schema_version() returns integer
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select 1 $$;

-- ---- value checks (pure helpers; NULL input is "not valid") ---------------------------------------------------------

create function public.json_is_uuid(v jsonb) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    -- zod's z.uuid(): versions 1-8 with an RFC variant, plus the nil and max uuids. Case-insensitive.
    select coalesce(jsonb_typeof(v) = 'string' and (v #>> '{}') ~*
        '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        false)
$$;

create function public.json_is_uuid_v7(v jsonb) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select coalesce(jsonb_typeof(v) = 'string'
        and (v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
$$;

-- A whole number within JavaScript's safe-integer range (zod z.number().int()), at least `min`. 1.0 counts as 1.
create function public.json_is_int(v jsonb, min_value numeric default null) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select coalesce(
        jsonb_typeof(v) = 'number'
        and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
        and abs((v #>> '{}')::numeric) <= 9007199254740991
        and (min_value is null or (v #>> '{}')::numeric >= min_value),
        false)
$$;

create function public.json_is_nonblank_text(v jsonb) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select coalesce(jsonb_typeof(v) = 'string' and btrim(v #>> '{}', E' \t\n\r\f\v') <> '', false)
$$;

-- UTC ISO 8601 with a trailing Z and no offset (zod z.iso.datetime()); the date and time must be real.
create function public.json_is_utc_time(v jsonb) returns boolean
    language plpgsql immutable parallel safe set search_path = pg_catalog
as $$
begin
    if jsonb_typeof(v) is distinct from 'string'
       or (v #>> '{}') !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?Z$' then
        return false;
    end if;
    perform (v #>> '{}')::timestamptz;  -- rejects 02-30 and similar
    return true;
exception when others then
    return false;
end
$$;

-- True when `obj` has no key outside `allowed`.
create function public.json_keys_within(obj jsonb, allowed text[]) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select not exists (select 1 from jsonb_object_keys(obj) k where k <> all (allowed))
$$;

-- ---- event validators ---------------------------------------------------------------------------------------------

-- NULL when the envelope is valid, otherwise the name of the first offending field. Mirrors the envelope in events.ts.
-- The schema_version RANGE is judged by ingest_events (min/max supported); here it only has to be a whole number.
create function public.event_envelope_error(item jsonb) returns text
    language plpgsql immutable parallel safe set search_path = pg_catalog, public
as $$
declare
    t text;
begin
    if jsonb_typeof(item) is distinct from 'object' then return 'event'; end if;
    if not public.json_keys_within(item, array['id', 'type', 'facility_id', 'device_id', 'staff_id', 'session_id',
                                               'device_time', 'recorded_at', 'source', 'schema_version',
                                               'payload']) then
        return 'unknown key';
    end if;
    if not public.json_is_uuid_v7(item -> 'id') then return 'id'; end if;
    t := item ->> 'type';
    if jsonb_typeof(item -> 'type') is distinct from 'string'
       or t <> all (array['ENTRY', 'EXIT', 'PAYMENT', 'OVERRIDE', 'ZONE_COUNT', 'SHIFT_OPEN', 'SHIFT_CLOSE']) then
        return 'type';
    end if;
    if not public.json_is_uuid(item -> 'facility_id') then return 'facility_id'; end if;
    if not public.json_is_uuid(item -> 'device_id') then return 'device_id'; end if;
    if not public.json_is_uuid(item -> 'staff_id') then return 'staff_id'; end if;
    -- session_id: a uuid for session events, null (or absent from JSON null) for the others
    if t in ('ENTRY', 'EXIT', 'PAYMENT', 'OVERRIDE') then
        if not public.json_is_uuid(item -> 'session_id') then return 'session_id'; end if;
    elsif jsonb_typeof(item -> 'session_id') is distinct from 'null' then
        return 'session_id';
    end if;
    if not public.json_is_utc_time(item -> 'device_time') then return 'device_time'; end if;
    if item ? 'recorded_at' and not public.json_is_utc_time(item -> 'recorded_at') then return 'recorded_at'; end if;
    if jsonb_typeof(item -> 'source') is distinct from 'string'
       or (item ->> 'source') <> all (array['LIVE', 'PAPER_BACKFILL']) then
        return 'source';
    end if;
    if not public.json_is_int(item -> 'schema_version') then return 'schema_version'; end if;
    if jsonb_typeof(item -> 'payload') is distinct from 'object' then return 'payload'; end if;
    return null;
end
$$;

-- NULL when the payload is valid for the event type, otherwise "payload.<field>". Mirrors the payload schemas in events.ts:
-- unknown keys are rejected, optional keys may be absent but not null, and the cross-field rules are included.
create function public.event_payload_error(event_type text, p jsonb) returns text
    language plpgsql immutable parallel safe set search_path = pg_catalog, public
as $$
begin
    if jsonb_typeof(p) is distinct from 'object' then return 'payload'; end if;
    case event_type
    when 'ENTRY' then
        if not public.json_keys_within(p, array['vehicle_class', 'zone_id', 'short_code', 'vehicle_no', 'pass_id']) then
            return 'payload unknown key';
        end if;
        if not public.json_is_nonblank_text(p -> 'vehicle_class') then return 'payload.vehicle_class'; end if;
        if not public.json_is_uuid(p -> 'zone_id') then return 'payload.zone_id'; end if;
        if jsonb_typeof(p -> 'short_code') is distinct from 'string'
           or (p ->> 'short_code') !~ '^[0-9A-HJKMNP-TV-Z]{5}$' then
            return 'payload.short_code';
        end if;
        if p ? 'vehicle_no' and not public.json_is_nonblank_text(p -> 'vehicle_no') then return 'payload.vehicle_no'; end if;
        if p ? 'pass_id' and not public.json_is_uuid(p -> 'pass_id') then return 'payload.pass_id'; end if;
    when 'EXIT' then
        if not public.json_keys_within(p, array['fare_paise', 'exit_method', 'tariff_id', 'tariff_version']) then
            return 'payload unknown key';
        end if;
        if not public.json_is_int(p -> 'fare_paise', 0) then return 'payload.fare_paise'; end if;
        if jsonb_typeof(p -> 'exit_method') is distinct from 'string'
           or (p ->> 'exit_method') <> all (array['SCAN', 'CODE', 'LOOKUP']) then
            return 'payload.exit_method';
        end if;
        if p ? 'tariff_id' and not public.json_is_uuid(p -> 'tariff_id') then return 'payload.tariff_id'; end if;
        if p ? 'tariff_version' and not public.json_is_int(p -> 'tariff_version', 1) then
            return 'payload.tariff_version';
        end if;
    when 'PAYMENT' then
        if not public.json_keys_within(p, array['mode', 'amount_paise', 'upi_attested']) then
            return 'payload unknown key';
        end if;
        if jsonb_typeof(p -> 'mode') is distinct from 'string'
           or (p ->> 'mode') <> all (array['CASH', 'UPI', 'PASS', 'WAIVED']) then
            return 'payload.mode';
        end if;
        if not public.json_is_int(p -> 'amount_paise', 0) then return 'payload.amount_paise'; end if;
        if jsonb_typeof(p -> 'upi_attested') is distinct from 'boolean' then return 'payload.upi_attested'; end if;
        if (p -> 'upi_attested') = 'true'::jsonb and (p ->> 'mode') <> 'UPI' then return 'payload.upi_attested'; end if;
    when 'OVERRIDE' then
        if not public.json_keys_within(p, array['target_event_id', 'reason_code', 'note', 'change']) then
            return 'payload unknown key';
        end if;
        if not public.json_is_uuid_v7(p -> 'target_event_id') then return 'payload.target_event_id'; end if;
        if jsonb_typeof(p -> 'reason_code') is distinct from 'string' or (p ->> 'reason_code') <> all (array[
               'LOST_TOKEN', 'DAMAGED_TOKEN', 'MISREAD_NUMBER', 'WRONG_CLASS', 'OWNER_WAIVER', 'STAFF_VEHICLE',
               'OTHER']) then
            return 'payload.reason_code';
        end if;
        if p ? 'note' and jsonb_typeof(p -> 'note') is distinct from 'string' then return 'payload.note'; end if;
        if p ? 'change' and jsonb_typeof(p -> 'change') is distinct from 'object' then return 'payload.change'; end if;
        if (p ->> 'reason_code') = 'OTHER'
           and btrim(coalesce(p ->> 'note', ''), E' \t\n\r\f\v') = '' then
            return 'payload.note';
        end if;
    when 'ZONE_COUNT' then
        if not public.json_keys_within(p, array['zone_id', 'counted', 'system_count_at_time']) then
            return 'payload unknown key';
        end if;
        if not public.json_is_uuid(p -> 'zone_id') then return 'payload.zone_id'; end if;
        if not public.json_is_int(p -> 'counted', 0) then return 'payload.counted'; end if;
        if not public.json_is_int(p -> 'system_count_at_time', 0) then return 'payload.system_count_at_time'; end if;
    when 'SHIFT_OPEN' then
        if not public.json_keys_within(p, array['shift_id', 'opening_float_paise']) then
            return 'payload unknown key';
        end if;
        if not public.json_is_uuid(p -> 'shift_id') then return 'payload.shift_id'; end if;
        if not public.json_is_int(p -> 'opening_float_paise', 0) then return 'payload.opening_float_paise'; end if;
    when 'SHIFT_CLOSE' then
        if not public.json_keys_within(p, array['shift_id', 'counted_cash_paise', 'expected_cash_paise',
                                                'upi_total_declared_paise', 'upi_attested_sum_paise',
                                                'variance_cash_paise', 'variance_upi_paise', 'reason']) then
            return 'payload unknown key';
        end if;
        if not public.json_is_uuid(p -> 'shift_id') then return 'payload.shift_id'; end if;
        if not public.json_is_int(p -> 'counted_cash_paise', 0) then return 'payload.counted_cash_paise'; end if;
        if not public.json_is_int(p -> 'expected_cash_paise', 0) then return 'payload.expected_cash_paise'; end if;
        if not public.json_is_int(p -> 'upi_total_declared_paise', 0) then return 'payload.upi_total_declared_paise'; end if;
        if not public.json_is_int(p -> 'upi_attested_sum_paise', 0) then return 'payload.upi_attested_sum_paise'; end if;
        if not public.json_is_int(p -> 'variance_cash_paise') then return 'payload.variance_cash_paise'; end if;
        if not public.json_is_int(p -> 'variance_upi_paise') then return 'payload.variance_upi_paise'; end if;
        if p ? 'reason' and jsonb_typeof(p -> 'reason') is distinct from 'string' then return 'payload.reason'; end if;
    else
        return 'type';
    end case;
    return null;
end
$$;

revoke all on function
    public.json_is_uuid(jsonb), public.json_is_uuid_v7(jsonb), public.json_is_int(jsonb, numeric),
    public.json_is_nonblank_text(jsonb), public.json_is_utc_time(jsonb), public.json_keys_within(jsonb, text[]),
    public.event_envelope_error(jsonb), public.event_payload_error(text, jsonb)
from public, anon, authenticated;

-- ---- ingest -----------------------------------------------------------------------------------------------------------

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
    ev_version integer;
    version_number numeric;
    inserted_id uuid;
    existing public.events%rowtype;
    results jsonb := '[]'::jsonb;
    n_accepted integer := 0;
    n_duplicate integer := 0;
    n_rejected integer := 0;
    outcome text;
    reason text;
    detail text;
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
        detail := null;
        ev_id := null;

        begin
            -- 1. Envelope: complete format validation, no cast can fail afterwards.
            detail := public.event_envelope_error(item);
            if detail is not null then
                -- Echo the id when it is readable so the device can match the result to its row.
                if public.json_is_uuid(item -> 'id') then ev_id := (item ->> 'id')::uuid; end if;
                outcome := 'REJECTED';
                reason := case when detail = 'payload' then 'INVALID_PAYLOAD' else 'INVALID_ENVELOPE' end;
            else
                ev_id := (item ->> 'id')::uuid;
                -- schema_version: a whole number (1.0 is the same number as 1; the contract accepts it too), then the range.
                version_number := (item -> 'schema_version')::numeric;
                if version_number not between -2147483648 and 2147483647 then
                    outcome := 'REJECTED'; reason := 'INVALID_ENVELOPE'; detail := 'schema_version';
                else
                    ev_version := version_number::integer;
                    if ev_version < public.min_supported_schema_version() then
                        outcome := 'REJECTED'; reason := 'SCHEMA_VERSION_TOO_OLD'; detail := 'schema_version';
                    elsif ev_version > public.max_supported_schema_version() then
                        outcome := 'REJECTED'; reason := 'SCHEMA_VERSION_TOO_NEW'; detail := 'schema_version';
                    elsif (item ->> 'facility_id')::uuid <> dev.facility_id or (item ->> 'device_id')::uuid <> dev.id then
                        outcome := 'REJECTED'; reason := 'CLAIM_MISMATCH'; detail := null;
                    elsif not exists (
                        select 1 from public.staff s
                        where s.id = (item ->> 'staff_id')::uuid and s.facility_id = dev.facility_id and s.active
                    ) then
                        outcome := 'REJECTED'; reason := 'STAFF_NOT_ACTIVE'; detail := null;
                    end if;
                end if;
            end if;

            -- 2. Payload: complete validation per event type, after identity and authorization.
            if outcome is null then
                detail := public.event_payload_error(item ->> 'type', item -> 'payload');
                if detail is not null then
                    outcome := 'REJECTED'; reason := 'INVALID_PAYLOAD';
                end if;
            end if;

            if outcome is null then
                insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload,
                                           device_time, recorded_at, source, schema_version)
                values (ev_id, (item ->> 'facility_id')::uuid, (item ->> 'device_id')::uuid,
                        (item ->> 'staff_id')::uuid, item ->> 'type', (item ->> 'session_id')::uuid, item -> 'payload',
                        (item ->> 'device_time')::timestamptz, (item ->> 'recorded_at')::timestamptz,
                        item ->> 'source', ev_version)
                on conflict (id) do nothing
                returning id into inserted_id;

                if inserted_id is not null then
                    outcome := 'ACCEPTED';
                else
                    select * into existing from public.events where id = ev_id;
                    -- Same id re-sent unchanged is a harmless retry. Same id with different content (or from
                    -- another facility) is a collision and must not be silently merged.
                    if existing.facility_id = (item ->> 'facility_id')::uuid
                       and existing.device_id = (item ->> 'device_id')::uuid
                       and existing.staff_id = (item ->> 'staff_id')::uuid
                       and existing.type = item ->> 'type'
                       and existing.session_id is not distinct from (item ->> 'session_id')::uuid
                       and existing.device_time = (item ->> 'device_time')::timestamptz
                       and existing.recorded_at is not distinct from (item ->> 'recorded_at')::timestamptz
                       and existing.source = item ->> 'source'
                       and existing.schema_version = ev_version
                       and existing.payload = item -> 'payload' then
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
                -- Backstop only: the validators above should make these unreachable. The failed insert (if any) is
                -- rolled back with this block's subtransaction.
                outcome := 'REJECTED'; reason := 'INVALID_ENVELOPE'; detail := 'unexpected';
        end;

        if outcome = 'ACCEPTED' then n_accepted := n_accepted + 1;
        elsif outcome = 'DUPLICATE' then n_duplicate := n_duplicate + 1;
        else n_rejected := n_rejected + 1;
        end if;

        results := results || jsonb_build_array(
            jsonb_strip_nulls(jsonb_build_object('id', ev_id, 'status', outcome, 'reason', reason, 'detail', detail)));
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
