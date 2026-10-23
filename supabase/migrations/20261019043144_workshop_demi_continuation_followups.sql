-- Extend the existing followup queue; operational activation is explicit per studio.
alter table public.demi_followups drop constraint demi_followups_kind_check;
alter table public.demi_followups add constraint demi_followups_kind_check check(kind in
 ('prospect','post_trial','package','enrollment','inactive','package_expiring','package_expired','workshop'));

create function public.admin_workshop_demi_settings(p_studio uuid,p_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare enabled boolean:=false;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio,'settings.write'),false)
 or not coalesce(private.has_capability(p_studio,'schedule.write'),false)
 or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
 or not exists(select 1 from public.studios where id=p_studio and status='active') then raise exception 'forbidden'; end if;
 if p_enabled is not null then
  insert into public.workshop_studio_policies(studio_id,demi_enabled) values(p_studio,p_enabled)
   on conflict(studio_id) do update set demi_enabled=excluded.demi_enabled,updated_at=clock_timestamp();
 end if;
 select demi_enabled into enabled from public.workshop_studio_policies where studio_id=p_studio;
 return jsonb_build_object('enabled',coalesce(enabled,false));
end $$;
revoke all on function public.admin_workshop_demi_settings(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_workshop_demi_settings(uuid,boolean) to authenticated;

create function private.workshop_followup_stop_reason(f public.demi_followups,p_now timestamptz)
returns text language plpgsql security definer set search_path='' as $$
declare purchase public.workshop_purchases%rowtype; first_row record; decision text;
begin
 if not exists(select 1 from public.workshop_studio_policies where studio_id=f.studio_id and demi_enabled)
  or not exists(select 1 from public.demi_followup_settings where studio_id=f.studio_id and enabled) then return 'followups_disabled'; end if;
 if not exists(select 1 from public.assistant_conversations c join public.students st on st.id=c.student_id and st.studio_id=c.studio_id
  join public.studios studio on studio.id=c.studio_id and studio.status='active'
  where c.id=f.conversation_id and c.studio_id=f.studio_id and c.status='open' and c.assistant_key='demi'
   and st.person_id=f.person_id and st.active and st.lifecycle_status='active') then return 'conversation_identity_mismatch'; end if;
 if exists(select 1 from public.person_communication_preferences where studio_id=f.studio_id and person_id=f.person_id and (whatsapp_blocked or not retention_enabled)) then return 'contact_opted_out'; end if;
 if exists(select 1 from public.assistant_handoffs where studio_id=f.studio_id and conversation_id=f.conversation_id and status='open') then return 'human_control'; end if;
 select * into purchase from public.workshop_purchases where studio_id=f.studio_id and id::text=substring(f.source_ref from 10) and selection_mode='full';
 if not found or purchase.status<>'reserved' then return 'workshop_not_active'; end if;
 if not exists(select 1 from public.students where id=purchase.student_id and studio_id=f.studio_id and person_id=f.person_id) then return 'conversation_identity_mismatch'; end if;
 if purchase.paid_minor>=purchase.total_minor then return 'workshop_paid'; end if;
 select s.ends_at,r.status into first_row from public.workshop_purchase_sessions ps
  join public.class_sessions s on s.id=ps.session_id and s.studio_id=f.studio_id
  join public.reservations r on r.id=ps.reservation_id and r.studio_id=f.studio_id and r.student_id=purchase.student_id
  where ps.purchase_id=purchase.id order by s.starts_at,s.id limit 1;
 if not found or first_row.status::text<>'no_show' or first_row.ends_at>p_now then return 'first_absence_not_recorded'; end if;
 select d.decision into decision from private.workshop_continuation_decisions d where d.studio_id=f.studio_id and d.purchase_id=purchase.id order by d.created_at desc,d.id desc limit 1;
 if f.step=1 and decision is not null then return 'continuation_already_recorded'; end if;
 if f.step>1 and decision is distinct from 'continue' then return 'continuation_not_confirmed'; end if;
 return null;
end $$;
revoke all on function private.workshop_followup_stop_reason(public.demi_followups,timestamptz) from public,anon,authenticated,service_role;

alter function private.demi_followup_stop_reason(public.demi_followups,timestamptz) rename to demi_followup_stop_reason_before_workshops;
create function private.demi_followup_stop_reason(p_followup public.demi_followups,p_now timestamptz)
returns text language plpgsql security definer set search_path='' as $$
begin
 if p_followup.kind='workshop' then return private.workshop_followup_stop_reason(p_followup,p_now); end if;
 return private.demi_followup_stop_reason_before_workshops(p_followup,p_now);
end $$;
revoke all on function private.demi_followup_stop_reason_before_workshops(public.demi_followups,timestamptz),private.demi_followup_stop_reason(public.demi_followups,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.demi_followup_stop_reason(public.demi_followups,timestamptz) to service_role;

alter function public.service_get_demi_followup_message(uuid,uuid,timestamptz) rename to service_get_demi_followup_message_before_workshops;
create function public.service_get_demi_followup_message(p_id uuid,p_token uuid,p_now timestamptz default clock_timestamp())
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.demi_followups%rowtype; p public.workshop_purchases%rowtype; amount text; message text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into f from public.demi_followups where id=p_id and state='processing' and lease_token=p_token and lease_until>p_now;
 if not found then return jsonb_build_object('ok',false,'reason_code','lease_mismatch'); end if;
 if f.kind<>'workshop' then return public.service_get_demi_followup_message_before_workshops(p_id,p_token,p_now); end if;
 if private.workshop_followup_stop_reason(f,p_now) is not null then return jsonb_build_object('ok',false,'reason_code','followup_no_longer_eligible'); end if;
 select * into p from public.workshop_purchases where studio_id=f.studio_id and id::text=substring(f.source_ref from 10);
 amount:=to_char((p.total_minor-p.paid_minor)::numeric/100,'FM999999990.00')||' MXN';
 message:=case when f.step=1 then 'No asististe a la primera fecha del taller y queda un saldo de '||amount||'. La ausencia no condona el saldo ni repone la sesión. ¿Continuarás con las próximas fechas? Si decides retirarte, confirma expresamente «me retiro del taller»; el anticipo y la deuda se conservan.'
  else 'Continúas inscrita en el taller. Sigue pendiente el saldo de '||amount||', exigible desde la primera fecha. Contacta al estudio para liquidarlo; no necesitas volver a confirmar tu continuidad.' end;
 return jsonb_build_object('ok',true,'stage','workshop','text',message,'source_ref',f.source_ref,'template_key','workshop_'||f.step);
end $$;
revoke all on function public.service_get_demi_followup_message_before_workshops(uuid,uuid,timestamptz),public.service_get_demi_followup_message(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.service_get_demi_followup_message(uuid,uuid,timestamptz) to service_role;

create function public.service_seed_workshop_followups(p_studio uuid,p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path='' as $$
declare item record; conversation uuid; decision record; count integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled)
  or not exists(select 1 from public.demi_followup_settings where studio_id=p_studio and enabled) then return 0; end if;
 for item in select p.*,st.person_id,first_date.ends_at from public.workshop_purchases p
  join public.students st on st.id=p.student_id and st.studio_id=p_studio
  cross join lateral(select s.ends_at,r.status from public.workshop_purchase_sessions ps
   join public.class_sessions s on s.id=ps.session_id and s.studio_id=p_studio
   join public.reservations r on r.id=ps.reservation_id and r.studio_id=p_studio and r.student_id=p.student_id
   where ps.purchase_id=p.id order by s.starts_at,s.id limit 1) first_date
  where p.studio_id=p_studio and p.status='reserved' and p.selection_mode='full' and p.paid_minor<p.total_minor
   and st.person_id is not null and first_date.status::text='no_show' and first_date.ends_at<=p_now loop
  select id into conversation from public.assistant_conversations where studio_id=p_studio and student_id=item.student_id
   and assistant_key='demi' and status='open' and channel='whatsapp' order by last_activity_at desc,id desc limit 1;
  if conversation is null then continue; end if;
  select d.decision,d.created_at into decision from private.workshop_continuation_decisions d where d.studio_id=p_studio and d.purchase_id=item.id order by d.created_at desc,d.id desc limit 1;
  if not found then
   insert into public.demi_followups(studio_id,person_id,conversation_id,kind,source_ref,source_at,step,due_at)
    values(p_studio,item.person_id,conversation,'workshop','workshop:'||item.id,item.ends_at,1,item.ends_at) on conflict do nothing;
  elsif decision.decision='continue' then
   insert into public.demi_followups(studio_id,person_id,conversation_id,kind,source_ref,source_at,step,due_at)
    select p_studio,item.person_id,conversation,'workshop','workshop:'||item.id,item.ends_at,n,decision.created_at+case n when 2 then interval '1 day' else interval '7 days' end from generate_series(2,3) n on conflict do nothing;
  end if;
  count:=count+1;
 end loop;
 return count;
end $$;
revoke all on function public.service_seed_workshop_followups(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.service_seed_workshop_followups(uuid,timestamptz) to service_role;

create function public.service_record_workshop_continuation(p_studio uuid,p_conversation uuid,p_purchase uuid,p_turn uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare student uuid; message text; normalized text; previous text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select c.student_id into student from public.assistant_conversations c join public.workshop_purchases p on p.student_id=c.student_id and p.studio_id=c.studio_id
  where c.id=p_conversation and c.studio_id=p_studio and c.status='open' and c.assistant_key='demi' and p.id=p_purchase;
 if student is null then raise exception 'conversation_identity_mismatch'; end if;
 if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled) then raise exception 'workshop_demi_disabled'; end if;
 if not exists(select 1 from public.demi_followups f join public.demi_followup_attempts a on a.followup_id=f.id and a.status='accepted'
  join public.assistant_turns t on t.id=p_turn and t.created_at>=a.recorded_at
  where f.studio_id=p_studio and f.conversation_id=p_conversation and f.kind='workshop' and f.source_ref='workshop:'||p_purchase and f.step=1 and f.state='accepted') then raise exception 'workshop_question_not_delivered'; end if;
 select content into message from public.assistant_turns where id=p_turn and studio_id=p_studio and conversation_id=p_conversation and role='user' and direction='inbound';
 normalized:=btrim(regexp_replace(translate(lower(message),'áéíóúü','aeiouu'),'[^a-z0-9 ]','','g'));
 if message is null or message ~ '[?¿]' or p_decision is null
  or (p_decision='continue' and normalized not in ('si','si continuo','si continuo con el taller','quiero continuar con el taller'))
  or (p_decision='withdraw' and normalized not in ('me retiro del taller','no continuo con el taller','no quiero continuar con el taller'))
  or p_decision not in ('continue','withdraw') then raise exception 'explicit_continuation_required'; end if;
 select d.decision into previous from private.workshop_continuation_decisions d where d.studio_id=p_studio and d.purchase_id=p_purchase order by d.created_at desc,d.id desc limit 1;
 if previous=p_decision then return jsonb_build_object('purchase_id',p_purchase,'decision',p_decision,'released_count',0,'replayed',true); end if;
 return private.workshop_record_continuation(p_studio,p_purchase,p_turn,p_decision,'Respuesta explícita: '||message,null,p_conversation);
end $$;
revoke all on function public.service_record_workshop_continuation(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_record_workshop_continuation(uuid,uuid,uuid,uuid,text) to service_role;

create function public.service_student_workshops(p_studio uuid,p_conversation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare student uuid; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select student_id into student from public.assistant_conversations where studio_id=p_studio and id=p_conversation and assistant_key='demi' and status='open';
 if student is null then raise exception 'verified_student_required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('purchase_ref','purchase:'||p.id,'title',o.title,'status',p.status,'balance_minor',greatest(0,p.total_minor-p.paid_minor),'due_at',p.balance_due_at,
  'continuation',(select d.decision from private.workshop_continuation_decisions d where d.studio_id=p_studio and d.purchase_id=p.id order by d.created_at desc,d.id desc limit 1),
  'continuation_question_delivered',exists(select 1 from public.demi_followups where studio_id=p_studio and conversation_id=p_conversation and kind='workshop' and source_ref='workshop:'||p.id and step=1 and state='accepted')) order by p.created_at desc),'[]'::jsonb) into result
 from public.workshop_purchases p join public.workshop_offers o on o.id=p.offer_id and o.studio_id=p_studio where p.studio_id=p_studio and p.student_id=student;
 return result;
end $$;
revoke all on function public.service_student_workshops(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_student_workshops(uuid,uuid) to service_role;

create table private.workshop_overdue_releases (
 purchase_id uuid primary key references public.workshop_purchases(id), studio_id uuid not null references public.studios(id),
 due_at timestamptz not null, grace_minutes integer not null, balance_minor integer not null,
 released_count integer not null, evaluated_at timestamptz not null, created_at timestamptz not null default clock_timestamp()
);
alter table private.workshop_overdue_releases enable row level security;
revoke all on private.workshop_overdue_releases from public,anon,authenticated,service_role;
create function public.service_process_workshop_overdues(p_studio uuid,p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path='' as $$
declare item record; p public.workshop_purchases%rowtype; paid bigint; session uuid; released integer; count integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled) then return 0; end if;
 for item in select id,sale_id from public.workshop_purchases where studio_id=p_studio and status='reserved'
  and overdue_mode='release_after_grace' and paid_minor<total_minor and balance_due_at+make_interval(mins=>grace_minutes)<p_now order by id limit 100 loop
  -- Serialize against register_sale_payment before deciding to release capacity.
  perform 1 from public.sales where id=item.sale_id and studio_id=p_studio for update;
  select * into p from public.workshop_purchases where id=item.id and studio_id=p_studio for update;
  if p.status<>'reserved' or p.overdue_mode<>'release_after_grace' or p.balance_due_at+make_interval(mins=>p.grace_minutes)>=p_now then continue; end if;
  select coalesce(sum(case when kind='refund' then -amount_minor else amount_minor end),0) into paid from public.payments where studio_id=p_studio and sale_id=p.sale_id;
  if paid>=p.total_minor then continue; end if;
  for session in select ps.session_id from public.workshop_purchase_sessions ps join public.class_sessions s on s.id=ps.session_id and s.studio_id=p_studio
   where ps.purchase_id=p.id and s.starts_at>p_now order by ps.session_id loop
   perform 1 from public.class_sessions where id=session and studio_id=p_studio for update;
  end loop;
  update public.reservations r set status='cancelled' from public.workshop_purchase_sessions ps,public.class_sessions s
   where ps.purchase_id=p.id and ps.reservation_id=r.id and ps.session_id=s.id and r.studio_id=p_studio
    and r.student_id=p.student_id and s.studio_id=p_studio and s.starts_at>p_now and r.status::text='reserved';
  get diagnostics released=row_count;
  update public.workshop_purchases set status='released',released_at=p_now where id=p.id;
  insert into private.workshop_overdue_releases values(p.id,p_studio,p.balance_due_at,p.grace_minutes,greatest(0,p.total_minor-paid)::integer,released,p_now,clock_timestamp());
  count:=count+1;
 end loop;
 return count;
end $$;
revoke all on function public.service_process_workshop_overdues(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.service_process_workshop_overdues(uuid,timestamptz) to service_role;

alter function public.service_seed_due_demi_followups(uuid,timestamptz) rename to service_seed_due_demi_followups_before_workshops;
create function public.service_seed_due_demi_followups(p_studio uuid,p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path='' as $$
declare count integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 count:=public.service_seed_due_demi_followups_before_workshops(p_studio,p_now);
 perform public.service_process_workshop_overdues(p_studio,p_now);
 return count+public.service_seed_workshop_followups(p_studio,p_now);
end $$;
revoke all on function public.service_seed_due_demi_followups_before_workshops(uuid,timestamptz),public.service_seed_due_demi_followups(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.service_seed_due_demi_followups(uuid,timestamptz) to service_role;

create or replace function public.service_claim_demi_followups(p_studio uuid,p_now timestamptz default clock_timestamp(),p_limit integer default 25)
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
  if reason is not null then update public.demi_followups set state='cancelled',reason_code=reason where studio_id=f.studio_id and person_id=f.person_id and state='pending' and (f.kind<>'workshop' or id=f.id); continue; end if;
  if exists(select 1 from public.demi_followups where studio_id=f.studio_id and person_id=f.person_id and kind=f.kind and source_ref=f.source_ref and step<f.step and state<>'accepted') then continue; end if;
  update public.demi_followups set state='processing',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_until=p_now+interval '2 minutes' where id=f.id returning * into f;
  return next f; claimed:=claimed+1;
  if claimed>=least(greatest(p_limit,1),100) then exit; end if;
 end loop;
end; $$;


create or replace function public.admin_save_demi_followup_settings(p_studio uuid,p_enabled boolean,p_interval integer,p_templates jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_capability(p_studio,'settings.write') then raise exception 'forbidden'; end if;
 if p_interval is null or p_interval not between 1 and 720 or jsonb_typeof(p_templates) is distinct from 'object' then raise exception 'invalid_followup_settings'; end if;
 if exists(select 1 from jsonb_each(p_templates) e where e.key !~ '^((prospect|post_trial|package|enrollment|inactive|package_expiring|package_expired)_[123]|prospect_(information|awaiting_receipt|awaiting_participants)_[12]|workshop_[123])$' or jsonb_typeof(e.value) is distinct from 'object' or coalesce(e.value->>'name','') !~ '^[a-z0-9_]{1,512}$' or (e.value ? 'components' and jsonb_typeof(e.value->'components') is distinct from 'array') or (e.value ? 'bind_message_body' and jsonb_typeof(e.value->'bind_message_body') is distinct from 'boolean')) then raise exception 'invalid_meta_template'; end if;
 insert into public.demi_followup_settings(studio_id,enabled,prospect_interval_hours,templates) values(p_studio,p_enabled,p_interval,p_templates)
 on conflict(studio_id) do update set enabled=excluded.enabled,prospect_interval_hours=excluded.prospect_interval_hours,templates=excluded.templates;
 if not p_enabled then update public.demi_followups set state='cancelled',reason_code='followups_disabled',lease_token=null,lease_until=null where studio_id=p_studio and state in ('pending','processing'); end if;
 return jsonb_build_object('ok',true);
end; $$;
-- A booking in another class does not cancel an outstanding workshop decision.
CREATE OR REPLACE FUNCTION private.stop_demi_followups_on_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare person uuid; reason text;
begin
 if tg_table_name='reservations' then
  if new.status not in ('reserved','attended') then return new; end if;
  reason:=case when new.status='attended' then 'attendance_recorded' else 'reservation_exists' end;
 else
  if new.status<>'active' or new.refunded_at is not null then return new; end if;
  reason:=case when tg_table_name='student_enrollments' then 'enrollment_renewed' else 'package_renewed' end;
 end if;
 select person_id into person from public.students where id=new.student_id and studio_id=new.studio_id;
 update public.demi_followups set state='cancelled',reason_code=reason,lease_token=null,lease_until=null
 where studio_id=new.studio_id and person_id=person and state in ('pending','processing') and kind<>'workshop'
 and (tg_table_name='reservations' or (tg_table_name='student_enrollments' and kind='enrollment') or (tg_table_name='product_acquisitions' and kind in ('package','package_expiring','package_expired')));
 return new;
end; $function$
;
