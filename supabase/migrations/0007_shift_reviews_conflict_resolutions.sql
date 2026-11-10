-- 0007: shift_reviews and conflict_resolutions, the two tables the Console writes (CON-06, CON-07).
-- Columns follow docs/team/member-03-anamika.md (CON-06, CON-07; both marked R there). shift_reviews.facility_id is an
-- addition: a shift is not a table, so the facility cannot be looked up and the RLS policies (0010) need it.
-- Depends on 0006 (sync_conflicts). Policies come with 0010_rls.sql; until then RLS denies every non-superuser role.
-- Both tables are append-only for application roles: a second review or resolution is a newer row, never an update.
-- This file defines storage only: no resolve_conflict() function and no change to sync_conflicts.status. Which actions
-- close a conflict (OQ-49), the per-conflict-type action rules (CLOCK_SKEW allows only ADD_NOTE and ACKNOWLEDGE) and
-- rejecting an already-resolved conflict belong to resolve_conflict(), not to this file.

create table public.shift_reviews (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  shift_id uuid not null, -- the shift_id carried by SHIFT_OPEN / SHIFT_CLOSE events (no shifts table exists)
  reviewed_by uuid not null references auth.users (id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  status text not null check (status in ('approved', 'flagged')),
  note text,
  -- Duplicate-click guard from the CON-06 sheet. Scoped by facility like open_sessions: shift ids are generated on
  -- devices, so one facility must never be able to block another's review.
  unique (facility_id, shift_id, reviewed_by, status)
);
create index shift_reviews_facility_shift_idx on public.shift_reviews (facility_id, shift_id);

create table public.conflict_resolutions (
  id uuid primary key default gen_random_uuid(),
  conflict_id uuid not null references public.sync_conflicts (id) on delete restrict,
  -- Vocabulary of apps/console/src/lib/conflicts.ts and docs/integrations/console-backend-handoffs.md.
  action text not null
    check (action in ('KEEP_FIRST', 'KEEP_SECOND', 'MARK_AS_TEST_ENTRY', 'ADD_NOTE', 'ACKNOWLEDGE')),
  note text,
  resolved_by uuid not null references auth.users (id) on delete restrict,
  resolved_at timestamptz not null default now(),
  -- btrim() alone removes spaces only, so tabs, carriage returns and newlines are listed explicitly.
  check (action <> 'ADD_NOTE' or btrim(coalesce(note, ''), E' \t\r\n') <> '')
);
create index conflict_resolutions_conflict_idx on public.conflict_resolutions (conflict_id);

alter table public.shift_reviews enable row level security;
alter table public.conflict_resolutions enable row level security;

revoke all on table public.shift_reviews, public.conflict_resolutions from anon;
-- Insert is allowed by policy (0010); nothing else is. As with events (0003), service_role bypasses RLS, so the
-- append-only rule is also enforced with privileges. Neither revoke constrains the table owner or a superuser.
revoke update, delete, truncate, references, trigger on table public.shift_reviews, public.conflict_resolutions
  from authenticated, service_role;
