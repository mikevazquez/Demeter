CREATE OR REPLACE FUNCTION public.service_schedule_demi_followups(p_studio uuid, p_conversation uuid, p_kind text, p_source_ref text, p_source_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.assistant_conversations%rowtype; person uuid; delays interval[]; i integer; settings public.demi_followup_settings%rowtype; payment_group public.demi_group_bookings%rowtype; v_source_ref text:=p_source_ref; v_source_at timestamptz:=p_source_at;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into settings from public.demi_followup_settings where studio_id=p_studio and enabled;
 if not found then return jsonb_build_object('ok',false,'reason_code','followups_disabled'); end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio;
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 select person_id into person from public.students where id=c.student_id and studio_id=p_studio;
 if person is null then select person_id into person from public.crm_contacts where id=nullif(c.context->>'crm_contact_id','')::uuid and studio_id=p_studio; end if;
 if person is null then return jsonb_build_object('ok',false,'reason_code','identity_required'); end if;
 if nullif(p_source_ref,'') is null or p_source_at is null then return jsonb_build_object('ok',false,'reason_code','source_required'); end if;
 if p_kind='prospect' then
  select * into payment_group from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status='awaiting_receipt' order by created_at desc limit 1;
  if found then
   v_source_ref:='payment:'||payment_group.id; v_source_at:=payment_group.created_at;
   update public.demi_followups set state='cancelled',reason_code='payment_requested',lease_token=null,lease_until=null
    where studio_id=p_studio and conversation_id=p_conversation and kind='prospect' and source_ref<>('payment:'||payment_group.id) and state in ('pending','processing');
  end if;
 end if;
 if payment_group.id is not null then delays:=array[interval '2 hours',interval '6 hours'];
 elsif p_kind in ('prospect','post_trial') then delays:=array[make_interval(hours=>settings.prospect_interval_hours),make_interval(hours=>settings.prospect_interval_hours*2)];
 elsif p_kind in ('package','enrollment') then delays:=array[interval '7 days',interval '15 days',interval '30 days'];
 elsif p_kind='inactive' then delays:=array[interval '14 days'];
 elsif p_kind='package_expiring' then delays:=array[interval '-3 days'];
 elsif p_kind='package_expired' then delays:=array[interval '0 days'];
 else return jsonb_build_object('ok',false,'reason_code','invalid_kind'); end if;
 if p_kind in ('prospect','post_trial') and private.demi_group_has_active_reservation(p_studio,p_conversation) then return jsonb_build_object('ok',true,'steps',0,'reason_code','group_reservation_exists'); end if;
 for i in 1..array_length(delays,1) loop
  insert into public.demi_followups(studio_id,person_id,conversation_id,kind,source_ref,source_at,step,due_at)
  values(p_studio,person,c.id,p_kind,v_source_ref,v_source_at,i,v_source_at+delays[i]) on conflict do nothing;
 end loop;
 return jsonb_build_object('ok',true,'steps',array_length(delays,1));
end; $function$;


create function public.service_reselect_demi_paid_group(p_studio uuid,p_conversation uuid,p_group uuid,p_session uuid,p_resource uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype; c public.class_sessions%rowtype; price integer; curr text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if g.status not in ('awaiting_participants','partial') or (g.receipt_event_id is null and not exists(select 1 from public.demi_payment_requests where studio_id=p_studio and conversation_id=p_conversation and group_id=g.id and status='approved' and verified_at is not null)) then
  return jsonb_build_object('ok',false,'reason_code','verified_payment_required'); end if;
 if exists(select 1 from public.demi_group_participants where group_id=g.id and (reservation_id is not null or transfer_intent_id is not null or allocated_minor>0)) then
  return jsonb_build_object('ok',false,'reason_code','group_already_allocated'); end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.capacity-(select count(*) from public.reservations where studio_id=p_studio and session_id=c.id and status in ('reserved','attended'))<g.participant_count then return jsonb_build_object('ok',false,'reason_code','session_full'); end if;
 if c.requires_resource then
  if p_resource is null then return jsonb_build_object('ok',false,'reason_code','resource_selection_required'); end if;
  if not exists(select 1 from public.session_resources sr join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id where sr.studio_id=p_studio and sr.session_id=p_session and sr.resource_id=p_resource and sr.enabled and r.active and coalesce(sr.capacity_override,c.resource_uses_per_item,1)>(select count(*) from public.reservation_resource_assignments ra where ra.studio_id=p_studio and ra.session_id=p_session and ra.resource_id=p_resource and ra.released_at is null)) then return jsonb_build_object('ok',false,'reason_code','resource_not_available'); end if;
 elsif p_resource is not null then return jsonb_build_object('ok',false,'reason_code','resource_not_required'); end if;
 select drop_in_price_minor into price from public.class_templates where id=c.template_id and studio_id=p_studio;
 select currency into curr from public.studios where id=p_studio;
 if coalesce(price,0)<=0 or price*g.transfer_count<>g.amount_minor or curr<>g.currency then
  return jsonb_build_object('ok',false,'reason_code','paid_amount_does_not_match_alternative'); end if;
 update public.demi_group_bookings set session_id=p_session,resource_id=p_resource,status='awaiting_participants' where id=g.id;
 return jsonb_build_object('ok',true,'group_id',g.id,'status','awaiting_participants','amount_minor',g.amount_minor,'currency',g.currency,'participant_count',g.participant_count,'payment_preserved',true,'reservation_confirmed',false);
end; $$;
revoke all on function public.service_reselect_demi_paid_group(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_reselect_demi_paid_group(uuid,uuid,uuid,uuid,uuid) to service_role;

alter function private.demi_followup_stop_reason(public.demi_followups,timestamptz) rename to demi_followup_stop_reason_before_payment;
create function private.demi_followup_stop_reason(p_followup public.demi_followups,p_now timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype;
begin
 if p_followup.kind='prospect' and p_followup.source_ref like 'payment:%' then
  select * into g from public.demi_group_bookings where studio_id=p_followup.studio_id and conversation_id=p_followup.conversation_id and ('payment:'||id)=p_followup.source_ref;
  if not found then return 'payment_source_missing'; end if;
  if g.receipt_event_id is not null or exists(select 1 from public.demi_payment_requests where group_id=g.id and studio_id=g.studio_id and status='approved' and verified_at is not null) then return 'payment_received'; end if;
  if g.status<>'awaiting_receipt' then return 'payment_request_resolved'; end if;
  if not exists(select 1 from public.class_sessions where id=g.session_id and studio_id=g.studio_id and status='scheduled' and starts_at>p_now+interval '30 minutes') then return 'session_not_bookable'; end if;
 end if;
 return private.demi_followup_stop_reason_before_payment(p_followup,p_now);
end; $$;
revoke all on function private.demi_followup_stop_reason(public.demi_followups,timestamptz) from public,anon,authenticated;
grant execute on function private.demi_followup_stop_reason(public.demi_followups,timestamptz) to service_role;


create or replace function public.service_prepare_demi_prospect_payment(p_studio uuid,p_conversation uuid,p_contact uuid,p_session uuid,p_resource uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity_check jsonb; c public.class_sessions%rowtype; g public.demi_group_bookings%rowtype; preview jsonb; amount integer; curr text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 identity_check:=public.service_check_demi_minimal_identity(p_studio,p_conversation);
 if not coalesce((identity_check->>'ok')::boolean,false) then return identity_check; end if;
 if not exists(select 1 from public.assistant_conversations ac join public.crm_contacts cc on cc.id=p_contact and cc.studio_id=ac.studio_id where ac.id=p_conversation and ac.studio_id=p_studio and ac.student_id is null and ac.context->>'crm_contact_id'=p_contact::text) then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status in ('awaiting_receipt','awaiting_participants','partial') for update;
 if found then
  if g.prospect_contact_id is distinct from p_contact then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
  if g.session_id<>p_session or g.resource_id is distinct from p_resource then
   return public.service_reselect_demi_paid_group(p_studio,p_conversation,g.id,p_session,p_resource);
  end if;
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',1,'idempotent',true);
 end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.requires_resource then
  if p_resource is null then return jsonb_build_object('ok',false,'reason_code','resource_selection_required'); end if;
  if not exists(select 1 from public.session_resources sr join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id where sr.studio_id=p_studio and sr.session_id=p_session and sr.resource_id=p_resource and sr.enabled and r.active and coalesce(sr.capacity_override,c.resource_uses_per_item,1)>(select count(*) from public.reservation_resource_assignments ra where ra.studio_id=p_studio and ra.session_id=p_session and ra.resource_id=p_resource and ra.released_at is null)) then return jsonb_build_object('ok',false,'reason_code','resource_not_available'); end if;
 elsif p_resource is not null then return jsonb_build_object('ok',false,'reason_code','resource_not_required'); end if;
 preview:=public.assistant_trial_booking_preview(p_studio,p_session,null,p_contact);
 if not coalesce((preview->>'eligible')::boolean,false) then return preview||jsonb_build_object('ok',false); end if;
 amount:=coalesce((preview->>'amount_minor')::integer,(select drop_in_price_minor from public.class_templates where id=c.template_id and studio_id=p_studio));
 select currency into curr from public.studios where id=p_studio;
 if coalesce(amount,0)<=0 then return jsonb_build_object('ok',false,'reason_code','price_not_configured'); end if;
 insert into public.demi_group_bookings(studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency,prospect_contact_id,resource_id) values(p_studio,p_conversation,p_session,1,1,amount,curr,p_contact,p_resource) returning * into g;
 return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',1,'reservation_confirmed',false);
end; $$;

create or replace function public.service_prepare_demi_group(p_studio uuid,p_conversation uuid,p_session uuid,p_count integer,p_transfer_count integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity_check jsonb; c public.class_sessions%rowtype; g public.demi_group_bookings%rowtype; price integer; curr text; n integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 identity_check:=public.service_check_demi_minimal_identity(p_studio,p_conversation);
 if not coalesce((identity_check->>'ok')::boolean,false) then return identity_check; end if;
 if p_count not between 1 and 10 or p_transfer_count not between 1 and p_count then return jsonb_build_object('ok',false,'reason_code','invalid_count'); end if;
 if not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio) then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status in ('awaiting_receipt','awaiting_participants','partial') for update;
 if found then
  if g.participant_count<>p_count or g.transfer_count<>p_transfer_count then return jsonb_build_object('ok',false,'reason_code','group_already_pending'); end if;
  if g.session_id<>p_session then return public.service_reselect_demi_paid_group(p_studio,p_conversation,g.id,p_session,null); end if;
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'idempotent',true);
 end if;
 -- A retry of a completed group recovers the existing receipt and current reservations, never a new charge.
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and session_id=p_session and participant_count=p_count and transfer_count=p_transfer_count and status in ('provisional','validated') order by created_at desc limit 1 for update;
 if found then
  select count(*) into n from public.demi_group_participants gp join public.reservations r on r.id=gp.reservation_id and r.studio_id=p_studio where gp.group_id=g.id and r.status='reserved';
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',g.participant_count,'reserved_count',n,'reservation_confirmed',n=g.participant_count,'receipt_received',true,'payment_required',false,'payment_validation_required',g.status='provisional','existing_group_requires_review',n<>g.participant_count,'idempotent',true);
 end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.requires_resource then return jsonb_build_object('ok',false,'reason_code','group_resource_selection_required'); end if;
 if c.capacity-(select count(*) from public.reservations where session_id=c.id and status in ('reserved','attended'))<p_count then return jsonb_build_object('ok',false,'reason_code','session_full'); end if;
 select drop_in_price_minor into price from public.class_templates where id=c.template_id and studio_id=p_studio;
 select currency into curr from public.studios where id=p_studio;
 if coalesce(price,0)<=0 then return jsonb_build_object('ok',false,'reason_code','price_not_configured'); end if;
 insert into public.demi_group_bookings(studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency)
 values(p_studio,p_conversation,p_session,p_count,p_transfer_count,price*p_transfer_count,curr) returning * into g;
 return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'reservation_confirmed',false);
end; $$;

