begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $uat$
declare
  source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772';
  owner uuid; fixture jsonb; studio uuid; student uuid; product uuid;
  conversation uuid:=gen_random_uuid(); purchase_key uuid:=gen_random_uuid();
  source_product uuid; price integer; result jsonb; sale uuid; acquisition uuid;
  outcomes jsonb:='[]';
begin
  if current_user <> 'service_role' then raise exception 'incorrect_database_role'; end if;
  if (select prosecdef from pg_proc where oid='public.service_create_demi_cash_purchase(uuid,uuid,uuid,uuid,uuid,integer)'::regprocedure)
     or has_function_privilege('service_role','private.product_purchase_eligibility(uuid,uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.service_product_purchase_eligibility(uuid,uuid,uuid)','EXECUTE')
  then raise exception 'cash_privilege_boundary_changed'; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','invoker_and_private_helper_boundary_preserved','passed',true));
  select user_id into owner from public.studio_memberships where studio_id=source and active and role='owner' limit 1;
  fixture:=public.service_create_demi_uat_run(source,owner,'cash-eligibility-boundary-uat');
  studio:=(fixture->>'studio_id')::uuid;
  student:=(fixture#>>'{fixtures,people,student_cash,student_id}')::uuid;
  product:=(fixture#>>'{fixtures,products,package}')::uuid;
  select price_minor into price from public.product_templates where id=product and studio_id=studio;
  select id into source_product from public.product_templates where studio_id=source and active and product_type='package' limit 1;
  if source_product is null then raise exception 'missing_cross_studio_product_fixture'; end if;
  insert into public.assistant_conversations(id,studio_id,student_id,channel) values(conversation,studio,student,'internal_demo');

  result:=public.service_create_demi_cash_purchase(source,conversation,student,product,gen_random_uuid(),price);
  if result->>'reason_code' is distinct from 'cash_students_only' then raise exception 'cross_studio_student:%',result; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','cross_studio_student_rejected','passed',true));
  result:=public.service_create_demi_cash_purchase(studio,gen_random_uuid(),student,product,gen_random_uuid(),price);
  if result->>'reason_code' is distinct from 'conversation_identity_mismatch' then raise exception 'wrong_conversation:%',result; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','conversation_identity_preserved','passed',true));
  result:=public.service_create_demi_cash_purchase(studio,conversation,student,source_product,gen_random_uuid(),price);
  if result->>'reason_code' is distinct from 'cash_package_not_available' then raise exception 'cross_studio_product:%',result; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','cross_studio_product_rejected','passed',true));
  update public.students set active=false where id=student and studio_id=studio;
  result:=public.service_create_demi_cash_purchase(studio,conversation,student,product,gen_random_uuid(),price);
  if result->>'reason_code' is distinct from 'cash_students_only' then raise exception 'inactive_student:%',result; end if;
  update public.students set active=true where id=student and studio_id=studio;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','inactive_student_rejected','passed',true));
  result:=public.service_create_demi_cash_purchase(studio,conversation,student,product,gen_random_uuid(),price+1);
  if result->>'reason_code' is distinct from 'purchase_price_changed' then raise exception 'wrong_price:%',result; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','price_revalidated','passed',true));
  update public.studio_payment_methods set active=false where studio_id=studio and code='cash';
  result:=public.service_create_demi_cash_purchase(studio,conversation,student,product,gen_random_uuid(),price);
  if result->>'reason_code' is distinct from 'cash_payment_disabled' then raise exception 'disabled_cash:%',result; end if;
  update public.studio_payment_methods set active=true where studio_id=studio and code='cash';
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','disabled_cash_rejected','passed',true));
  update public.product_templates set enrollment_included=true where id=product and studio_id=studio;
  result:=public.service_create_demi_cash_purchase(studio,conversation,student,product,gen_random_uuid(),price);
  if result->>'reason_code' is distinct from 'included_enrollment_requires_online_or_staff_checkout' then raise exception 'included_enrollment:%',result; end if;
  update public.product_templates set enrollment_included=false where id=product and studio_id=studio;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','included_enrollment_restriction_preserved','passed',true));

  result:=public.service_create_demi_cash_purchase(studio,conversation,student,product,purchase_key,price);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'eligible_cash_failed:%',result; end if;
  sale:=(result->>'sale_id')::uuid; acquisition:=(result->>'acquisition_id')::uuid;
  update public.product_templates set purchase_limit_per_student=1 where id=product and studio_id=studio;
  result:=public.service_create_demi_cash_purchase(studio,conversation,student,product,gen_random_uuid(),price);
  if result->>'reason_code' is distinct from 'purchase_limit_reached' then raise exception 'purchase_limit:%',result; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','purchase_limit_enforced_by_existing_eligibility','passed',true));
  result:=public.service_create_demi_cash_purchase(studio,conversation,student,product,purchase_key,price);
  if result->>'idempotent' is distinct from 'true' or result->>'sale_id' is distinct from sale::text then raise exception 'limited_purchase_replay:%',result; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','replay_preserves_sale_despite_reached_limit','passed',true));
  update public.product_templates set purchase_limit_per_student=null,purchase_eligibility='new_customer' where id=product and studio_id=studio;
  result:=public.service_create_demi_cash_purchase(studio,conversation,student,product,gen_random_uuid(),price);
  if result->>'reason_code' is distinct from 'new_customer_only' then raise exception 'new_customer:%',result; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','new_customer_only_enforced','passed',true));
  if (select count(*) from public.demi_cash_purchases where studio_id=studio and student_id=student)<>1
     or exists(select 1 from public.payments where sale_id=sale)
     or exists(select 1 from public.reservations where studio_id=studio and student_id=student)
     or exists(select 1 from public.assistant_handoffs where studio_id=studio and conversation_id=conversation)
     or (select sum(quantity) from public.credit_ledger where acquisition_id=acquisition)<>8
  then raise exception 'cash_rejection_or_choice_caused_extra_effect'; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','one_debt_no_payment_reservation_or_automatic_handoff','passed',true));
  perform set_config('uat.cash_boundary',outcomes::text,true);
end; $uat$;

-- Exercise actual database roles, even with forged service JWT claims.
set local role authenticated;
do $uat$
begin
  begin
    perform public.service_create_demi_cash_purchase(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),60000);
    raise exception 'authenticated_cash_execution_allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.service_create_demi_cash_purchase_with_due_date(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),60000,current_date);
    raise exception 'authenticated_cash_date_execution_allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('uat.cash_boundary',(current_setting('uat.cash_boundary')::jsonb||jsonb_build_array(jsonb_build_object('variant','authenticated_denied_even_with_service_claim','passed',true)))::text,true);
end; $uat$;
set local role anon;
do $uat$
begin
  begin
    perform public.service_create_demi_cash_purchase(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),60000);
    raise exception 'anonymous_cash_execution_allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.service_create_demi_cash_purchase_with_due_date(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),60000,current_date);
    raise exception 'anonymous_cash_date_execution_allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('uat.cash_boundary',(current_setting('uat.cash_boundary')::jsonb||jsonb_build_array(jsonb_build_object('variant','anonymous_denied_even_with_service_claim','passed',true)))::text,true);
end; $uat$;
select current_setting('uat.cash_boundary')::jsonb as results;
rollback;
