-- Sandbox hedouonyhynuvwbckdlg ONLY. Existing captured UAT bank, no provider
-- connection or outbound message. Reuses a run on replay; never resets evidence.
do $prepare$
declare
  source_studio uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772';
  v_owner uuid:='7d2ba6d7-f133-46b3-832c-7c338a4b8924';
  candidate text:=current_setting('uat.demi_workshop_candidate');
  seeded jsonb; run public.demi_uat_runs%rowtype;
  offer uuid:=gen_random_uuid(); template uuid:=gen_random_uuid(); discipline uuid;
  sessions uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  first_date timestamptz; details jsonb;
begin
  if candidate !~ '^[0-9a-f]{40}$'
    or not exists(select 1 from public.studio_memberships where studio_id=source_studio and user_id=v_owner and active)
    or to_regprocedure('public.service_register_demi_workshop_participant(uuid,uuid,uuid,uuid,text)') is null
  then raise exception 'workshop_uat_sandbox_precondition'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('DEMI-TALL:captured-uat-20261023',0));
  select * into run from public.demi_uat_runs where baseline->>'task'='DEMI-TALL' and owner_id=v_owner
    and source_studio_id=source_studio order by created_at limit 1;
  if found then
    perform set_config('uat.demi_workshop_prepared',jsonb_build_object('run_id',run.id,'studio_id',run.studio_id,'fixtures',run.fixtures->'workshops','replayed',true)::text,false);
    return;
  end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  seeded:=public.service_create_demi_uat_run(source_studio,v_owner,candidate);
  select * into run from public.demi_uat_runs where id=(seeded->>'id')::uuid;
  if not found then raise exception 'workshop_uat_run_missing'; end if;
  select id into discipline from public.disciplines where studio_id=run.studio_id and active order by id limit 1;
  if discipline is null then raise exception 'workshop_uat_discipline_missing'; end if;
  first_date:=(((now() at time zone 'America/Mexico_City')::date+45)+time '10:00') at time zone 'America/Mexico_City';
  update public.studios set name='Demi Talleres UAT · '||left(run.id::text,8) where id=run.studio_id;
  insert into public.workshop_studio_policies(studio_id,demi_enabled,requires_enrollment) values(run.studio_id,true,false);
  insert into public.workshop_offers(id,studio_id,title,full_price_minor,allow_individual_sessions,requires_enrollment,deposit_mode,deposit_value,balance_due_at,overdue_mode)
    values(offer,run.studio_id,'Demi UAT · Taller completo 600',60000,true,false,'fixed',30000,first_date,'keep_and_notify');
  insert into public.class_templates(id,studio_id,discipline_id,name,duration_minutes,capacity,active,workshop_offer_id)
    values(template,run.studio_id,discipline,'Demi UAT · Taller completo 600',60,4,false,offer);
  for i in 1..3 loop
    insert into public.class_sessions(id,studio_id,template_id,starts_at,ends_at,capacity,assistant_visible)
      values(sessions[i],run.studio_id,template,first_date+make_interval(days=>i-1),first_date+make_interval(days=>i-1,hours=>1),4,true);
    insert into public.workshop_offer_sessions(offer_id,session_id,individual_price_minor) values(offer,sessions[i],15000);
  end loop;
  insert into public.studio_payment_methods(studio_id,code,name,active) values(run.studio_id,'bank_transfer','Transferencia sintética',true) on conflict do nothing;
  insert into public.studio_bank_transfer_settings(studio_id,enabled,bank_name,account_holder,instructions)
    values(run.studio_id,true,'Banco sintético','UAT · NO TRANSFERIR','Prueba capturada: no realizar transferencias ni depósitos reales.')
    on conflict(studio_id) do update set enabled=true,bank_name=excluded.bank_name,account_holder=excluded.account_holder,
      clabe=null,account_number=null,card_number=null,instructions=excluded.instructions;
  details:=jsonb_build_object('offer_id',offer,'title','Demi UAT · Taller completo 600','session_ids',sessions,
    'full_price_minor',60000,'individual_price_minor',15000,'deposit_minor',30000,'first_date',first_date,
    'timezone','America/Mexico_City','transport','capture_only');
  update public.demi_uat_runs set fixtures=fixtures||jsonb_build_object('workshops',details),
    baseline=baseline||jsonb_build_object('task','DEMI-TALL','workshop_candidate',candidate) where id=run.id;
  perform set_config('uat.demi_workshop_prepared',jsonb_build_object('run_id',run.id,'studio_id',run.studio_id,'fixtures',details,'replayed',false)::text,false);
end $prepare$;
select current_setting('uat.demi_workshop_prepared')::jsonb as prepared;
