-- Keep existing Demi data and separate Polina configuration and histories.
alter table public.assistant_configs add column assistant_key text not null default 'demi' check(assistant_key in ('demi','polina'));
alter table public.assistant_configs drop constraint assistant_configs_pkey;
alter table public.assistant_configs add primary key(studio_id,assistant_key);
alter table public.assistant_prompt_versions add column assistant_key text not null default 'demi' check(assistant_key in ('demi','polina'));
create index assistant_prompt_versions_assistant_idx on public.assistant_prompt_versions(studio_id,assistant_key);
alter table public.assistant_handoff_policies add column assistant_key text not null default 'demi' check(assistant_key in ('demi','polina'));
create index assistant_handoff_policies_assistant_idx on public.assistant_handoff_policies(studio_id,assistant_key);
alter table public.assistant_learning_proposals add column assistant_key text not null default 'demi' check(assistant_key in ('demi','polina'));
create index assistant_learning_proposals_assistant_idx on public.assistant_learning_proposals(studio_id,assistant_key);
alter table public.assistant_conversations add column assistant_key text not null default 'demi' check(assistant_key in ('demi','polina'));
create index assistant_conversations_assistant_idx on public.assistant_conversations(studio_id,assistant_key);
alter table public.assistant_model_calls add column assistant_key text not null default 'demi' check(assistant_key in ('demi','polina'));
create index assistant_model_calls_assistant_idx on public.assistant_model_calls(studio_id,assistant_key);
alter table public.assistant_handoff_policies drop constraint assistant_handoff_policies_studio_id_reason_code_key;
alter table public.assistant_handoff_policies add unique(studio_id,assistant_key,reason_code);
insert into public.assistant_configs select (jsonb_populate_record(null::public.assistant_configs,to_jsonb(c)||jsonb_build_object('assistant_key','polina','assistant_name','Polina','personality_instructions','Eres Polina, asistente de las alumnas del estudio. StudioFlow es tu única fuente de verdad. Consulta herramientas para reservas, cancelaciones, renovaciones y recompensas; nunca inventes datos ni eludas políticas. Toda acción requiere la confirmación prevista por el motor. Solicitudes de reembolso, disputas y lesiones pasan a una persona.'))).* from public.assistant_configs c where c.assistant_key='demi';
insert into public.assistant_prompt_versions(studio_id,assistant_key,kind,instructions,note)
select studio_id,'polina','baseline',personality_instructions,'Configuración inicial de Polina' from public.assistant_configs where assistant_key='polina';
insert into public.assistant_handoff_policies(studio_id,assistant_key,reason_code,label,description,enabled,blocking,sort_order)
select studio_id,'polina',reason_code,label,description,enabled,blocking,sort_order from public.assistant_handoff_policies where assistant_key='demi';
CREATE OR REPLACE FUNCTION public.admin_activate_assistant_prompt(p_studio_id uuid, p_assistant_key text, p_version_id uuid, p_expected_active text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_current text;
  v_instructions text;
begin
  if auth.uid() is null or not private.has_capability(p_studio_id, 'settings.write') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select personality_instructions into v_current from public.assistant_configs
    where studio_id = p_studio_id and assistant_key=p_assistant_key for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'assistant_not_configured'); end if;
  if v_current is distinct from p_expected_active then
    return jsonb_build_object('ok', false, 'error', 'active_prompt_changed');
  end if;
  select instructions into v_instructions from public.assistant_prompt_versions
    where id = p_version_id and studio_id = p_studio_id and assistant_key=p_assistant_key;
  if not found or length(trim(v_instructions)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'prompt_version_not_found');
  end if;
  insert into public.assistant_prompt_versions(studio_id, assistant_key, kind, instructions, note, created_by)
    values(p_studio_id, p_assistant_key, 'activation', v_instructions, 'Versión activada explícitamente', auth.uid());
  update public.assistant_configs set personality_instructions = v_instructions,
    updated_at = clock_timestamp() where studio_id = p_studio_id and assistant_key=p_assistant_key;
  return jsonb_build_object('ok', true);
