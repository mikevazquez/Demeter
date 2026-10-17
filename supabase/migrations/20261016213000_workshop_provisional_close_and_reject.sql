-- Sandbox development migration; never promote without explicit authorization.
create or replace function private.workshop_close_provisional_hold(p_hold_id uuid,p_action text,p_reason text default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_hold public.workshop_provisional_holds%rowtype; v_session uuid;
begin
 if p_hold_id is null or p_action not in ('reject','expire') or p_action is null then raise exception 'invalid_hold_action'; end if;
 select * into v_hold from public.workshop_provisional_holds where id=p_hold_id for update;
 if not found then raise exception 'hold_not_found'; end if;
 if v_hold.state in ('rejected','expired') then
   if (p_action='reject' and v_hold.state='rejected') or (p_action='expire' and v_hold.state='expired') then return v_hold.state; end if;
   raise exception 'invalid_hold_transition';
 end if;
 if v_hold.state <> 'reserved_provisionally' then raise exception 'invalid_hold_transition'; end if;
 if p_action='expire' and v_hold.expires_at>now() then raise exception 'hold_not_expired'; end if;
 if p_action='reject' and (p_reason is null or length(btrim(p_reason)) not between 1 and 500) then raise exception 'rejection_reason_required'; end if;
 for v_session in select session_id from public.workshop_provisional_hold_sessions where hold_id=p_hold_id order by session_id loop
   perform 1 from public.class_sessions where id=v_session and studio_id=v_hold.studio_id for update;
 end loop;
 update public.workshop_provisional_holds set state=case when p_action='reject' then 'rejected' else 'expired' end,
 rejection_reason=case when p_action='reject' then btrim(p_reason) else null end,updated_at=now()
 where id=p_hold_id;
 return case when p_action='reject' then 'rejected' else 'expired' end;
end $$;
revoke all on function private.workshop_close_provisional_hold(uuid,text,text) from public,anon,authenticated,service_role;
create or replace function public.admin_reject_workshop_provisional_hold(p_studio_id uuid,p_hold_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_state text;
begin
 if v_actor is null or auth.role() is distinct from 'authenticated'
   or not coalesce(private.has_capability(p_studio_id,'sales.write'),false)
   or not coalesce(private.has_capability(p_studio_id,'schedule.write'),false)
   or not exists(select 1 from public.user_accounts where id=v_actor and status='active')
 then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_provisional_holds where id=p_hold_id and studio_id=p_studio_id)
 then raise exception 'hold_not_found'; end if;
 v_state:=private.workshop_close_provisional_hold(p_hold_id,'reject',p_reason);
 return jsonb_build_object('hold_id',p_hold_id,'state',v_state);
end $$;
revoke all on function public.admin_reject_workshop_provisional_hold(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_reject_workshop_provisional_hold(uuid,uuid,text) to authenticated;
