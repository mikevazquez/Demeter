-- Formal release of the expiry worker validated in Sandbox. No fixture data.
create or replace function private.workshop_expire_due_holds_cron(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_processed integer := 0;
begin
  if session_user <> 'postgres' then
    raise exception 'cron_postgres_only';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_batch_limit';
  end if;
  for v_id in
    select h.id
    from public.workshop_provisional_holds h
    where h.state = 'reserved_provisionally'
      and h.expires_at <= now()
    order by h.expires_at, h.id
    limit p_limit
    for update skip locked
  loop
    perform private.workshop_close_provisional_hold(v_id, 'expire', null);
    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$function$;

revoke all on function private.workshop_expire_due_holds_cron(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.workshop_expire_due_holds_cron(integer) to postgres;

-- Reuse the installed pg_cron extension. The worker makes no external calls.
select cron.schedule(
  'studio_flow_workshop_provisional_expiry',
  '* * * * *',
  'select private.workshop_expire_due_holds_cron(100);'
);
