create or replace function private.demi_followup_stop_reason(p_followup public.demi_followups,p_now timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare st public.students%rowtype; c public.assistant_conversations%rowtype; today date;
begin
 select * into c from public.assistant_conversations where id=p_followup.conversation_id and studio_id=p_followup.studio_id;
 if not found or c.status<>'open' then return 'conversation_not_open'; end if;
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

create or replace function public.service_seed_due_demi_followups(p_studio uuid,p_now timestamptz default clock_timestamp())
returns integer language plpgsql security invoker set search_path='' as $$
declare item record; c uuid; today date; timezone text; count integer:=0; anchor timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.demi_followup_settings where studio_id=p_studio and enabled) then return 0; end if;
 select s.timezone,(p_now at time zone s.timezone)::date into timezone,today from public.studios s where id=p_studio;
 for item in select a.* from public.product_acquisitions a where a.studio_id=p_studio and a.refunded_at is null and a.status<>'cancelled' and a.expires_on between today-31 and today+3 loop
  select id into c from public.assistant_conversations where studio_id=p_studio and student_id=item.student_id and channel='whatsapp' order by last_activity_at desc limit 1;
  if c is null then continue; end if;
  anchor:=(item.expires_on+time '10:00') at time zone timezone;
  if item.expires_on>=today then perform public.service_schedule_demi_followups(p_studio,c,'package_expiring',item.id::text,anchor); end if;
  if item.expires_on<today then
   perform public.service_schedule_demi_followups(p_studio,c,'package_expired',item.id::text,anchor);
   perform public.service_schedule_demi_followups(p_studio,c,'package',item.id::text,anchor);
  end if;
  count:=count+1;
 end loop;
 for item in select * from public.student_enrollments where studio_id=p_studio and refunded_at is null and status in ('active','expired') and expires_on between today-31 and today-1 loop
  select id into c from public.assistant_conversations where studio_id=p_studio and student_id=item.student_id and channel='whatsapp' order by last_activity_at desc limit 1;
  if c is null then continue; end if;
  perform public.service_schedule_demi_followups(p_studio,c,'enrollment',item.id::text,(item.expires_on+time '10:00') at time zone timezone);
  count:=count+1;
 end loop;
 for item in select r.student_id,max(s.starts_at) as last_attended from public.reservations r join public.class_sessions s on s.id=r.session_id and s.studio_id=r.studio_id where r.studio_id=p_studio and r.status='attended' group by r.student_id loop
  if exists(select 1 from public.students where id=item.student_id and studio_id=p_studio and student_type='trial' and trial_status='attended') then
   select id into c from public.assistant_conversations where studio_id=p_studio and student_id=item.student_id and channel='whatsapp' order by last_activity_at desc limit 1;
   if c is not null then perform public.service_schedule_demi_followups(p_studio,c,'post_trial',item.last_attended::text,item.last_attended); end if;
  end if;
  if item.last_attended+interval '14 days'>p_now then continue; end if;
  select id into c from public.assistant_conversations where studio_id=p_studio and student_id=item.student_id and channel='whatsapp' order by last_activity_at desc limit 1;
  if c is null then continue; end if;
  perform public.service_schedule_demi_followups(p_studio,c,'inactive',item.last_attended::text,item.last_attended);
  count:=count+1;
 end loop;
 return count;
end; $$;


create function public.admin_save_demi_followup_settings(p_studio uuid,p_enabled boolean,p_interval integer,p_templates jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_capability(p_studio,'settings.write') then raise exception 'forbidden'; end if;
 if p_interval is null or p_interval not between 1 and 720 or jsonb_typeof(p_templates) is distinct from 'object' then raise exception 'invalid_followup_settings'; end if;
 if exists(select 1 from jsonb_each(p_templates) e where e.key !~ '^(prospect|post_trial|package|enrollment|inactive|package_expiring|package_expired)_[123]$' or jsonb_typeof(e.value) is distinct from 'object' or coalesce(e.value->>'name','') !~ '^[a-z0-9_]{1,512}$' or (e.value ? 'components' and jsonb_typeof(e.value->'components') is distinct from 'array')) then raise exception 'invalid_meta_template'; end if;
 if p_enabled and p_templates='{}'::jsonb and not exists(select 1 from public.demi_uat_runs where studio_id=p_studio) then raise exception 'approved_meta_templates_required'; end if;
 insert into public.demi_followup_settings(studio_id,enabled,prospect_interval_hours,templates) values(p_studio,p_enabled,p_interval,p_templates)
 on conflict(studio_id) do update set enabled=excluded.enabled,prospect_interval_hours=excluded.prospect_interval_hours,templates=excluded.templates;
 if not p_enabled then update public.demi_followups set state='cancelled',reason_code='followups_disabled',lease_token=null,lease_until=null where studio_id=p_studio and state in ('pending','processing'); end if;
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.admin_save_demi_followup_settings(uuid,boolean,integer,jsonb) from public,anon;
grant execute on function public.admin_save_demi_followup_settings(uuid,boolean,integer,jsonb) to authenticated;
