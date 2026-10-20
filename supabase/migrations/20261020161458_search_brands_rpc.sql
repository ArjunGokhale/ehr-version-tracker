-- Name search over brands. Under RLS, ILIKE (not leakproof) can't use the trigram index and
-- every search seq-scans ~256k rows; this definer function checks the reader allowlist
-- itself and then runs the indexed query.
create or replace function public.search_brands(p_query text, p_vendor text default null, p_limit int default 25)
returns table (org_id text, name text, kind text, city text, state text, vendor text, addresses text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_allowed_reader() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_query, ''))) < 3 then
    return;
  end if;
  return query
    select b.org_id, b.name, b.kind, b.city, b.state, b.vendor, b.addresses
    from public.brands b
    where b.name ilike '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      and (p_vendor is null or b.vendor = p_vendor)
    order by b.kind desc, b.name
    limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;
revoke execute on function public.search_brands(text, text, int) from public, anon;
grant execute on function public.search_brands(text, text, int) to authenticated;
