-- Sandbox only. Conversion is fully transactional: no revenue on proof upload.
create or replace function public.admin_confirm_workshop_provisional_hold(
 p_studio_id uuid, p_hold_id uuid, p_received boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_hold public.workshop_provisional_holds%rowtype;
 v_sessions uuid[]; v_session uuid; v_auth jsonb; v_result jsonb;
begin
 if v_actor is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio_id,'sales.write'),false)
 or not coalesce(private.has_capability(p_studio_id,'schedule.write'),false)
 or not exists(select 1 from public.user_accounts where id=v_actor and status='active')
 or not exists(select 1 from public.studios where id=p_studio_id and status='active')
 then raise exception 'forbidden'; end if;
 if p_received is distinct from true then raise exception 'payment_not_verified'; end if;
 select * into v_hold from public.workshop_provisional_holds
 where id=p_hold_id and studio_id=p_studio_id for update;
 if not found then raise exception 'hold_not_found'; end if;
 if v_hold.state='confirmed' then
   select checkout_result into v_result from public.workshop_payment_authorizations
   where studio_id=p_studio_id and idempotency_key=v_hold.request_id
     and consumed_purchase_id is not null;
   if v_result is null then raise exception 'confirmed_without_checkout'; end if;
   return v_result||jsonb_build_object('hold_id',p_hold_id,'state','confirmed','replayed',true);
 end if;
 if v_hold.state<>'reserved_provisionally' then raise exception 'invalid_hold_transition'; end if;
 if v_hold.expires_at<=now() then raise exception 'hold_expired'; end if;
 select array_agg(session_id order by session_id) into v_sessions
 from public.workshop_provisional_hold_sessions where hold_id=p_hold_id;
 if v_sessions is null then raise exception 'hold_sessions_missing'; end if;
 -- Lock all seat rows in canonical order. Other checkouts wait for these locks.
 for v_session in select unnest(v_sessions) order by 1 loop
   perform 1 from public.class_sessions
   where id=v_session and studio_id=p_studio_id for update;
   if not found then raise exception 'session_unavailable'; end if;
 end loop;
 -- This transaction temporarily removes only this hold from capacity;
 -- any exception reverts state and every financial write.
 update public.workshop_provisional_holds set state='proof_received',updated_at=now()
 where id=p_hold_id;
 v_auth:=public.admin_authorize_workshop_payment(
 p_studio_id,v_hold.offer_id,v_hold.student_id,v_sessions,v_hold.selection_mode,
 v_hold.request_id,v_hold.amount_minor,v_hold.currency,'bank_transfer',
 v_hold.transfer_reference,true);
 v_result:=public.workshop_checkout_confirm_authorized(
 p_studio_id,(v_auth->>'authorization_id')::uuid,v_hold.request_id);
 update public.workshop_provisional_holds
 set state='confirmed',verified_by=v_actor,verified_at=now(),updated_at=now()
 where id=p_hold_id;
 return v_result||jsonb_build_object('hold_id',p_hold_id,'state','confirmed','replayed',false);
end $$;
revoke all on function public.admin_confirm_workshop_provisional_hold(uuid,uuid,boolean)
from public,anon,authenticated,service_role;
grant execute on function public.admin_confirm_workshop_provisional_hold(uuid,uuid,boolean)
to authenticated;