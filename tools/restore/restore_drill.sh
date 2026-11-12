#!/usr/bin/env bash
# CLD-10 restore drill (LOCAL ONLY). Usage: bash tools/restore/restore_drill.sh [--synthetic]
#
# Dumps the app data of the local Supabase database (public schema + auth.users), restores the dump into a fresh
# scratch database, and compares row counts and a per-table checksum between source and restore. Exits non-zero on
# any restore error or mismatch. It talks only to the local container `supabase_db_<project_id>` through
# `docker exec`; it never connects to a hosted project and never writes to the `postgres` database.
#
# --synthetic  build the source in a throwaway database: auth.users from the local database, then every file in
#              supabase/migrations applied in order, then generated rows (including events, so the open_sessions and
#              sync_conflicts triggers of 0005/0006 produce derived rows). The drill therefore covers the schema in the
#              repository even when the local migration history is behind it. Without the flag the source is the
#              local `postgres` database as it is.
#
# What this proves: the dump/restore pipeline and the row checksums work on the local stack. The schema part of the
# fingerprint is only policy names, function signatures and view names. NOT verified: ACLs (pg_dump runs with --no-acl),
# policy predicates, function bodies, view definitions, indexes, RLS flags. It is NOT the production
# drill: that restores a real backup into a fresh hosted project and is a manual procedure (ops/runbook.md).
# Dumps here are plain files inside the container's /tmp and are removed on exit; production dumps must be encrypted.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would otherwise rewrite /tmp paths passed to docker exec

SYNTHETIC=0
[ "${1:-}" = "--synthetic" ] && SYNTHETIC=1

# Local only: a remote Docker host would make the container names below point at someone else's database.
if [ -n "${DOCKER_HOST:-}" ] || [ -n "${DOCKER_CONTEXT:-}" ]; then
  echo "restore_drill: refusing to run with DOCKER_HOST or DOCKER_CONTEXT set (local Docker only)" >&2; exit 2
fi

PROJECT_ID=$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -1)
[ -n "$PROJECT_ID" ] || { echo "restore_drill: project_id not found in supabase/config.toml (run from the repo root)" >&2; exit 2; }
C="${RESTORE_DRILL_CONTAINER:-supabase_db_${PROJECT_ID}}" # override exists for the failure tests
case "$C" in supabase_db_*) ;; *) echo "restore_drill: container name must start with supabase_db_" >&2; exit 2 ;; esac
docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null | grep -q true ||
  { echo "restore_drill: container $C is not running (npx supabase@2.122.0 start)" >&2; exit 2; }

PSQL=(docker exec -i "$C" psql -U postgres -X -q -v ON_ERROR_STOP=1)
SRC=postgres
DST=restore_drill_dst
TMP=/tmp/restore_drill
START=$(date +%s)

