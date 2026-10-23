-- Sandbox only. Reconciles expired provisional holds; no payments or reservations.
create or replace function public.workshop_expire_provisional_holds(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_processed integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
 if p_limit is null or p_limit<1 or p_limit>200 then raise exception 'invalid_batch_limit'; end if;
 for v_id in
   select id from public.workshop_provisional_holds
   where state='reserved_provisionally' and expires_at<=now()
   order by expires_at,id limit p_limit for update skip locked
 loop
   perform private.workshop_close_provisional_hold(v_id,'expire',null);
   v_processed:=v_processed+1;
 end loop;
 return v_processed;
end $$;
revoke all on function public.workshop_expire_provisional_holds(integer)
 from public,anon,authenticated,service_role;
grant execute on function public.workshop_expire_provisional_holds(integer) to service_role;
