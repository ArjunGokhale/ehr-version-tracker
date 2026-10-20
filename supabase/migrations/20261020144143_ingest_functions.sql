-- The scanner writes only through these functions, presenting a token whose hash is in ingest_tokens.
-- That keeps the service-role key out of CI: a leaked token can add scans, nothing else.

create or replace function public._check_ingest_token(p_token text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.ingest_tokens
    where token_sha256 = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  ) then
    raise exception 'invalid ingest token' using errcode = '28000';
  end if;
end;
$$;

create or replace function public._check_running(p_run_id bigint)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.scan_runs where id = p_run_id and status = 'running') then
    raise exception 'scan % is not running', p_run_id;
  end if;
end;
$$;

create or replace function public.ingest_start_scan(
  p_token text, p_trigger text, p_bundle_last_updated timestamptz, p_endpoint_count int
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform public._check_ingest_token(p_token);
  insert into public.scan_runs (trigger, bundle_last_updated, endpoint_count)
  values (p_trigger, p_bundle_last_updated, p_endpoint_count)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ingest_add_results(p_token text, p_run_id bigint, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  perform public._check_ingest_token(p_token);
  perform public._check_running(p_run_id);
  insert into public.server_results (
    run_id, address, host, endpoint_names, managing_orgs, brand_count, location_count, states,
    software_name, software_version, release_month, build_date, fhir_version, attempts, error
  )
  select p_run_id, r.address, r.host, r.endpoint_names, r.managing_orgs, r.brand_count,
         r.location_count, r.states, r.software_name, r.software_version, r.release_month,
         r.build_date, r.fhir_version, r.attempts, r.error
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
  insert into public.brands (org_id, name, kind, parent_org_id, addresses, city, state, last_seen_run)
  select r.org_id, r.name, r.kind, r.parent_org_id, r.addresses, r.city, r.state, p_run_id
  from jsonb_populate_recordset(null::public.brands, p_rows) r
  on conflict (org_id) do update set
    name = excluded.name, kind = excluded.kind, parent_org_id = excluded.parent_org_id,
    addresses = excluded.addresses, city = excluded.city, state = excluded.state,
    last_seen_run = excluded.last_seen_run;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.ingest_finish_scan(
  p_token text, p_run_id bigint, p_status text,
  p_server_count int, p_success_count int, p_failure_count int
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._check_ingest_token(p_token);
  perform public._check_running(p_run_id);
  update public.scan_runs set
    status = p_status, finished_at = now(), server_count = p_server_count,
    success_count = p_success_count, failure_count = p_failure_count
  where id = p_run_id;
  -- Brands dropped from Epic's bundle disappear only after a complete scan.
  if p_status = 'complete' then
    delete from public.brands where last_seen_run < p_run_id;
  end if;
end;
$$;

revoke execute on function public._check_ingest_token(text) from public, anon, authenticated;
revoke execute on function public._check_running(bigint) from public, anon, authenticated;
revoke execute on function public.ingest_start_scan(text, text, timestamptz, int) from public, authenticated;
revoke execute on function public.ingest_add_results(text, bigint, jsonb) from public, authenticated;
revoke execute on function public.ingest_upsert_brands(text, bigint, jsonb) from public, authenticated;
revoke execute on function public.ingest_finish_scan(text, bigint, text, int, int, int) from public, authenticated;
grant execute on function public.ingest_start_scan(text, text, timestamptz, int) to anon;
grant execute on function public.ingest_add_results(text, bigint, jsonb) to anon;
grant execute on function public.ingest_upsert_brands(text, bigint, jsonb) to anon;
grant execute on function public.ingest_finish_scan(text, bigint, text, int, int, int) to anon;
