-- IC-01: complete SQL validation of ingest_events input, matching packages/contracts/src/events.ts (Zod 4.6.7).
-- Additive follow-up to 0004: migration 0004 is not edited (migrations are forward-only, never edited after merge).
-- The file number 0013 is NOT final: real migrations must stay contiguous, so it is renumbered when it is promoted
-- out of supabase/proposed-migrations (see docs/integrations/ingest-events.md and docs/team/open-questions-and-assumptions.md).
--
-- Contract (decided for IC-01):
--   * schema_version: contract first. A non-number, fractional, <= 0 or > 32767 value is REJECTED:INVALID_ENVELOPE
--     with detail 'schema_version'. A contract-valid version outside min/max_supported_schema_version() is
--     SCHEMA_VERSION_TOO_OLD / SCHEMA_VERSION_TOO_NEW (detail 'schema_version').
--   * UUIDs: exactly Zod z.uuid() (versions 1-8, variant 8/9/a/b, any case, nil and lowercase max accepted, uppercase
--     max rejected). The event id and OVERRIDE target_event_id additionally need version 7.
--   * Blank text: JavaScript String.prototype.trim() (U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A, U+2028,
--     U+2029, U+202F, U+205F, U+3000, U+FEFF).
--   * Response result: {id?, status, reason?, detail?}. id is echoed exactly as sent, and only when it is a valid
--     z.uuid() string. detail appears only on REJECTED results and is a field path ('facility_id',
--     'payload.fare_paise', 'event', 'payload'), never a message. An unknown key is reflected only when it matches
--     ^[A-Za-z0-9_]{1,40}$ ('envelope.<key>' / 'payload.<key>'), otherwise as 'envelope.?' / 'payload.?'. When there
--     are several unknown keys the first in byte (C collation) order is reported.
--   * Order of checks: envelope -> schema version -> device and facility claims -> active staff -> payload.
--
-- Differences from Zod that cannot be removed in PostgreSQL:
--   * Year 0000 is accepted by Zod but rejected by timestamptz.
--   * Fractional seconds beyond microseconds are rounded when stored.
--   * A JSON number such as 1.0000000000000001 is rounded to 1 by JavaScript but is exact (fractional) here.

-- OQ-42: PAPER_BACKFILL events may carry the time the paper record was keyed in. Optional, any source (as in zod).
-- Rows ingested before this column existed have NULL. NULL also means "the envelope did not carry recorded_at".
alter table public.events
    add column if not exists recorded_at timestamptz;


-- ---- value helpers (pure; NULL, a missing key and the wrong JSON type are all "not valid", never NULL) ----------------

create or replace function public.json_is_uuid(v jsonb) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    -- zod z.uuid(): versions 1-8 with an RFC variant, plus the nil and the (lower-case) max uuid.
    select case when jsonb_typeof(v) = 'string' then
        (v #>> '{}') ~ (
            '^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}'
            || '|00000000-0000-0000-0000-000000000000'
            || '|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
        )
    else false end
$$;

