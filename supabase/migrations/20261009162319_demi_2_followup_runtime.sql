create table public.demi_followup_settings (
 studio_id uuid primary key references public.studios(id), enabled boolean not null default false,
 prospect_interval_hours integer not null default 24 check(prospect_interval_hours between 1 and 720),
 templates jsonb not null default '{}'
);
create table public.demi_followups (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 person_id uuid not null references public.persons(id), conversation_id uuid not null references public.assistant_conversations(id),
 kind text not null check(kind in ('prospect','post_trial','package','enrollment','inactive','package_expiring','package_expired')),
 source_ref text not null, source_at timestamptz not null, step integer not null check(step between 1 and 3),
 due_at timestamptz not null, state text not null default 'pending' check(state in ('pending','processing','accepted','cancelled','failed')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 3),
 lease_token uuid, lease_until timestamptz, reason_code text, provider_message_id text,
 created_at timestamptz not null default clock_timestamp(),
 unique(studio_id,person_id,kind,source_ref,step)
);
create index demi_followups_due on public.demi_followups(studio_id,due_at) where state='pending';
create table public.demi_followup_attempts (
 id uuid primary key default gen_random_uuid(), followup_id uuid not null references public.demi_followups(id),
 attempt integer not null, status text not null, error_code text, provider_message_id text,
 recorded_at timestamptz not null default clock_timestamp(), unique(followup_id,attempt)
);
alter table public.demi_followup_settings enable row level security;
alter table public.demi_followups enable row level security;
alter table public.demi_followup_attempts enable row level security;
revoke all on public.demi_followup_settings,public.demi_followups,public.demi_followup_attempts from public,anon,authenticated;
grant all on public.demi_followup_settings,public.demi_followups,public.demi_followup_attempts to service_role;
grant select on public.demi_followup_settings,public.demi_followups,public.demi_followup_attempts to authenticated;
create policy demi_followup_settings_read on public.demi_followup_settings for select to authenticated using(private.has_capability(studio_id,'settings.read'));
create policy demi_followups_read on public.demi_followups for select to authenticated using(private.has_capability(studio_id,'students.read'));
create policy demi_followup_attempts_read on public.demi_followup_attempts for select to authenticated using(exists(select 1 from public.demi_followups f where f.id=followup_id and private.has_capability(f.studio_id,'students.read')));

create function public.service_schedule_demi_followups(p_studio uuid,p_conversation uuid,p_kind text,p_source_ref text,p_source_at timestamptz)
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
 for i in 1..array_length(delays,1) loop
  insert into public.demi_followups(studio_id,person_id,conversation_id,kind,source_ref,source_at,step,due_at)
  values(p_studio,person,c.id,p_kind,p_source_ref,p_source_at,i,p_source_at+delays[i]) on conflict do nothing;
 end loop;
 return jsonb_build_object('ok',true,'steps',array_length(delays,1));
end; $$;

