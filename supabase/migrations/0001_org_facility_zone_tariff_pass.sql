-- 0001: organizations, facilities, zones, tariffs, passes (CLD-02).
-- Column lists follow docs/team/member-04-akanksha.md CLD-02 step 1 (PRD appendix). Forward-only: never edit
-- after merge. RLS is enabled here and NO policies are defined; policies arrive with CLD-03 (0010_rls.sql),
-- so until then every non-superuser role sees nothing (deny by default). Money is integer paise.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) > 0),
  timezone text not null, -- IANA name; the KPI views convert device_time with it
  slot_count integer not null check (slot_count >= 0),
  created_at timestamptz not null default now(),
  -- lets child tables prove a facility belongs to the stated organization (tenant isolation)
  unique (id, org_id)
);
create index facilities_org_id_idx on public.facilities (org_id);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  name text not null check (length(btrim(name)) > 0),
  capacity integer not null check (capacity >= 0),
  vehicle_class text not null check (length(btrim(vehicle_class)) > 0),
  created_at timestamptz not null default now()
);
create index zones_facility_id_idx on public.zones (facility_id);

create table public.tariffs (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  vehicle_class text not null check (length(btrim(vehicle_class)) > 0),
  rule_json jsonb not null, -- tariff rule JSON (IC-04); its shape is owned by packages/domain, not validated here
  effective_from timestamptz not null,
  created_at timestamptz not null default now()
);
create index tariffs_lookup_idx on public.tariffs (facility_id, vehicle_class, effective_from);

create table public.passes (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  vehicle_no text not null check (length(btrim(vehicle_no)) > 0),
  valid_to date not null,
  dues integer not null default 0 check (dues >= 0), -- integer paise
  created_at timestamptz not null default now()
);
create index passes_facility_vehicle_idx on public.passes (facility_id, vehicle_no);

alter table public.organizations enable row level security;
alter table public.facilities enable row level security;
alter table public.zones enable row level security;
alter table public.tariffs enable row level security;
alter table public.passes enable row level security;

-- Defence in depth: the anonymous role never needs these tables ("no table readable by anon").
revoke all on table public.organizations, public.facilities, public.zones, public.tariffs, public.passes
  from anon;
