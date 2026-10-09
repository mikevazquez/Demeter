create function private.demi_group_has_active_reservation(p_studio uuid,p_conversation uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.demi_group_bookings g join public.demi_group_participants gp on gp.group_id=g.id join public.reservations r on r.id=gp.reservation_id and r.studio_id=g.studio_id where g.studio_id=p_studio and g.conversation_id=p_conversation and g.status in ('provisional','validated','partial') and r.status='reserved');
$$;
revoke all on function private.demi_group_has_active_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function private.demi_group_has_active_reservation(uuid,uuid) to service_role;

create or replace function public.service_schedule_demi_followups(p_studio uuid,p_conversation uuid,p_kind text,p_source_ref text,p_source_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.assistant_conversations%rowtype; person uuid; delays interval[]; i integer; settings public.demi_followup_settings%rowtype;
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
 if p_kind in ('prospect','post_trial') then delays:=array[make_interval(hours=>settings.prospect_interval_hours),make_interval(hours=>settings.prospect_interval_hours*2)];
 elsif p_kind in ('package','enrollment') then delays:=array[interval '7 days',interval '15 days',interval '30 days'];
 elsif p_kind='inactive' then delays:=array[interval '14 days'];
 elsif p_kind='package_expiring' then delays:=array[interval '-3 days'];
 elsif p_kind='package_expired' then delays:=array[interval '0 days'];
 else return jsonb_build_object('ok',false,'reason_code','invalid_kind'); end if;
 if p_kind in ('prospect','post_trial') and private.demi_group_has_active_reservation(p_studio,p_conversation) then return jsonb_build_object('ok',true,'steps',0,'reason_code','group_reservation_exists'); end if;
 for i in 1..array_length(delays,1) loop
  insert into public.demi_followups(studio_id,person_id,conversation_id,kind,source_ref,source_at,step,due_at)
  values(p_studio,person,c.id,p_kind,p_source_ref,p_source_at,i,p_source_at+delays[i]) on conflict do nothing;
 end loop;
 return jsonb_build_object('ok',true,'steps',array_length(delays,1));
end; $$;

create or replace function private.demi_followup_stop_reason(p_followup public.demi_followups,p_now timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare st public.students%rowtype; c public.assistant_conversations%rowtype; today date;
begin
 select * into c from public.assistant_conversations where id=p_followup.conversation_id and studio_id=p_followup.studio_id;
 if not found or c.status<>'open' then return 'conversation_not_open'; end if;
 if p_followup.kind in ('prospect','post_trial') and private.demi_group_has_active_reservation(p_followup.studio_id,p_followup.conversation_id) then return 'group_reservation_exists'; end if;
 if not exists(select 1 from public.demi_followup_settings where studio_id=p_followup.studio_id and enabled) then return 'followups_disabled'; end if;
 if exists(select 1 from public.person_communication_preferences where studio_id=p_followup.studio_id and person_id=p_followup.person_id and (whatsapp_blocked or not retention_enabled or (p_followup.kind in ('prospect','post_trial') and not promotions_enabled))) then return 'contact_opted_out'; end if;
 if exists(select 1 from public.crm_followups where studio_id=p_followup.studio_id and person_id=p_followup.person_id and qualification='not_qualified') then return 'not_qualified'; end if;
 if exists(select 1 from public.assistant_handoffs h join public.assistant_conversations ac on ac.id=h.conversation_id and ac.studio_id=h.studio_id where h.studio_id=p_followup.studio_id and h.status='open' and (ac.id=c.id or ac.student_id=c.student_id or exists(select 1 from public.students hs where hs.id=ac.student_id and hs.studio_id=ac.studio_id and hs.person_id=p_followup.person_id) or exists(select 1 from public.crm_contacts hc where hc.id=nullif(ac.context->>'crm_contact_id','')::uuid and hc.studio_id=ac.studio_id and hc.person_id=p_followup.person_id))) then return 'human_control'; end if;
 select * into st from public.students where studio_id=p_followup.studio_id and person_id=p_followup.person_id and lifecycle_status<>'archived' limit 1;
 if found and exists(select 1 from public.reservations where studio_id=p_followup.studio_id and student_id=st.id and status='reserved') then return 'reservation_exists'; end if;
 if p_followup.kind in ('prospect','post_trial') and found and st.student_type<>'trial' then return 'converted'; end if;
 select (p_now at time zone timezone)::date into today from public.studios where id=p_followup.studio_id;
 if p_followup.kind in ('package','package_expiring','package_expired') then
  if not exists(select 1 from public.product_acquisitions where id=p_followup.source_ref::uuid and studio_id=p_followup.studio_id and student_id=st.id and refunded_at is null and status<>'cancelled' and not access_blocked) then return 'source_missing'; end if;
  if exists(select 1 from public.product_acquisitions where studio_id=p_followup.studio_id and student_id=st.id and status='active' and refunded_at is null and created_at>(select created_at from public.product_acquisitions where id=p_followup.source_ref::uuid)) then return 'package_renewed'; end if;
 end if;
 if p_followup.kind='enrollment' and exists(select 1 from public.student_enrollments where studio_id=p_followup.studio_id and student_id=st.id and status='active' and refunded_at is null and starts_on<=today and (expires_on is null or expires_on>=today)) then return 'enrollment_renewed'; end if;
 if p_followup.kind='inactive' and exists(select 1 from public.reservations r join public.class_sessions s on s.id=r.session_id and s.studio_id=r.studio_id where r.studio_id=p_followup.studio_id and r.student_id=st.id and r.status='attended' and s.starts_at>p_followup.source_at) then return 'attendance_recorded'; end if;
 return null;
end; $$;

create or replace function private.seed_demi_followups_on_assistant_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.assistant_conversations%rowtype; person uuid; st public.students%rowtype; followup_kind text;
begin
 if new.role<>'assistant' or auth.role() is distinct from 'service_role' then return new; end if;
 select * into c from public.assistant_conversations where id=new.conversation_id and studio_id=new.studio_id;
 if not found or c.status<>'open' or c.channel<>'whatsapp' then return new; end if;
 if private.demi_group_has_active_reservation(c.studio_id,c.id) then return new; end if;
 select * into st from public.students where id=c.student_id and studio_id=c.studio_id;
 person:=st.person_id;
 if person is null then select person_id into person from public.crm_contacts where id=nullif(c.context->>'crm_contact_id','')::uuid and studio_id=c.studio_id; end if;
 if person is null or (st.id is not null and st.student_type<>'trial') then return new; end if;
 if exists(select 1 from public.person_communication_preferences where studio_id=c.studio_id and person_id=person and (whatsapp_blocked or not retention_enabled or not promotions_enabled))
 or exists(select 1 from public.crm_followups where studio_id=c.studio_id and person_id=person and qualification='not_qualified')
 or exists(select 1 from public.reservations where studio_id=c.studio_id and student_id=st.id and status='reserved')
 or exists(select 1 from public.assistant_handoffs where studio_id=c.studio_id and conversation_id=c.id and status='open') then return new; end if;
 followup_kind:=case when st.trial_status='attended' then 'post_trial' else 'prospect' end;
 -- A new answer starts a new chain; supersede previous pending sources without resending them.
 update public.demi_followups set state='cancelled',reason_code='newer_assistant_reply',lease_token=null,lease_until=null
 where studio_id=c.studio_id and person_id=person and kind in ('prospect','post_trial') and state in ('pending','processing');
 perform public.service_schedule_demi_followups(c.studio_id,c.id,followup_kind,new.id::text,new.created_at);
 return new;
end; $$;
create function private.stop_demi_followups_on_group_booking() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if private.demi_group_has_active_reservation(new.studio_id,new.conversation_id) then
  update public.demi_followups set state='cancelled',reason_code='group_reservation_exists',lease_token=null,lease_until=null
  where studio_id=new.studio_id and conversation_id=new.conversation_id and kind in ('prospect','post_trial') and state in ('pending','processing');
 end if;
 return new;
end; $$;
create trigger demi_group_stops_prospect_followups after update of status on public.demi_group_bookings for each row execute function private.stop_demi_followups_on_group_booking();
revoke all on function private.stop_demi_followups_on_group_booking() from public,anon,authenticated,service_role;

-- Cancel existing Sandbox followups for a payer whose group already has real reservations.
update public.demi_followups f set state='cancelled',reason_code='group_reservation_exists',lease_token=null,lease_until=null
where f.kind in ('prospect','post_trial') and f.state in ('pending','processing') and private.demi_group_has_active_reservation(f.studio_id,f.conversation_id);
