-- Sandbox only. All fixtures and lifecycle updates roll back.
-- Resolves the dedicated UAT by slug; does not embed generated studio/user IDs.
begin;
do $test$
declare
  sid uuid;
  pid uuid;
  result jsonb;
  initial_time timestamptz := now();
  caught boolean;
begin
  select id into strict sid from public.studios where slug='saas-readiness-uat-20261011';
  select plan_id into strict pid from public.studio_plan_assignments where studio_id=sid;
  assert private.studio_plan_limit_value(sid,'active_students')=100, 'Core student limit';
  assert private.studio_plan_limit_value(sid,'admin_users')=3, 'Core admin limit';
  assert private.studio_plan_limit_usage(sid,'sites')=1, 'Initial site usage';
  assert private.studio_plan_limit_usage(sid,'admin_users')=1, 'Initial owner usage';
  perform private.assert_studio_plan_limit_increment(sid,'active_students',100);
  caught := false;
  begin
    perform private.assert_studio_plan_limit_increment(sid,'active_students',101);
  exception when raise_exception then
    if sqlerrm <> 'plan_limit_exceeded' then raise; end if;
    caught := true;
  end;
  assert caught, 'Core must reject increment beyond 100';
  caught := false;
  begin
    perform private.assert_studio_plan_limit_increment(sid,'sites',1);
  exception when raise_exception then
    if sqlerrm <> 'plan_limit_exceeded' then raise; end if;
    caught := true;
  end;
  assert caught, 'Core must reject a second active site';

  perform set_config('request.jwt.claim.sub',
    (select user_id::text from public.studio_memberships where studio_id=sid and role='owner' and active limit 1),true);
  assert exists(select 1 from public.current_studio_modules(sid) where module_key='notifications'), 'Core notifications included';
  assert not exists(select 1 from public.current_studio_modules(sid) where module_key='intelligence'), 'Core intelligence excluded';
  update public.studio_plan_assignments set plan_id=(select id from public.saas_plans where plan_key='growth') where studio_id=sid;
  assert private.studio_plan_limit_value(sid,'active_students')=250, 'Growth student limit';
  assert private.studio_plan_limit_value(sid,'admin_users')=8, 'Growth admin limit';
  assert exists(select 1 from public.current_studio_modules(sid) where module_key='integrations'), 'Growth integrations included';
  assert not exists(select 1 from public.current_studio_modules(sid) where module_key='evaluations'), 'Growth evaluations excluded';
  update public.studio_plan_assignments set plan_id=(select id from public.saas_plans where plan_key='pro') where studio_id=sid;
  assert private.studio_plan_limit_value(sid,'active_students') is null, 'Pro students unlimited';
  assert private.studio_plan_limit_value(sid,'sites')=2, 'Pro two-site limit';
  assert exists(select 1 from public.current_studio_modules(sid) where module_key='evaluations'), 'Pro evaluations included';
  assert exists(select 1 from public.current_studio_modules(sid) where module_key='rewards'), 'Pro rewards included';
  update public.studio_plan_assignments set plan_id=pid where studio_id=sid;

  insert into public.saas_plan_prices(plan_id,billing_interval,currency,amount_minor,
    provider_product_id,provider_price_id,active)
  values(pid,'year','mxn',1,'prod_transactional_fixture','price_transactional_fixture',true);

  result := public.service_apply_stripe_subscription_state(
    p_event_created_at=>initial_time,p_studio_id=>sid,p_customer_id=>'cus_transactional_fixture',
    p_subscription_id=>'sub_transactional_fixture',p_price_id=>'price_transactional_fixture',
    p_provider_status=>'active',p_current_period_start=>initial_time,
    p_current_period_end=>initial_time+interval '30 days',p_payment_succeeded=>true);
  assert result->>'status'='active', 'Active payment state';
  assert private.studio_subscription_access_mode(sid)='full', 'Paid access';

  result := public.service_apply_stripe_subscription_state(
    p_event_created_at=>initial_time+interval '1 second',p_studio_id=>sid,
    p_customer_id=>'cus_transactional_fixture',p_subscription_id=>'sub_transactional_fixture',
    p_price_id=>'price_transactional_fixture',p_provider_status=>'past_due',
    p_current_period_start=>initial_time,p_current_period_end=>initial_time+interval '30 days',
    p_payment_failed=>true);
  assert result->>'status'='past_due', 'Payment failure state';
  assert private.studio_subscription_access_mode(sid)='full', 'Access during three-day grace';
  assert (result->>'grace_ends_at')::timestamptz=initial_time+interval '3 days 1 second', 'Grace duration';

  result := public.service_apply_stripe_subscription_state(
    p_event_created_at=>initial_time,p_studio_id=>sid,p_customer_id=>'cus_transactional_fixture',
    p_subscription_id=>'sub_transactional_fixture',p_price_id=>'price_transactional_fixture',
    p_provider_status=>'active',p_current_period_start=>initial_time,
    p_current_period_end=>initial_time+interval '30 days');
  assert result->>'ignored'='true' and result->>'reason'='stale_event', 'Ignore older event';
  assert (select status='past_due' from public.studio_plan_assignments where studio_id=sid), 'Older event cannot recover access';

  update public.studio_plan_assignments set grace_ends_at=now()-interval '1 second' where studio_id=sid;
  assert private.studio_subscription_access_mode(sid)='restricted', 'Expired grace restricts access';

  result := public.service_apply_stripe_subscription_state(
    p_event_created_at=>initial_time+interval '2 seconds',p_studio_id=>sid,
    p_customer_id=>'cus_transactional_fixture',p_subscription_id=>'sub_transactional_fixture',
    p_price_id=>'price_transactional_fixture',p_provider_status=>'active',
    p_current_period_start=>initial_time,p_current_period_end=>initial_time+interval '30 days',
    p_payment_succeeded=>true);
  assert private.studio_subscription_access_mode(sid)='full', 'Payment recovery restores access';
  assert (select last_payment_failure_at is null from public.studio_plan_assignments where studio_id=sid), 'Failure cleared on recovery';

  result := public.service_apply_stripe_subscription_state(
    p_event_created_at=>initial_time+interval '3 seconds',p_studio_id=>sid,
    p_customer_id=>'cus_transactional_fixture',p_subscription_id=>'sub_transactional_fixture',
    p_price_id=>'price_transactional_fixture',p_provider_status=>'active',
    p_current_period_start=>initial_time,p_current_period_end=>initial_time+interval '30 days',
    p_cancel_at_period_end=>true);
  assert private.studio_subscription_access_mode(sid)='full', 'Scheduled cancellation preserves current access';
  update public.studio_plan_assignments set current_period_start=now()-interval '30 days',
    current_period_end=now()-interval '1 second' where studio_id=sid;
  assert private.studio_subscription_access_mode(sid)='restricted', 'Period-end cancellation restricts access';

  result := public.service_apply_stripe_subscription_state(
    p_event_created_at=>initial_time+interval '4 seconds',p_studio_id=>sid,
    p_customer_id=>'cus_transactional_fixture',p_subscription_id=>'sub_transactional_fixture',
    p_price_id=>'price_transactional_fixture',p_provider_status=>'canceled');
  assert result->>'status'='cancelled', 'Provider cancellation mapping';
  assert private.studio_subscription_access_mode(sid)='restricted', 'Cancelled access';
end;
$test$;
rollback;

-- Selected studio context must also scope legacy implicit RPCs.
begin;
do $$
declare v_user uuid; v_studio uuid; v_student uuid;
begin
  select m.user_id, m.studio_id into v_user, v_studio
  from public.studio_memberships m join public.studios s on s.id=m.studio_id
  where s.slug='saas-existing-owner-ui-uat-20261011' and m.role='owner';
  if v_user is null then raise exception 'fixture_missing'; end if;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.headers',json_build_object('x-studio-id',v_studio::text)::text,true);
  v_student := public.admin_create_student('Scope','UAT','+528112345678',null);
  if not exists(select 1 from public.students where id=v_student and studio_id=v_studio) then
    raise exception 'incorrect_selected_studio';
  end if;
end $$;
rollback;
