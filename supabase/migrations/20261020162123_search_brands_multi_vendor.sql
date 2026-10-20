-- The EHR filter is multi-select: search within any of several vendors.
drop function if exists public.search_brands(text, text, int);

create or replace function public.search_brands(p_query text, p_vendors text[] default null, p_limit int default 25)
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
      and (p_vendors is null or cardinality(p_vendors) = 0 or b.vendor = any(p_vendors))
    order by b.kind desc, b.name
    limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;
revoke execute on function public.search_brands(text, text[], int) from public, anon;
grant execute on function public.search_brands(text, text[], int) to authenticated;
