-- 0002: staff, devices, memberships, enrollment_codes (CLD-02).
-- Column lists follow docs/team/member-04-akanksha.md CLD-02 step 2. Several columns are marked (R) there
-- (devices, enrollment_codes); open questions are tracked in docs/team/open-questions-and-assumptions.md
-- (staff.role and similar points are not yet registered there). This file defines storage only:
-- no enrollment function, no code generation and no policies (CLD-03). RLS is enabled with no policies, so
-- every non-superuser role is denied until 0010_rls.sql.

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  name text not null check (length(btrim(name)) > 0),
  phone text, -- optional (Console add-guard form); personal data, see OQ-12
  pin_hash text not null, -- salted hash only, never the PIN (IC-06)
  pin_salt text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index staff_facility_id_idx on public.staff (facility_id);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  name text not null check (char_length(name) between 1 and 60),
  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz,
  auth_user_id uuid unique references auth.users (id) on delete set null
);
create index devices_facility_id_idx on public.devices (facility_id);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id),
  facility_id uuid, -- null = organization-wide membership
  role text not null check (role in ('owner', 'manager', 'guard')),
  created_at timestamptz not null default now(),
  -- a facility reference must belong to the same organization (skipped when facility_id is null)
  foreign key (facility_id, org_id) references public.facilities (id, org_id),
  unique nulls not distinct (user_id, org_id, facility_id, role)
);
create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_org_id_idx on public.memberships (org_id);
create index memberships_facility_id_idx on public.memberships (facility_id);

-- Storage for one-time device enrollment codes. Only a hash is stored; the plaintext is shown once by the
-- Console. Hash algorithm, expiry length, attempt limiting and single-use enforcement belong to the
-- enrollment function (CLD-03, IC-05) and are not decided here. Expiry must be judged with database time.
create table public.enrollment_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  facility_id uuid not null references public.facilities (id),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at)
);
create index enrollment_codes_facility_id_idx on public.enrollment_codes (facility_id);

alter table public.staff enable row level security;
alter table public.devices enable row level security;
alter table public.memberships enable row level security;
alter table public.enrollment_codes enable row level security;

revoke all on table public.staff, public.devices, public.memberships, public.enrollment_codes from anon;