end;
$function$
;
create or replace function public.admin_activate_demi_prompt(p_studio_id uuid,p_version_id uuid,p_expected_active text) returns jsonb language sql set search_path='' as $$ select public.admin_activate_assistant_prompt(p_studio_id,'demi',p_version_id,p_expected_active); $$;
revoke all on function public.admin_activate_assistant_prompt(uuid,text,uuid,text) from public,anon;
grant execute on function public.admin_activate_assistant_prompt(uuid,text,uuid,text) to authenticated;
create or replace function private.tag_assistant_model_call() returns trigger language plpgsql set search_path='' as $$
begin
 select assistant_key into new.assistant_key from public.assistant_conversations where id=new.conversation_id and studio_id=new.studio_id;
 if new.assistant_key is null then raise exception 'assistant_conversation_not_found'; end if;
 return new;
end; $$;
create trigger assistant_model_call_tag before insert on public.assistant_model_calls for each row execute function private.tag_assistant_model_call();
CREATE OR REPLACE FUNCTION public.service_create_demi_uat_run(p_source_studio uuid, p_owner uuid, p_commit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 s uuid:=gen_random_uuid(); run uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
 single_class uuid:=gen_random_uuid(); pack uuid:=gen_random_uuid(); trial_product uuid:=gen_random_uuid(); enrollment_product uuid:=gen_random_uuid();
 location uuid; local_today date; person uuid; student uuid; acquisition uuid; reservation uuid; session uuid; base timestamptz;
 v_fixtures jsonb:='{"people":{},"sessions":{}}'; config jsonb; p jsonb; source_rule record; target_rule uuid; name text; phone text; k text; n integer:=0;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.studio_memberships where studio_id=p_source_studio and user_id=p_owner and active) then raise exception 'source_membership_required'; end if;
 select to_jsonb(c) into config from public.assistant_configs c where studio_id=p_source_studio and assistant_key='demi';
 if config is null then raise exception 'source_assistant_missing'; end if;
 insert into public.studios(id,name,slug,timezone,currency) select s,'Demi UAT · '||left(run::text,8),'demi-uat-'||run,timezone,currency from public.studios where id=p_source_studio;
 select (clock_timestamp() at time zone timezone)::date into local_today from public.studios where id=s;
 insert into public.demi_uat_runs(id,source_studio_id,studio_id,owner_id,baseline)
 values(run,p_source_studio,s,p_owner,jsonb_build_object('commit',p_commit,'source_config_hash',md5(config::text),'source_config',config,'snapshot_at',clock_timestamp(),'transport','captured','external_provider_verified',false));
 insert into public.assistant_configs select (jsonb_populate_record(null::public.assistant_configs,config||jsonb_build_object('studio_id',s,'mode','active','created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
 insert into public.studio_plan_assignments(studio_id,plan_id,status,metadata) select s,plan_id,status,jsonb_build_object('demi_uat_run',run,'synthetic',true) from public.studio_plan_assignments where studio_id=p_source_studio;
 insert into public.studio_memberships(studio_id,user_id,role,active) select s,p_owner,role,true from public.studio_memberships where studio_id=p_source_studio and user_id=p_owner and active;
 insert into public.assistant_admin_rules select (jsonb_populate_record(null::public.assistant_admin_rules,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'studio_id',s,'source_request_id',null))).* from public.assistant_admin_rules x where studio_id=p_source_studio;
 insert into public.assistant_booking_behaviors(studio_id,prospect_require_payment_before_booking) values(s,true);
 insert into public.disciplines(id,studio_id,name) values(d,s,'Pole Fitness');
 insert into public.class_templates(id,studio_id,discipline_id,name,duration_minutes,capacity,drop_in_price_minor,description) values(t,s,d,'Pole Fitness UAT',60,5,15000,'Sesión ficticia para UAT.');
 select to_jsonb(x) into p from public.product_templates x where studio_id=p_source_studio and product_type='package' and credit_limit=8 and active order by assistant_visible desc,created_at desc limit 1;
 if p is null then raise exception 'source_eight_class_package_missing'; end if;
 insert into public.product_templates select (jsonb_populate_record(null::public.product_templates,p||jsonb_build_object('id',pack,'studio_id',s,'source_class_template_id',null,'name','Paquete UAT 8 clases','online_purchasable',false,'assistant_visible',true,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
 insert into public.product_templates(id,studio_id,name,product_type,price_minor,currency,credit_limit,validity_days,online_purchasable) values(trial_product,s,'Primera clase UAT','other',15000,'MXN',1,1,false),(enrollment_product,s,'Inscripción UAT','enrollment',20000,'MXN',null,365,false);
 insert into public.product_template_activities(studio_id,product_template_id,class_template_id) values(s,pack,t),(s,trial_product,t);
 insert into public.product_template_disciplines(studio_id,product_template_id,discipline_id) values(s,pack,d),(s,trial_product,d);
 -- Copy an actual configured single-class offer; never treat the trial product as a regular offer.
 select to_jsonb(x) into p from public.product_templates x where studio_id=p_source_studio and product_type='single_class' and active and currency='MXN' and price_minor=15000 order by created_at desc limit 1;
 if p is not null then
  insert into public.product_templates select (jsonb_populate_record(null::public.product_templates,p||jsonb_build_object('id',single_class,'studio_id',s,'source_class_template_id',t,'name','Clase suelta UAT','online_purchasable',false,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
  insert into public.product_template_activities(studio_id,product_template_id,class_template_id) values(s,single_class,t) on conflict do nothing;
  insert into public.product_template_disciplines(studio_id,product_template_id,discipline_id) values(s,single_class,d) on conflict do nothing;
 else single_class:=null;
 end if;
 insert into public.trial_booking_policies(studio_id,enabled,allow_without_enrollment_until_first_attendance,max_active_trial_reservations,prepayment_after_no_shows,require_payment_before_attendance,require_payment_before_booking,trial_payment_product_template_id) values(s,true,true,1,2,true,true,trial_product);
 insert into public.enrollment_policies select (jsonb_populate_record(null::public.enrollment_policies,to_jsonb(x)||jsonb_build_object('studio_id',s,'enrollment_product_template_id',enrollment_product))).* from public.enrollment_policies x where studio_id=p_source_studio;
 insert into public.studio_operating_policies select (jsonb_populate_record(null::public.studio_operating_policies,to_jsonb(x)||jsonb_build_object('studio_id',s,'cancellation_cutoff_minutes',300,'no_show_consumes_credit',true,'updated_by_user_id',null))).* from public.studio_operating_policies x where studio_id=p_source_studio on conflict(studio_id) do update set cancellation_cutoff_minutes=300,no_show_consumes_credit=true;
 insert into public.studio_bank_transfer_settings(studio_id,enabled,bank_name,account_holder,account_number,instructions) values(s,true,'BANCO FICTICIO UAT — NO TRANSFERIR','PRUEBA SIN VALOR','0000','No realizar pagos reales.');
 insert into public.studio_payment_methods(studio_id,code,name,category,active) values(s,'bank_transfer','Transferencia UAT','transfer',true),(s,'cash','Efectivo UAT','cash',true) on conflict(studio_id,code) do update set name=excluded.name,active=true;
 insert into public.assistant_handoff_policies select (jsonb_populate_record(null::public.assistant_handoff_policies,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'studio_id',s))).* from public.assistant_handoff_policies x where studio_id=p_source_studio;
 -- No live communication provider is installed on this tenant.
 update public.notification_rules set enabled=false where studio_id=s;
 update public.notification_studio_channel_providers set enabled=false where studio_id=s;
 -- Clone current notification definitions without cloning live provider credentials.
 for source_rule in select * from public.notification_rules where studio_id=p_source_studio and archived_at is null loop
  select id into target_rule from public.notification_rules where studio_id=s and rule_key=source_rule.rule_key and archived_at is null;
  if target_rule is null then
   target_rule:=gen_random_uuid();
   insert into public.notification_rules select (jsonb_populate_record(null::public.notification_rules,to_jsonb(source_rule)||jsonb_build_object('id',target_rule,'studio_id',s,'enabled',false))).*;
  end if;
  insert into public.notification_rule_versions select (jsonb_populate_record(null::public.notification_rule_versions,to_jsonb(x)||jsonb_build_object('studio_id',s,'rule_id',target_rule))).* from public.notification_rule_versions x where rule_id=source_rule.id
  on conflict(studio_id,rule_id,version_number) do update set conditions=excluded.conditions,timing_strategy_key=excluded.timing_strategy_key,timing_config=excluded.timing_config,template_key=excluded.template_key,revalidation_strategy_key=excluded.revalidation_strategy_key;
  insert into public.notification_rule_channels select (jsonb_populate_record(null::public.notification_rule_channels,to_jsonb(x)||jsonb_build_object('studio_id',s,'rule_id',target_rule))).* from public.notification_rule_channels x where rule_id=source_rule.id
  on conflict(rule_id,version_number,channel_key) do update set is_required=excluded.is_required,ordinal=excluded.ordinal,channel_policy=excluded.channel_policy;
  update public.notification_rules set current_version_number=source_rule.current_version_number,enabled=source_rule.enabled where id=target_rule;
 end loop;
 select gen_random_uuid() into location from public.studio_locations where studio_id=p_source_studio and active and is_primary limit 1;
 if location is not null then
  insert into public.studio_locations(id,studio_id,name,address,active,is_primary) select location,s,l.name,l.address,true,true from public.studio_locations l where l.studio_id=p_source_studio and l.active and l.is_primary limit 1;
 end if;
 base:=((clock_timestamp() at time zone 'America/Mexico_City')::date+1+time '18:00') at time zone 'America/Mexico_City';
 foreach k in array array['available','alternative','full','timely','late','past'] loop
  session:=gen_random_uuid();
  insert into public.class_sessions(id,studio_id,template_id,location_id,starts_at,ends_at,capacity,notes)
  values(session,s,t,location,case k when 'timely' then clock_timestamp()+interval '6 hours' when 'late' then clock_timestamp()+interval '4 hours' when 'past' then clock_timestamp()-interval '2 hours' when 'alternative' then base+interval '1 day' else base end,
   case k when 'timely' then clock_timestamp()+interval '7 hours' when 'late' then clock_timestamp()+interval '5 hours' when 'past' then clock_timestamp()-interval '1 hour' when 'alternative' then base+interval '1 day 1 hour' else base+interval '1 hour' end,case when k='full' then 1 else 5 end,'UAT '||k);
  v_fixtures:=jsonb_set(v_fixtures,array['sessions',k],to_jsonb(session));
 end loop;
 foreach k in array array['prospect','prospect_existing','trial_reserved','trial_cancelled','trial_no_show','trial_attended','trial_payment_rejected','student_active','student_expired_package','student_cash','former_active_package','former_no_package','companion','full_filler'] loop
  n:=n+1; phone:='+52999'||lpad(n::text,7,'0'); student:=null; person:=null;
  if k<>'prospect' and k<>'companion' then
   person:=gen_random_uuid(); insert into public.persons(id,studio_id,first_name,last_name) values(person,s,'UAT',k);
   insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(s,person,'phone',phone,true);
   if k='prospect_existing' then
    insert into public.crm_contacts(studio_id,person_id,lifecycle_status,source) values(s,person,'prospect','demi_uat');
   else
    student:=gen_random_uuid();
    insert into public.students(id,studio_id,person_id,full_name,phone,student_type,trial_status) values(student,s,person,'UAT '||k,phone,case when k like 'trial_%' then 'trial'::public.student_type else 'regular'::public.student_type end,case k when 'trial_cancelled' then 'cancelled'::public.trial_status when 'trial_no_show' then 'no_show'::public.trial_status when 'trial_attended' then 'attended'::public.trial_status when 'trial_reserved' then 'pending'::public.trial_status when 'trial_payment_rejected' then 'cancelled'::public.trial_status else null end);
    if k like 'student_%' or k like 'former_%' or k='full_filler' then
     insert into public.student_enrollments(studio_id,student_id,status,starts_on,expires_on) values(s,student,'active',local_today-30,case when k like 'former_%' then local_today-1 else local_today+335 end);
    end if;
    if k in ('student_active','student_expired_package','former_active_package','full_filler','trial_reserved') then
     acquisition:=gen_random_uuid();
     insert into public.product_acquisitions(id,studio_id,student_id,product_template_id,starts_on,expires_on,credit_limit) values(acquisition,s,student,case when k='trial_reserved' then trial_product else pack end,local_today-1,case when k='student_expired_package' then local_today-1 else local_today+29 end,case when k='trial_reserved' then 1 else 8 end);
     insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note) values(s,acquisition,'grant',case when k='trial_reserved' then 1 else 8 end,'UAT initial fixture');
     if k in ('trial_reserved','full_filler') then
      reservation:=gen_random_uuid(); session:=(v_fixtures#>>array['sessions',case when k='full_filler' then 'full' else 'timely' end])::uuid;
      insert into public.reservations(id,studio_id,student_id,session_id,acquisition_id,credits_held,status) values(reservation,s,student,session,acquisition,1,'reserved');
      insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,reservation_id,note) values(s,acquisition,'reserve',-1,reservation,'UAT initial fixture');
     end if;
    end if;
   end if;
  end if;
  v_fixtures:=jsonb_set(v_fixtures,array['people',k],jsonb_build_object('phone',phone,'wa_id',substring(phone from 2),'student_id',student,'person_id',person));
 end loop;
 v_fixtures:=v_fixtures||jsonb_build_object('products',jsonb_build_object('package',pack,'trial',trial_product,'enrollment',enrollment_product,'single_class',single_class));
 update public.demi_uat_runs set fixtures=v_fixtures where id=run;
 insert into public.demi_uat_artifacts(run_id,kind,payload) values(run,'seed',jsonb_build_object('studio_id',s,'fixtures',v_fixtures,'outbound_provider','capture_only'));
 return jsonb_build_object('id',run,'studio_id',s,'fixtures',v_fixtures);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_apply_demi_change_plan(p_studio_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request public.assistant_admin_change_requests%rowtype;
  v_action jsonb;
  v_type text;
  v_field text;
  v_count integer;
begin
  if auth.uid() is null or not private.has_capability(p_studio_id,'settings.write') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  select * into v_request
  from public.assistant_admin_change_requests
  where id=p_request_id and studio_id=p_studio_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','request_not_found'); end if;
  if v_request.status<>'proposed' then return jsonb_build_object('ok',false,'error','request_not_proposed'); end if;

  for v_action in select value from jsonb_array_elements(coalesce(v_request.plan->'actions','[]'::jsonb))
  loop
    v_type := coalesce(v_action->>'type','');

    if v_type='set_booking_behavior' then
      v_field := coalesce(v_action->>'field','');
      if v_field<>'prospect_require_payment_before_booking' then
        raise exception 'unsupported_booking_behavior_field';
      end if;
      update public.assistant_booking_behaviors
      set prospect_require_payment_before_booking=(v_action->>'value')::boolean,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id;
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'assistant_booking_behavior_not_found'; end if;

    elsif v_type='set_handoff_policy' then
      update public.assistant_handoff_policies
      set enabled=case when v_action ? 'enabled' then (v_action->>'enabled')::boolean else enabled end,
          blocking=case when v_action ? 'blocking' then (v_action->>'blocking')::boolean else blocking end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and assistant_key='demi' and reason_code=v_action->>'reason_code';
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'handoff_policy_not_found'; end if;

    elsif v_type='set_product' then
      update public.product_templates
      set price_minor=case when v_action ? 'price_minor' then (v_action->>'price_minor')::integer else price_minor end,
          active=case when v_action ? 'active' then (v_action->>'active')::boolean else active end,
          assistant_visible=case when v_action ? 'assistant_visible' then (v_action->>'assistant_visible')::boolean else assistant_visible end,
          online_purchasable=case when v_action ? 'online_purchasable' then (v_action->>'online_purchasable')::boolean else online_purchasable end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and name=v_action->>'product_name';
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'product_not_found_or_ambiguous'; end if;

    elsif v_type='set_class_price' then
      update public.class_templates
      set drop_in_price_minor=case when jsonb_typeof(v_action->'price_minor')='null' then null else (v_action->>'price_minor')::integer end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and name=v_action->>'activity_name' and active=true;
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'activity_not_found_or_ambiguous'; end if;

    elsif v_type='upsert_rule' then
      insert into public.assistant_admin_rules(
        studio_id,rule_key,category,instruction,enabled,source_request_id,created_by,updated_by
      ) values(
        p_studio_id,
        v_action->>'rule_key',
        v_action->>'category',
        v_action->>'instruction',
        coalesce((v_action->>'enabled')::boolean,true),
        p_request_id,
        auth.uid(),
        auth.uid()
      )
      on conflict(studio_id,rule_key) do update set
        category=excluded.category,
        instruction=excluded.instruction,
        enabled=excluded.enabled,
        source_request_id=excluded.source_request_id,
        updated_by=auth.uid(),
        updated_at=clock_timestamp();

    else
      raise exception 'unsupported_admin_action';
    end if;
  end loop;

  update public.assistant_admin_change_requests
  set status='applied',applied_by=auth.uid(),applied_at=clock_timestamp(),updated_at=clock_timestamp(),error_code=null
  where id=p_request_id and studio_id=p_studio_id;

  return jsonb_build_object('ok',true,'status','applied');
exception when others then
  return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$function$
;

