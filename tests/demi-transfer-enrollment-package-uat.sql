-- DEMI-PROS-03B · UAT for 20261021200000_demi_transfer_enrollment_and_package (Sandbox only, rollback).
-- C1 student without enrollment: preview + prepare charge enrollment + package.
-- C2 product with included enrollment: no extra charge.
-- C3 student with active enrollment: package only.
-- C4 grants: preview is service-only.
begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  owner uuid; run jsonb; s uuid; st uuid; c uuid := gen_random_uuid(); pack uuid; enr uuid;
  pack_price integer; enr_price integer; r jsonb; intent uuid; local_today date;
begin
  select user_id into owner from public.studio_memberships
  where studio_id='9fe23cfa-fb47-4670-afeb-ed4a56433772' and role='owner' and active limit 1;
  run := public.service_create_demi_uat_run('9fe23cfa-fb47-4670-afeb-ed4a56433772',owner,'demi-pros-03b-enrollment');
  s := (run->>'studio_id')::uuid;
  -- Enrollment eligibility uses the studio day, which can differ from UTC after midnight.
  select (clock_timestamp() at time zone timezone)::date into local_today from public.studios where id=s;
  select id,price_minor into pack,pack_price from public.product_templates where studio_id=s and name='Paquete UAT 8 clases';
  select id,price_minor into enr,enr_price from public.product_templates where studio_id=s and product_type='enrollment';
  -- Use the named fixture instead of calling a private helper unavailable to service_role.
  st := (run#>>'{fixtures,people,trial_payment_rejected,student_id}')::uuid;
  if exists(select 1 from public.student_enrollments where studio_id=s and student_id=st
    and status='active' and starts_on<=local_today and (expires_on is null or expires_on>=local_today))
  then raise exception 'fixture_already_enrolled'; end if;
  if st is null or pack is null or enr is null then raise exception 'fixtures_missing'; end if;
  update public.enrollment_policies set enabled=true,required_for_package_purchase=true,enrollment_product_template_id=enr where studio_id=s;
  update public.product_templates set enrollment_included=false where id=pack;
  insert into public.assistant_conversations(id,studio_id,channel,external_thread_ref,student_id) values (c,s,'whatsapp','pros03b-'||c,st);

  r := public.service_preview_transfer_purchase(s,st,pack);
  if r->>'enrollment_required'<>'true' or (r->>'total_amount_minor')::int<>pack_price+enr_price then raise exception 'C1_preview:%',r; end if;
  if exists(select 1 from public.assistant_transfer_purchase_intents where conversation_id=c) then raise exception 'C1_preview_created_intent'; end if;
  r := public.service_prepare_transfer_purchase(s,c,st,null,pack);
  if r->>'ok'<>'true' or r->>'enrollment_required'<>'true' or (r->>'total_amount_minor')::int<>pack_price+enr_price then raise exception 'C1_prepare:%',r; end if;
  intent := (r->>'intent_id')::uuid;
  if (select amount_minor from public.assistant_transfer_purchase_intents where id=intent)<>pack_price+enr_price then raise exception 'C1_amount'; end if;
  if (select enrollment_product_template_id from public.assistant_transfer_purchase_intents where id=intent)<>enr then raise exception 'C1_enrollment_ref'; end if;

  update public.product_templates set enrollment_included=true where id=pack;
  r := public.service_preview_transfer_purchase(s,st,pack);
  if r->>'enrollment_required'<>'false' or (r->>'total_amount_minor')::int<>pack_price then raise exception 'C2_included:%',r; end if;

  update public.product_templates set enrollment_included=false where id=pack;
  insert into public.student_enrollments(studio_id,student_id,status,starts_on,expires_on,resolution_type,resolution_reason)
  values (s,st,'active',local_today,local_today+365,'exception','UAT inscripción vigente');
  r := public.service_preview_transfer_purchase(s,st,pack);
  if r->>'enrollment_required'<>'false' or (r->>'total_amount_minor')::int<>pack_price then raise exception 'C3_active_enrollment:%',r; end if;

  if has_function_privilege('authenticated','public.service_preview_transfer_purchase(uuid,uuid,uuid)','EXECUTE') then raise exception 'C4_permissions'; end if;
end $$;
select 'passed' result, 4 controls, 'synthetic tenant; rollback; activation with receipt to be checked in the WhatsApp/bank UAT' scope;
rollback;
