-- Extend from Epic-only to every certified EHR (endpoint directory from ONC Lantern).
alter table public.server_results
  add column vendor text,
  add column source text,
  add column endpoint_count int not null default 1,
  add column probe_url text;
update public.server_results set vendor = 'Epic Systems Corporation', source = 'epic-brands' where vendor is null;
create index server_results_vendor_idx on public.server_results (run_id, vendor);

alter table public.brands add column vendor text;
update public.brands set vendor = 'Epic Systems Corporation' where vendor is null;
create index brands_vendor_idx on public.brands (vendor);

create or replace function public.ingest_add_results(p_token text, p_run_id bigint, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  perform public._check_ingest_token(p_token);
  perform public._check_running(p_run_id);
  insert into public.server_results (
    run_id, address, host, endpoint_names, managing_orgs, brand_count, location_count, states,
    software_name, software_version, release_month, build_date, fhir_version, attempts, error,
    vendor, source, endpoint_count, probe_url
  )
  select p_run_id, r.address, r.host, r.endpoint_names, r.managing_orgs, r.brand_count,
         r.location_count, r.states, r.software_name, r.software_version, r.release_month,
         r.build_date, r.fhir_version, r.attempts, r.error,
         r.vendor, r.source, coalesce(r.endpoint_count, 1), r.probe_url
  from jsonb_populate_recordset(null::public.server_results, p_rows) r;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.ingest_upsert_brands(p_token text, p_run_id bigint, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  perform public._check_ingest_token(p_token);
  perform public._check_running(p_run_id);
  insert into public.brands (org_id, name, kind, parent_org_id, addresses, city, state, vendor, last_seen_run)
  select r.org_id, r.name, r.kind, r.parent_org_id, r.addresses, r.city, r.state, r.vendor, p_run_id
  from jsonb_populate_recordset(null::public.brands, p_rows) r
  on conflict (org_id) do update set
    name = excluded.name, kind = excluded.kind, parent_org_id = excluded.parent_org_id,
    addresses = excluded.addresses, city = excluded.city, state = excluded.state,
    vendor = excluded.vendor, last_seen_run = excluded.last_seen_run;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