create function private.demi_followup_stop_reason(p_followup public.demi_followups,p_now timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare st public.students%rowtype; c public.assistant_conversations%rowtype; today date;
begin
 select * into c from public.assistant_conversations where id=p_followup.conversation_id and studio_id=p_followup.studio_id;
 if not found or c.status<>'open' then return 'conversation_not_open'; end if;
 if not exists(select 1 from public.demi_followup_settings where studio_id=p_followup.studio_id and enabled) then return 'followups_disabled'; end if;
 if exists(select 1 from public.person_communication_preferences where studio_id=p_followup.studio_id and person_id=p_followup.person_id and (whatsapp_blocked or not retention_enabled or (p_followup.kind in ('prospect','post_trial') and not promotions_enabled))) then return 'contact_opted_out'; end if;
 if exists(select 1 from public.crm_followups where studio_id=p_followup.studio_id and person_id=p_followup.person_id and qualification='not_qualified') then return 'not_qualified'; end if;
 if exists(select 1 from public.assistant_handoffs h join public.assistant_conversations ac on ac.id=h.conversation_id and ac.studio_id=h.studio_id where h.studio_id=p_followup.studio_id and h.status='open' and (ac.id=c.id or ac.student_id=c.student_id)) then return 'human_control'; end if;
 select * into st from public.students where studio_id=p_followup.studio_id and person_id=p_followup.person_id and lifecycle_status<>'archived' limit 1;
 if found and exists(select 1 from public.reservations where studio_id=p_followup.studio_id and student_id=st.id and status='reserved') then return 'reservation_exists'; end if;
 if p_followup.kind='prospect' and found and st.student_type<>'trial' then return 'converted'; end if;
 select (p_now at time zone timezone)::date into today from public.studios where id=p_followup.studio_id;
 if p_followup.kind in ('package','package_expiring','package_expired') then
  if not exists(select 1 from public.product_acquisitions where id=p_followup.source_ref::uuid and studio_id=p_followup.studio_id and student_id=st.id and refunded_at is null) then return 'source_missing'; end if;
  if exists(select 1 from public.product_acquisitions where studio_id=p_followup.studio_id and student_id=st.id and status='active' and refunded_at is null and created_at>(select created_at from public.product_acquisitions where id=p_followup.source_ref::uuid)) then return 'package_renewed'; end if;
 end if;
 if p_followup.kind='enrollment' and exists(select 1 from public.student_enrollments where studio_id=p_followup.studio_id and student_id=st.id and status='active' and refunded_at is null and starts_on<=today and (expires_on is null or expires_on>=today)) then return 'enrollment_renewed'; end if;
 if p_followup.kind='inactive' and exists(select 1 from public.reservations r join public.class_sessions s on s.id=r.session_id and s.studio_id=r.studio_id where r.studio_id=p_followup.studio_id and r.student_id=st.id and r.status='attended' and s.starts_at>p_followup.source_at) then return 'attendance_recorded'; end if;
 return null;
end; $$;

create function public.service_claim_demi_followups(p_studio uuid,p_now timestamptz default clock_timestamp(),p_limit integer default 25)
returns setof public.demi_followups language plpgsql security invoker set search_path='' as $$
declare f public.demi_followups%rowtype; reason text; claimed integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 -- Unknown delivery outcome after a timeout must be reviewed, never blindly resent.
 for f in select * from public.demi_followups where studio_id=p_studio and state='processing' and lease_until<p_now for update skip locked loop
  update public.demi_followups set state='failed',reason_code='delivery_outcome_unknown',lease_token=null,lease_until=null where id=f.id;
  perform public.assistant_create_handoff(p_studio,f.conversation_id,null,'persistent_error','Seguimiento con resultado de entrega desconocido: '||f.id);
 end loop;
 for f in select * from public.demi_followups where studio_id=p_studio and state='pending' and due_at<=p_now order by due_at,step for update skip locked loop
  reason:=private.demi_followup_stop_reason(f,p_now);
  if reason is not null then update public.demi_followups set state='cancelled',reason_code=reason where studio_id=f.studio_id and person_id=f.person_id and state='pending'; continue; end if;
  if exists(select 1 from public.demi_followups where studio_id=f.studio_id and person_id=f.person_id and kind=f.kind and source_ref=f.source_ref and step<f.step and state<>'accepted') then continue; end if;
  update public.demi_followups set state='processing',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_until=p_now+interval '2 minutes' where id=f.id returning * into f;
  return next f; claimed:=claimed+1;
  if claimed>=least(greatest(p_limit,1),100) then exit; end if;
 end loop;
end; $$;

create function public.service_finish_demi_followup(p_id uuid,p_token uuid,p_accepted boolean,p_provider text default null,p_error text default null,p_now timestamptz default clock_timestamp())
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.demi_followups%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into f from public.demi_followups where id=p_id for update;
 if not found or f.state<>'processing' or f.lease_token is distinct from p_token then return jsonb_build_object('ok',false,'reason_code','lease_mismatch'); end if;
 if p_accepted and nullif(p_provider,'') is null then return jsonb_build_object('ok',false,'reason_code','provider_reference_required'); end if;
 insert into public.demi_followup_attempts(followup_id,attempt,status,error_code,provider_message_id) values(f.id,f.attempt_count,case when p_accepted then 'accepted' else 'error' end,case when p_accepted then null else coalesce(p_error,'delivery_failed') end,p_provider);
 update public.demi_followups set state=case when p_accepted then 'accepted' when attempt_count>=3 then 'failed' else 'pending' end,
 due_at=case when p_accepted then due_at else p_now+interval '5 minutes' end,lease_until=null,lease_token=null,
 provider_message_id=p_provider,reason_code=case when p_accepted then null else coalesce(p_error,'delivery_failed') end where id=f.id;
 if not p_accepted and f.attempt_count>=3 then
  update public.demi_followups set state='cancelled',reason_code='persistent_error' where studio_id=f.studio_id and person_id=f.person_id and state='pending';
  perform public.assistant_create_handoff(f.studio_id,f.conversation_id,null,'persistent_error','Tres fallos en seguimiento '||f.id||'; último código: '||coalesce(p_error,'delivery_failed'));
 elsif p_accepted and f.kind='prospect' and f.step=2 then
  insert into public.crm_followups(studio_id,person_id,prospect_stage,qualification,revision) values(f.studio_id,f.person_id,'not_booked','pending',1)
  on conflict(studio_id,person_id) do update set prospect_stage='not_booked',revision=public.crm_followups.revision+1,updated_at=p_now;
 end if;
 return jsonb_build_object('ok',true,'status',case when p_accepted then 'accepted' when f.attempt_count>=3 then 'failed' else 'retry_wait' end,'attempt',f.attempt_count);
end; $$;

create function private.stop_demi_followups_on_reply() returns trigger language plpgsql security definer set search_path='' as $$
declare person uuid; c public.assistant_conversations%rowtype;
begin
 if new.role<>'user' then return new; end if;
 select * into c from public.assistant_conversations where id=new.conversation_id and studio_id=new.studio_id;
 select person_id into person from public.students where id=c.student_id and studio_id=new.studio_id;
 if person is null then select person_id into person from public.crm_contacts where id=nullif(c.context->>'crm_contact_id','')::uuid and studio_id=new.studio_id; end if;
 update public.demi_followups set state='cancelled',reason_code='contact_replied',lease_token=null,lease_until=null where studio_id=new.studio_id and person_id=person and state in ('pending','processing');
 if person is not null then update public.crm_followups set qualification='pending',qualification_reason=null,revision=revision+1,updated_at=clock_timestamp() where studio_id=new.studio_id and person_id=person and qualification='not_qualified'; end if;
 return new;
end; $$;
create trigger demi_followups_reply after insert on public.assistant_turns for each row execute function private.stop_demi_followups_on_reply();

create function public.service_update_demi_followup_stage(p_studio uuid,p_conversation uuid,p_stage text,p_reason text default null,p_source text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare person uuid; c public.assistant_conversations%rowtype; q text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio;
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 select person_id into person from public.students where id=c.student_id and studio_id=p_studio;
 if person is null then select person_id into person from public.crm_contacts where id=nullif(c.context->>'crm_contact_id','')::uuid and studio_id=p_studio; end if;
 if person is null then return jsonb_build_object('ok',false,'reason_code','identity_required'); end if;
 if p_stage not in ('answering_questions','awaiting_receipt','awaiting_participant_data','not_booked','not_qualified','opt_out') then return jsonb_build_object('ok',false,'reason_code','invalid_stage'); end if;
 if p_stage='not_qualified' and length(trim(coalesce(p_reason,'')))<3 then return jsonb_build_object('ok',false,'reason_code','qualification_reason_required'); end if;
 q:=case when p_stage='not_qualified' then 'not_qualified' else 'pending' end;
 insert into public.crm_followups(studio_id,person_id,prospect_stage,qualification,qualification_reason,revision)
 values(p_studio,person,case when p_stage in ('not_qualified','opt_out') then 'answering_questions' else p_stage end,q,case when q='not_qualified' then p_reason else null end,1)
 on conflict(studio_id,person_id) do update set prospect_stage=excluded.prospect_stage,qualification=excluded.qualification,qualification_reason=excluded.qualification_reason,revision=public.crm_followups.revision+1,updated_at=clock_timestamp();
 if p_stage in ('not_qualified','opt_out','not_booked') then
  update public.demi_followups set state='cancelled',reason_code=p_stage,lease_token=null,lease_until=null where studio_id=p_studio and person_id=person and state in ('pending','processing');
  if p_stage='opt_out' then
   insert into public.person_communication_preferences(studio_id,person_id,retention_enabled,promotions_enabled) values(p_studio,person,false,false)
   on conflict(studio_id,person_id) do update set retention_enabled=false,promotions_enabled=false,updated_at=clock_timestamp();
  end if;
 else
  perform public.service_schedule_demi_followups(p_studio,p_conversation,'prospect',coalesce(p_source,gen_random_uuid()::text),clock_timestamp());
 end if;
 return jsonb_build_object('ok',true,'stage',p_stage,'qualification',q);
end; $$;

revoke all on function private.demi_followup_stop_reason(public.demi_followups,timestamptz),private.stop_demi_followups_on_reply() from public,anon,authenticated;
grant execute on function private.demi_followup_stop_reason(public.demi_followups,timestamptz) to service_role;
revoke all on function public.service_schedule_demi_followups(uuid,uuid,text,text,timestamptz),public.service_claim_demi_followups(uuid,timestamptz,integer),public.service_finish_demi_followup(uuid,uuid,boolean,text,text,timestamptz),public.service_update_demi_followup_stage(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.service_schedule_demi_followups(uuid,uuid,text,text,timestamptz),public.service_claim_demi_followups(uuid,timestamptz,integer),public.service_finish_demi_followup(uuid,uuid,boolean,text,text,timestamptz),public.service_update_demi_followup_stage(uuid,uuid,text,text,text) to service_role;
