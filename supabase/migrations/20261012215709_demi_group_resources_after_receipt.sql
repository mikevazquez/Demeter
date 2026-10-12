-- Preserve each environment's existing pricing/identity/payment logic.
-- Fail closed if the expected source fragments changed before this migration.
do $migration$
declare original text; changed text; needle text;
begin
 select pg_get_functiondef('public.service_prepare_demi_group(uuid,uuid,uuid,integer,integer)'::regprocedure) into original;
 needle := 'if c.requires_resource then return jsonb_build_object(''ok'',false,''reason_code'',''group_resource_selection_required''); end if;';
 if position(needle in original)=0 then raise exception 'unexpected_prepare_group_definition'; end if;
 changed := replace(original,needle,$replacement$
 if c.requires_resource and (
  select coalesce(sum(greatest(coalesce(sr.capacity_override,c.resource_uses_per_item,1)-
   (select count(*) from public.reservation_resource_assignments ra where ra.studio_id=p_studio and ra.session_id=c.id and ra.resource_id=sr.resource_id and ra.released_at is null),0)),0)
  from public.session_resources sr join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id
  where sr.studio_id=p_studio and sr.session_id=c.id and sr.enabled and r.active and r.space_id=c.space_id
 ) < p_count then return jsonb_build_object('ok',false,'reason_code','group_resources_unavailable','reservation_confirmed',false); end if;
 $replacement$);
 execute changed;

 select pg_get_functiondef('public.service_complete_demi_group(uuid,uuid,uuid,jsonb)'::regprocedure) into original;
 needle := 'declare g public.demi_group_bookings%rowtype;';
 if position(needle in original)=0 then raise exception 'unexpected_complete_group_declaration'; end if;
 changed := replace(original,needle,'declare v_group_session public.class_sessions%rowtype; chosen uuid; options jsonb; demand record; g public.demi_group_bookings%rowtype;');
 needle := 'for item in select value from jsonb_array_elements(p_participants) loop';
 if position(needle in changed)=0 then raise exception 'unexpected_complete_group_loop'; end if;
 changed := replace(changed,needle,$replacement$
 select * into v_group_session from public.class_sessions where id=g.session_id and studio_id=p_studio for update;
 if v_group_session.requires_resource then
  -- Check all choices before creating identities or any reservation.
  select coalesce(jsonb_agg(jsonb_build_object('resource_ref','resource:'||q.resource_id,'label',q.name,'available',q.available) order by q.name),'[]'::jsonb)
   into options from (
select sr.resource_id, r.name,
 greatest(coalesce(sr.capacity_override,v_group_session.resource_uses_per_item,1)-
  (select count(*) from public.reservation_resource_assignments ra
   where ra.studio_id=p_studio and ra.session_id=v_group_session.id and ra.resource_id=sr.resource_id and ra.released_at is null),0)::integer as available
from public.session_resources sr join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id
where sr.studio_id=p_studio and sr.session_id=v_group_session.id and sr.enabled and r.active and r.space_id=v_group_session.space_id) q where q.available>0;
  if exists(select 1 from jsonb_array_elements(p_participants) with ordinality x(value,ordinal)
    where not exists(select 1 from public.demi_group_participants gp where gp.group_id=g.id and gp.ordinal=x.ordinal and gp.reservation_id is not null)
    and coalesce(x.value->>'resource_ref',case when g.resource_id is not null then 'resource:'||g.resource_id end,'') !~ '^resource:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  then return jsonb_build_object('ok',false,'reason_code','group_resource_selection_required','payment_received',true,'reservation_confirmed',false,'resource_options',options); end if;
  -- Lock resources in canonical order, matching the existing resource booking bridge.
  perform 1 from public.resources r where r.studio_id=p_studio and r.id in (
    select sr.resource_id from public.session_resources sr where sr.studio_id=p_studio and sr.session_id=v_group_session.id)
    order by r.id for update;
  for demand in
   select substring(coalesce(x.value->>'resource_ref',case when g.resource_id is not null then 'resource:'||g.resource_id end) from 10)::uuid as id,count(*) as needed
   from jsonb_array_elements(p_participants) with ordinality x(value,ordinal)
   where not exists(select 1 from public.demi_group_participants gp where gp.group_id=g.id and gp.ordinal=x.ordinal and gp.reservation_id is not null)
   group by 1
  loop
   if not exists(select 1 from (
select sr.resource_id, r.name,
 greatest(coalesce(sr.capacity_override,v_group_session.resource_uses_per_item,1)-
  (select count(*) from public.reservation_resource_assignments ra
   where ra.studio_id=p_studio and ra.session_id=v_group_session.id and ra.resource_id=sr.resource_id and ra.released_at is null),0)::integer as available
from public.session_resources sr join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id
where sr.studio_id=p_studio and sr.session_id=v_group_session.id and sr.enabled and r.active and r.space_id=v_group_session.space_id) q where q.resource_id=demand.id and q.available>=demand.needed) then
    return jsonb_build_object('ok',false,'reason_code','group_resource_selection_required','selection_unavailable',true,'payment_received',true,'reservation_confirmed',false,'resource_options',options);
   end if;
  end loop;
 end if;
 for item in select value from jsonb_array_elements(p_participants) loop
 $replacement$);
 needle := 'idx:=idx+1;';
 if position(needle in changed)=0 then raise exception 'unexpected_complete_group_ordinal'; end if;
 changed := replace(changed,needle,$replacement$
 idx:=idx+1;
 chosen:=case when v_group_session.requires_resource then coalesce(nullif(substring(item->>'resource_ref' from 10),'')::uuid,g.resource_id) else null end;
 $replacement$);
 needle := 'public.service_prepare_trial_transfer(p_studio,child,st.id,g.session_id,g.resource_id)';
 if position(needle in changed)=0 then raise exception 'unexpected_group_trial_bridge'; end if;
 changed := replace(changed,needle,'public.service_prepare_trial_transfer(p_studio,child,st.id,g.session_id,chosen)');
 needle := 'r:=public.service_book_student(p_studio,g.session_id,st.id);';
 if position(needle in changed)=0 then raise exception 'unexpected_group_student_bridge'; end if;
 changed := replace(changed,needle,$replacement$
 if v_group_session.requires_resource then r:=public.service_book_student_with_resource(p_studio,g.session_id,st.id,chosen);
 else r:=public.service_book_student(p_studio,g.session_id,st.id); end if;
 $replacement$);
 execute changed;
end; $migration$;

