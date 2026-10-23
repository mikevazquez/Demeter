-- Diagnostic only: a passing fresh fixture does not clear historical API timeouts.
begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
set local statement_timeout='8s';
do $uat$
declare source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772'; owner uuid; f jsonb; studio uuid; student uuid; session uuid; started timestamptz; result jsonb;
begin
  select user_id into owner from public.studio_memberships where studio_id=source and active and role='owner' limit 1;
  f:=public.service_create_demi_uat_run(source,owner,'booking-timeout-diagnostic-uat');
  studio:=(f->>'studio_id')::uuid;
  student:=(f#>>'{fixtures,people,student_active,student_id}')::uuid;
  session:=(f#>>'{fixtures,sessions,available}')::uuid;
  started:=clock_timestamp();
  result:=public.service_booking_eligibility(studio,session,student);
  if not coalesce((result->>'eligible')::boolean,false) then raise exception 'diagnostic_not_eligible:%',result; end if;
  perform set_config('uat.booking_timeout_diagnostic',jsonb_build_object(
    'database_role',current_user,'statement_timeout',current_setting('statement_timeout'),
    'rpc_elapsed_ms',extract(epoch from clock_timestamp()-started)*1000,
    'eligible',true,'historical_failure_cleared',false
  )::text,true);
end; $uat$;
select current_setting('uat.booking_timeout_diagnostic')::jsonb as diagnostic;
rollback;
