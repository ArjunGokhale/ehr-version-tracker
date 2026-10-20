create extension if not exists pg_trgm with schema extensions;

-- One row per scan of Epic's Brands bundle.
create table public.scan_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  trigger text,
  bundle_last_updated timestamptz,
  endpoint_count int,
  server_count int,
  success_count int,
  failure_count int
);

-- One row per unique FHIR server (normalized address) per scan.
create table public.server_results (
  run_id bigint not null references public.scan_runs(id) on delete cascade,
  address text not null,
  host text,
  endpoint_names text[] not null default '{}',
  managing_orgs text[] not null default '{}',
  brand_count int not null default 0,
  location_count int not null default 0,
  states text[] not null default '{}',
  software_name text,
  software_version text,
  release_month date,
  build_date date,
  fhir_version text,
  attempts int,
  error text,
  primary key (run_id, address)
);
create index server_results_version_idx on public.server_results (run_id, release_month);

-- Current directory of brands (primary + location), refreshed each scan, for name search.
create table public.brands (
  org_id text primary key,
  name text not null,
  kind text not null check (kind in ('primary', 'location')),
  parent_org_id text,
  addresses text[] not null default '{}',
  city text,
  state text,
  last_seen_run bigint not null references public.scan_runs(id) on delete cascade
);
create index brands_name_trgm_idx on public.brands using gin (name extensions.gin_trgm_ops);

-- Logins allowed to read data. Signing up alone grants nothing.
create table public.allowed_users (email text primary key);

-- sha256 of the token the scanner presents; only reachable through security-definer functions.
create table public.ingest_tokens (
  token_sha256 text primary key,
  label text,
  created_at timestamptz not null default now()
);

alter table public.scan_runs enable row level security;
alter table public.server_results enable row level security;
alter table public.brands enable row level security;
alter table public.allowed_users enable row level security;
alter table public.ingest_tokens enable row level security;

create or replace function public.is_allowed_reader()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function public.is_allowed_reader() from public, anon;
grant execute on function public.is_allowed_reader() to authenticated;

create policy "allowed readers" on public.scan_runs for select to authenticated using (public.is_allowed_reader());
create policy "allowed readers" on public.server_results for select to authenticated using (public.is_allowed_reader());
create policy "allowed readers" on public.brands for select to authenticated using (public.is_allowed_reader());