create or replace function public.json_is_uuid_v7(v jsonb) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select case when jsonb_typeof(v) = 'string' then
        (v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    else false end
$$;

-- A whole JSON number within JavaScript's safe-integer range (zod z.number().int()), at least min_value when given.
-- 1.0 counts as 1.
create or replace function public.json_is_int(v jsonb, min_value numeric default null) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select case when jsonb_typeof(v) = 'number' then
        (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
        and abs((v #>> '{}')::numeric) <= 9007199254740991
        and (min_value is null or (v #>> '{}')::numeric >= min_value)
    else false end
$$;

-- A string that is not empty after JavaScript trim() (zod z.string().trim().min(1)).
create or replace function public.json_is_nonblank_text(v jsonb) returns boolean
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select case when jsonb_typeof(v) = 'string' then
        (v #>> '{}') !~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$'
    else false end
$$;

-- UTC ISO 8601 with a trailing Z and no offset: the zod z.iso.datetime() default pattern (seconds required, any
-- number of fractional digits, hour 00-23, minute and second 00-59, leap-year-aware date), then the cast, which also
-- rejects year 0000.
create or replace function public.json_is_utc_time(v jsonb) returns boolean
    language plpgsql immutable parallel safe set search_path = pg_catalog
as $$
begin
    if jsonb_typeof(v) is distinct from 'string' then
        return false;
    end if;
    if (v #>> '{}') !~ (
        '^(?:(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29'
        || '|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])'
        || '|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)'
        || '|02-(?:0[1-9]|1[0-9]|2[0-8])))'
        || 'T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z$'
    ) then
        return false;
    end if;
    perform (v #>> '{}')::timestamptz;
    return true;
exception when others then
    return false;
end
$$;

-- The first key of obj outside allowed, in byte (C collation) order so the answer is deterministic; NULL when none.
create or replace function public.json_first_unknown_key(obj jsonb, allowed text[]) returns text
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select k from jsonb_object_keys(obj) k where k <> all (allowed) order by k collate "C" limit 1
$$;

-- 'prefix.key' for a safe key, 'prefix.?' otherwise: a response never reflects arbitrary client-controlled text.
create or replace function public.event_key_path(prefix text, k text) returns text
    language sql immutable parallel safe set search_path = pg_catalog
as $$
    select prefix || '.' || case when k ~ '^[A-Za-z0-9_]{1,40}$' then k else '?' end
$$;


-- ---- event validators -----------------------------------------------------------------------------------------------

-- NULL when the envelope is valid, otherwise the field path of the first problem. Mirrors the envelope in events.ts.
-- 'payload' means the payload key is missing or not an object (the caller picks the reason, see ingest_events).
create or replace function public.event_envelope_error(item jsonb) returns text
    language plpgsql immutable parallel safe set search_path = pg_catalog, public
as $$
declare
    allowed constant text[] := array['id', 'type', 'facility_id', 'device_id', 'staff_id', 'session_id',
                                     'device_time', 'recorded_at', 'source', 'schema_version', 'payload'];
    t text;
    k text;
begin
    if jsonb_typeof(item) is distinct from 'object' then return 'event'; end if;

    k := public.json_first_unknown_key(item, allowed);
    if k is not null then return public.event_key_path('envelope', k); end if;

    if not public.json_is_uuid_v7(item -> 'id') then return 'id'; end if;

    t := item ->> 'type';
    if jsonb_typeof(item -> 'type') is distinct from 'string'
       or t <> all (array['ENTRY', 'EXIT', 'PAYMENT', 'OVERRIDE', 'ZONE_COUNT', 'SHIFT_OPEN', 'SHIFT_CLOSE']) then
        return 'type';
    end if;

    if not public.json_is_uuid(item -> 'facility_id') then return 'facility_id'; end if;
    if not public.json_is_uuid(item -> 'device_id') then return 'device_id'; end if;
    if not public.json_is_uuid(item -> 'staff_id') then return 'staff_id'; end if;

    -- session_id must be present for every type: a uuid for session events, an explicit JSON null for the others.
    if t in ('ENTRY', 'EXIT', 'PAYMENT', 'OVERRIDE') then
        if not public.json_is_uuid(item -> 'session_id') then return 'session_id'; end if;
    elsif jsonb_typeof(item -> 'session_id') is distinct from 'null' then
        return 'session_id';
    end if;

    if not public.json_is_utc_time(item -> 'device_time') then return 'device_time'; end if;
    -- recorded_at is optional; an explicit JSON null is not a valid time and is rejected.
    if item ? 'recorded_at' and not public.json_is_utc_time(item -> 'recorded_at') then return 'recorded_at'; end if;

    if jsonb_typeof(item -> 'source') is distinct from 'string'
       or (item ->> 'source') <> all (array['LIVE', 'PAPER_BACKFILL']) then
        return 'source';
    end if;

    -- schema_version, contract part (z.number().int().positive().max(32767)). Server support is judged by ingest_events.
    if not public.json_is_int(item -> 'schema_version', 1) then return 'schema_version'; end if;
    if (item ->> 'schema_version')::numeric > 32767 then return 'schema_version'; end if;

    if jsonb_typeof(item -> 'payload') is distinct from 'object' then return 'payload'; end if;
    return null;
end
$$;

-- NULL when the payload is valid for the event type, otherwise 'payload', 'payload.<field>' or the reflected unknown
-- key. Mirrors the payload schemas in events.ts: unknown keys are rejected, optional keys may be absent but not null,
-- and the cross-field rules are included. Fields are checked in schema order.
create or replace function public.event_payload_error(event_type text, p jsonb) returns text
    language plpgsql immutable parallel safe set search_path = pg_catalog, public
as $$
declare
    allowed text[];
    k text;
begin
    if jsonb_typeof(p) is distinct from 'object' then return 'payload'; end if;

    allowed := case event_type
        when 'ENTRY' then array['vehicle_class', 'zone_id', 'short_code', 'vehicle_no', 'pass_id']
        when 'EXIT' then array['fare_paise', 'exit_method', 'tariff_id', 'tariff_version']
        when 'PAYMENT' then array['mode', 'amount_paise', 'upi_attested']
        when 'OVERRIDE' then array['target_event_id', 'reason_code', 'note', 'change']
        when 'ZONE_COUNT' then array['zone_id', 'counted', 'system_count_at_time']
        when 'SHIFT_OPEN' then array['shift_id', 'opening_float_paise']
        when 'SHIFT_CLOSE' then array['shift_id', 'counted_cash_paise', 'expected_cash_paise',
                                      'upi_total_declared_paise', 'upi_attested_sum_paise',
                                      'variance_cash_paise', 'variance_upi_paise', 'reason']
        else null
    end;
    if allowed is null then return 'type'; end if;

    k := public.json_first_unknown_key(p, allowed);
    if k is not null then return public.event_key_path('payload', k); end if;

    if event_type = 'ENTRY' then
        if not public.json_is_nonblank_text(p -> 'vehicle_class') then return 'payload.vehicle_class'; end if;
        if not public.json_is_uuid(p -> 'zone_id') then return 'payload.zone_id'; end if;
        if jsonb_typeof(p -> 'short_code') is distinct from 'string'
           or (p ->> 'short_code') !~ '^[0-9A-HJKMNP-TV-Z]{5}$' then
            return 'payload.short_code';
        end if;
        if p ? 'vehicle_no' and not public.json_is_nonblank_text(p -> 'vehicle_no') then
            return 'payload.vehicle_no';
        end if;
        if p ? 'pass_id' and not public.json_is_uuid(p -> 'pass_id') then return 'payload.pass_id'; end if;

    elsif event_type = 'EXIT' then
        if not public.json_is_int(p -> 'fare_paise', 0) then return 'payload.fare_paise'; end if;
        if jsonb_typeof(p -> 'exit_method') is distinct from 'string'
           or (p ->> 'exit_method') <> all (array['SCAN', 'CODE', 'LOOKUP']) then
            return 'payload.exit_method';
        end if;
        if p ? 'tariff_id' and not public.json_is_uuid(p -> 'tariff_id') then return 'payload.tariff_id'; end if;
        if p ? 'tariff_version' and not public.json_is_int(p -> 'tariff_version', 1) then
            return 'payload.tariff_version';
        end if;

    elsif event_type = 'PAYMENT' then
        if jsonb_typeof(p -> 'mode') is distinct from 'string'
           or (p ->> 'mode') <> all (array['CASH', 'UPI', 'PASS', 'WAIVED']) then
            return 'payload.mode';
        end if;
        if not public.json_is_int(p -> 'amount_paise', 0) then return 'payload.amount_paise'; end if;
        if jsonb_typeof(p -> 'upi_attested') is distinct from 'boolean' then return 'payload.upi_attested'; end if;
        if (p -> 'upi_attested') = 'true'::jsonb and (p ->> 'mode') <> 'UPI' then
            return 'payload.upi_attested';
        end if;

    elsif event_type = 'OVERRIDE' then
        if not public.json_is_uuid_v7(p -> 'target_event_id') then return 'payload.target_event_id'; end if;
        if jsonb_typeof(p -> 'reason_code') is distinct from 'string'
           or (p ->> 'reason_code') <> all (array['LOST_TOKEN', 'DAMAGED_TOKEN', 'MISREAD_NUMBER', 'WRONG_CLASS',
                                                  'OWNER_WAIVER', 'STAFF_VEHICLE', 'OTHER']) then
            return 'payload.reason_code';
        end if;
        if p ? 'note' and jsonb_typeof(p -> 'note') is distinct from 'string' then return 'payload.note'; end if;
        if p ? 'change' and jsonb_typeof(p -> 'change') is distinct from 'object' then return 'payload.change'; end if;
        -- reason OTHER needs a note that is not blank after JavaScript trim()
        if (p ->> 'reason_code') = 'OTHER' and not public.json_is_nonblank_text(p -> 'note') then
            return 'payload.note';
        end if;

    elsif event_type = 'ZONE_COUNT' then
        if not public.json_is_uuid(p -> 'zone_id') then return 'payload.zone_id'; end if;
        if not public.json_is_int(p -> 'counted', 0) then return 'payload.counted'; end if;
        if not public.json_is_int(p -> 'system_count_at_time', 0) then return 'payload.system_count_at_time'; end if;

    elsif event_type = 'SHIFT_OPEN' then
        if not public.json_is_uuid(p -> 'shift_id') then return 'payload.shift_id'; end if;
        if not public.json_is_int(p -> 'opening_float_paise', 0) then return 'payload.opening_float_paise'; end if;

    elsif event_type = 'SHIFT_CLOSE' then
        if not public.json_is_uuid(p -> 'shift_id') then return 'payload.shift_id'; end if;
        if not public.json_is_int(p -> 'counted_cash_paise', 0) then return 'payload.counted_cash_paise'; end if;
        if not public.json_is_int(p -> 'expected_cash_paise', 0) then return 'payload.expected_cash_paise'; end if;
        if not public.json_is_int(p -> 'upi_total_declared_paise', 0) then
            return 'payload.upi_total_declared_paise';
        end if;
        if not public.json_is_int(p -> 'upi_attested_sum_paise', 0) then
            return 'payload.upi_attested_sum_paise';
        end if;
        if not public.json_is_int(p -> 'variance_cash_paise') then return 'payload.variance_cash_paise'; end if;
        if not public.json_is_int(p -> 'variance_upi_paise') then return 'payload.variance_upi_paise'; end if;
        if p ? 'reason' and jsonb_typeof(p -> 'reason') is distinct from 'string' then return 'payload.reason'; end if;
    end if;

    return null;
end
$$;

-- The helpers are internal. The owner keeps EXECUTE, which is all the SECURITY DEFINER ingest_events needs.
revoke all on function
    public.json_is_uuid(jsonb),
    public.json_is_uuid_v7(jsonb),
    public.json_is_int(jsonb, numeric),
    public.json_is_nonblank_text(jsonb),
    public.json_is_utc_time(jsonb),
    public.json_first_unknown_key(jsonb, text[]),
    public.event_key_path(text, text),
    public.event_envelope_error(jsonb),
    public.event_payload_error(text, jsonb)
from public, anon, authenticated, service_role;


-- ---- ingest ---------------------------------------------------------------------------------------------------------

-- Same signature, security model, claim checks, counters and result structure as 0004. Changes: complete envelope and
-- payload validation through the validators above, an optional per-event detail, the id echoed exactly as sent when it
-- is a valid uuid, and recorded_at persisted and compared when an id is re-sent.
create or replace function public.ingest_events(events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
    max_batch constant integer := 500;
    dev public.devices%rowtype;
    item jsonb;
    ev_id uuid;
    ev_id_text text;
    ev_version integer;
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

    select * into dev
    from public.devices
    where auth_user_id = auth.uid() and revoked_at is null;

    if not found then
        raise exception 'caller is not an active enrolled device' using errcode = '42501';
    end if;

    if events is null or jsonb_typeof(events) <> 'array' then
        raise exception 'events must be a JSON array' using errcode = '22023';
    end if;

    if jsonb_array_length(events) > max_batch then
        raise exception 'batch too large (max %)', max_batch using errcode = '22023';
    end if;

    for item in select value from jsonb_array_elements(events)
    loop
        outcome := null;
        reason := null;
        detail := null;
        ev_id := null;
        ev_id_text := null;

        -- Echo the id exactly as sent, and only when it is a valid uuid; anything else is never reflected.
        if jsonb_typeof(item) = 'object' and public.json_is_uuid(item -> 'id') then
            ev_id_text := item ->> 'id';
        end if;

        begin
            -- 1. Envelope: complete format validation, so no cast below can fail.
            detail := public.event_envelope_error(item);
            if detail is not null then
                outcome := 'REJECTED';
                -- A payload key that is present but not an object is a payload problem; a missing key stays an
                -- envelope problem (unchanged from the earlier behaviour).
                reason := case when detail = 'payload' and item ? 'payload'
                               then 'INVALID_PAYLOAD' else 'INVALID_ENVELOPE' end;
            else
                ev_id := (item ->> 'id')::uuid;
                -- 2. Server support, separate from the contract check done above (1..32767 is already guaranteed).
                ev_version := ((item -> 'schema_version')::numeric)::integer;
                if ev_version < public.min_supported_schema_version() then
                    outcome := 'REJECTED'; reason := 'SCHEMA_VERSION_TOO_OLD'; detail := 'schema_version';
                elsif ev_version > public.max_supported_schema_version() then
                    outcome := 'REJECTED'; reason := 'SCHEMA_VERSION_TOO_NEW'; detail := 'schema_version';
                -- 3. Claims: the event must carry this device's own facility and device.
                elsif (item ->> 'facility_id')::uuid <> dev.facility_id or (item ->> 'device_id')::uuid <> dev.id then
                    outcome := 'REJECTED'; reason := 'CLAIM_MISMATCH'; detail := null;
                -- 4. Active staff of the device's facility.
                elsif not exists (
                    select 1
                    from public.staff s
                    where s.id = (item ->> 'staff_id')::uuid
                      and s.facility_id = dev.facility_id
                      and s.active
                ) then
                    outcome := 'REJECTED'; reason := 'STAFF_NOT_ACTIVE'; detail := null;
                end if;
            end if;

            -- 5. Payload: complete validation per event type, after identity and authorization, so an
            -- unauthorized caller learns nothing about payload rules.
            if outcome is null then
                detail := public.event_payload_error(item ->> 'type', item -> 'payload');
                if detail is not null then
                    outcome := 'REJECTED'; reason := 'INVALID_PAYLOAD';
                end if;
            end if;

            if outcome is null then
                insert into public.events (
                    id, facility_id, device_id, staff_id, type, session_id,
                    payload, device_time, recorded_at, source, schema_version
                )
                values (
                    ev_id, (item ->> 'facility_id')::uuid, (item ->> 'device_id')::uuid,
                    (item ->> 'staff_id')::uuid, item ->> 'type', (item ->> 'session_id')::uuid,
                    item -> 'payload', (item ->> 'device_time')::timestamptz,
                    (item ->> 'recorded_at')::timestamptz, item ->> 'source', ev_version
                )
                on conflict (id) do nothing
                returning id into inserted_id;

                if inserted_id is not null then
                    outcome := 'ACCEPTED';
                else
                    select * into existing from public.events where id = ev_id;

                    -- Same id re-sent unchanged is a harmless retry. Same id with different content (including a
                    -- different or newly added recorded_at) is a collision and must not be silently merged.
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
                        outcome := 'REJECTED';
                        reason := 'ID_COLLISION';
                    end if;
                end if;

                inserted_id := null;
            end if;

        exception
            -- Backstop only: the validators above should make these unreachable. The failed insert (if any) is
            -- rolled back with this block's subtransaction.
            when invalid_text_representation
               or invalid_datetime_format
               or datetime_field_overflow
               or numeric_value_out_of_range
               or check_violation
               or foreign_key_violation
               or not_null_violation
               or invalid_parameter_value then
                outcome := 'REJECTED';
                reason := 'INVALID_ENVELOPE';
                detail := null;
        end;

        if outcome = 'ACCEPTED' then
            n_accepted := n_accepted + 1;
        elsif outcome = 'DUPLICATE' then
            n_duplicate := n_duplicate + 1;
        else
            n_rejected := n_rejected + 1;
        end if;

        -- detail only ever accompanies a rejection.
        if outcome <> 'REJECTED' then
            detail := null;
        end if;

        results := results || jsonb_build_array(
            jsonb_strip_nulls(
                jsonb_build_object('id', ev_id_text, 'status', outcome, 'reason', reason, 'detail', detail)
            )
        );
    end loop;

    return jsonb_build_object(
        'results', results,
        'accepted', n_accepted,
        'duplicates', n_duplicate,
        'rejected', n_rejected,
        'min_supported_version', public.min_supported_schema_version(),
        'server_time', to_char(
            now() at time zone 'utc',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
    );
end;
$$;

revoke all on function public.ingest_events(jsonb) from public, anon;
grant execute on function public.ingest_events(jsonb) to authenticated;
revoke insert on table public.events from authenticated, service_role;