cleanup() {
  docker exec "$C" sh -c "rm -rf $TMP; dropdb -U postgres --if-exists $DST; dropdb -U postgres --if-exists restore_drill_src" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker exec "$C" mkdir -p "$TMP"

# Dump the app schema (tables, functions, views, policies) and auth.users separately: pg_dump cannot combine them.
dump() { # dump <db> <outfile-prefix>
  docker exec "$C" sh -c "
    pg_dump -U postgres -Fc --no-owner --no-acl -n public -f $TMP/$2-public.dump $1 &&
    pg_dump -U postgres -Fc --no-owner --no-acl -t auth.users -f $TMP/$2-auth.dump $1"
}

if [ "$SYNTHETIC" = 1 ]; then
  SRC=restore_drill_src
  ls supabase/migrations/*.sql >/dev/null 2>&1 || { echo "restore_drill: no supabase/migrations/*.sql (run from the repo root)" >&2; exit 2; }
  docker exec "$C" sh -c "pg_dump -U postgres -Fc --no-owner --no-acl -t auth.users -f $TMP/base-auth.dump postgres &&
    createdb -U postgres $SRC && psql -U postgres -d $SRC -qc 'create schema auth;' &&
    pg_restore -U postgres -d $SRC --no-owner --no-acl --exit-on-error $TMP/base-auth.dump"
  for f in supabase/migrations/*.sql; do # glob order is the numeric order (0001_, 0002_, ...)
    "${PSQL[@]}" -d "$SRC" <"$f" >/dev/null || { echo "restore_drill: applying $f to the scratch source failed" >&2; exit 1; }
  done
  "${PSQL[@]}" -d "$SRC" <<'SQL'
insert into public.organizations (name) select 'Org ' || g from generate_series(1, 3) g;
insert into public.facilities (org_id, name, timezone, slot_count)
  select o.id, 'Facility ' || g, 'Asia/Kolkata', 50 from public.organizations o, generate_series(1, 2) g;
insert into public.zones (facility_id, name, capacity, vehicle_class)
  select f.id, 'Zone ' || g, 10 + g, 'car' from public.facilities f, generate_series(1, 100) g;
insert into public.passes (facility_id, vehicle_no, valid_to, dues)
  select f.id, 'MH01' || lpad(g::text, 4, '0'), current_date + g, g * 100 from public.facilities f, generate_series(1, 300) g;
insert into public.staff (facility_id, name, pin_hash, pin_salt)
  select f.id, 'Guard ' || g, 'hash', 'salt' from public.facilities f, generate_series(1, 2) g;
insert into public.devices (facility_id, name) select f.id, 'Gate ' || g from public.facilities f, generate_series(1, 2) g;
-- 40 sessions per facility through the event log: every session enters, the first 25 exit, and session 1 exits twice
-- (a DUPLICATE_EXIT for the 0006 detector). The 0005 trigger keeps open_sessions; both derived tables get dumped.
create temp table drill_sessions as
  select f.id as facility_id,
         (select d.id from public.devices d where d.facility_id = f.id order by d.id limit 1) as device_id,
         (select s.id from public.staff s where s.facility_id = f.id order by s.id limit 1) as staff_id,
         (select z.id from public.zones z where z.facility_id = f.id order by z.id limit 1) as zone_id,
         g as n, gen_random_uuid() as session_id
  from public.facilities f, generate_series(1, 40) g;
insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
  select gen_random_uuid(), facility_id, device_id, staff_id, 'ENTRY', session_id, now() - interval '3 hours' + n * interval '1 minute', 1,
         jsonb_build_object('vehicle_class', 'car', 'zone_id', zone_id, 'short_code', 'D' || lpad(n::text, 4, '0'),
                            'vehicle_no', 'KA01DR' || lpad(n::text, 4, '0'))
  from drill_sessions;
insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
  select gen_random_uuid(), facility_id, device_id, staff_id, 'EXIT', session_id, now() - interval '1 hour' + n * interval '1 minute', 1,
         jsonb_build_object('fare_paise', 2000, 'exit_method', 'SCAN')
  from drill_sessions where n <= 25
  union all
  select gen_random_uuid(), facility_id, device_id, staff_id, 'EXIT', session_id, now() - interval '30 minutes', 1,
         jsonb_build_object('fare_paise', 2000, 'exit_method', 'SCAN')
  from drill_sessions where n = 1;
SQL
fi

dump "$SRC" drill
docker exec "$C" sh -c "createdb -U postgres $DST && psql -U postgres -d $DST -qc 'drop schema public; create schema auth;' &&
  pg_restore -U postgres -d $DST --no-owner --no-acl --exit-on-error $TMP/drill-auth.dump &&
  pg_restore -U postgres -d $DST --no-owner --no-acl --exit-on-error $TMP/drill-public.dump"

# Test-only hook (tools/restore/restore_drill.test.mjs): corrupt one restored row so the mismatch path is exercised.
if [ "${RESTORE_DRILL_TAMPER:-0}" = 1 ]; then
  docker exec -i "$C" psql -U postgres -X -q -v ON_ERROR_STOP=1 -d "$DST" -c "update public.zones set capacity = capacity + 1 where id = (select id from public.zones limit 1)" >/dev/null
fi

# One line per table: name|rows|md5 of the sorted row texts.
fingerprint_sql() {
  docker exec -i "$C" psql -U postgres -X -q -At -F '|' -d "$1" <<'SQL'
do $do$
declare q text;
begin
  select string_agg(format('select %L as t, count(*)::text as n, coalesce(md5(string_agg(x::text, ''|'' order by x::text)), ''empty'') as h from %s x', t, t), ' union all ' order by t)
    into q
  from (select format('%I.%I', schemaname, tablename) as t from pg_tables
        where schemaname = 'public' or (schemaname = 'auth' and tablename = 'users')) s;
  execute 'create temp table fp as ' || q;
end $do$;
select t, n, h from (
  select t, n, h from fp
  union all select 'schema:policies', count(*)::text, md5(coalesce(string_agg(tablename || '.' || policyname, ',' order by tablename, policyname), ''))
    from pg_policies where schemaname = 'public'
  union all select 'schema:functions', count(*)::text, md5(coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), ''))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all select 'schema:views', count(*)::text, md5(coalesce(string_agg(viewname, ',' order by viewname), ''))
    from pg_views where schemaname = 'public'
) u order by t;
SQL
}

A=$(fingerprint_sql "$SRC")
B=$(fingerprint_sql "$DST")
END=$(date +%s)
TABLES=$(printf '%s\n' "$A" | wc -l | tr -d ' ')
ROWS=$(printf '%s\n' "$A" | awk -F'|' '{s += $2} END {print s + 0}')

if [ "$A" = "$B" ] && [ -n "$A" ]; then
  RESULT=MATCH
else
  RESULT=MISMATCH
  diff <(printf '%s\n' "$A") <(printf '%s\n' "$B") || true
fi

echo "restore_drill: source=$SRC tables=$TABLES total_rows=$ROWS elapsed=$((END - START))s result=$RESULT"
printf '%s\n' "$A" | awk -F'|' '{printf "  %-28s rows=%-6s md5=%s\n", $1, $2, $3}'
echo "log row: | $(date -u +%F) | local $C ($([ "$SYNTHETIC" = 1 ] && echo synthetic || echo local data)) | $((END - START))s | $TABLES tables, $ROWS rows | $RESULT | $(git config user.name 2>/dev/null || echo unknown) |"
[ "$RESULT" = MATCH ]
