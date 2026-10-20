-- Keep the reader check out of the exposed API schema; policies can still call it.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_allowed_reader()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function private.is_allowed_reader() from public, anon;
grant execute on function private.is_allowed_reader() to authenticated;

drop policy "allowed readers" on public.scan_runs;
drop policy "allowed readers" on public.server_results;
drop policy "allowed readers" on public.brands;
create policy "allowed readers" on public.scan_runs for select to authenticated using ((select private.is_allowed_reader()));
create policy "allowed readers" on public.server_results for select to authenticated using ((select private.is_allowed_reader()));
create policy "allowed readers" on public.brands for select to authenticated using ((select private.is_allowed_reader()));

drop function public.is_allowed_reader();
