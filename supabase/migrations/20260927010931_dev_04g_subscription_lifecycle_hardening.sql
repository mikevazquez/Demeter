-- DEV-04G hardening: finite trials, period-end cancellation, billing metadata and automation enforcement.

alter table public.studio_plan_assignments
  add column if not exists next_billing_at timestamptz;

alter table public.studio_plan_assignments
  drop constraint if exists studio_plan_assignments_trial_requires_end,
  add constraint studio_plan_assignments_trial_requires_end
    check (status <> 'trialing' or trial_ends_at is not null);

alter table public.studio_plan_assignments
  drop constraint if exists studio_plan_assignments_cancel_period_requires_end,
  add constraint studio_plan_assignments_cancel_period_requires_end
    check (not cancel_at_period_end or current_period_end is not null);

create or replace function private.studio_subscription_access_mode(p_studio_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select case
      when spa.status='active'
        and spa.cancel_at_period_end
        and spa.current_period_end is not null
        and spa.current_period_end <= now()
        then 'restricted'
      when spa.status='active'
        then 'full'
      when spa.status='trialing'
        and spa.trial_ends_at is not null
        and spa.trial_ends_at > now()
        then 'full'
      when spa.status='past_due'
        and spa.grace_ends_at is not null
        and spa.grace_ends_at > now()
        then 'full'
      else 'restricted'
    end
    from public.studio_plan_assignments spa
    join public.saas_plans p on p.id=spa.plan_id and p.active=true
    where spa.studio_id=p_studio_id
    limit 1
  ),'restricted');
$function$;

create or replace function private.studio_subscription_effective_status(p_studio_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select case
      when spa.status='active'
        and spa.cancel_at_period_end
        and spa.current_period_end is not null
        and spa.current_period_end <= now()
        then 'cancelled_period_end'
      when spa.status='trialing'
        and (spa.trial_ends_at is null or spa.trial_ends_at <= now())
        then 'trial_expired'
      when spa.status='past_due'
        and spa.grace_ends_at is not null
        and spa.grace_ends_at > now()
        then 'past_due_grace'
      when spa.status='past_due'
        then 'past_due_expired'
      else spa.status
    end
    from public.studio_plan_assignments spa
    where spa.studio_id=p_studio_id
    limit 1
  ),'unassigned');
$function$;

create or replace function private.log_studio_subscription_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_changed boolean;
begin
  v_changed :=
    new.status is distinct from old.status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.current_period_start is distinct from old.current_period_start
    or new.current_period_end is distinct from old.current_period_end
    or new.grace_ends_at is distinct from old.grace_ends_at
    or new.next_billing_at is distinct from old.next_billing_at
    or new.cancel_at_period_end is distinct from old.cancel_at_period_end
    or new.cancelled_at is distinct from old.cancelled_at
    or new.suspended_at is distinct from old.suspended_at
    or new.last_payment_failure_at is distinct from old.last_payment_failure_at
    or new.billing_provider is distinct from old.billing_provider
    or new.provider_customer_id is distinct from old.provider_customer_id
    or new.provider_subscription_id is distinct from old.provider_subscription_id;

  if v_changed then
    insert into public.studio_subscription_events(
      studio_id,plan_id,from_status,to_status,actor_user_id,
      source,reason,effective_access,snapshot
    )
    values(
      new.studio_id,
      new.plan_id,
      old.status,
      new.status,
      (select auth.uid()),
      coalesce(nullif(new.metadata->>'billing_source',''),'platform'),
      nullif(new.metadata->>'billing_reason',''),
      private.studio_subscription_access_mode(new.studio_id),
      jsonb_build_object(
        'trial_ends_at',new.trial_ends_at,
        'current_period_start',new.current_period_start,
        'current_period_end',new.current_period_end,
        'grace_ends_at',new.grace_ends_at,
        'next_billing_at',new.next_billing_at,
        'cancel_at_period_end',new.cancel_at_period_end,
        'cancelled_at',new.cancelled_at,
        'suspended_at',new.suspended_at,
        'last_payment_failure_at',new.last_payment_failure_at,
        'billing_provider',new.billing_provider,
        'provider_customer_id',new.provider_customer_id,
        'provider_subscription_id',new.provider_subscription_id
      )
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists studio_subscription_event_trg
  on public.studio_plan_assignments;

create trigger studio_subscription_event_trg
after update of
  status,trial_ends_at,current_period_start,current_period_end,
  grace_ends_at,next_billing_at,cancel_at_period_end,cancelled_at,
  suspended_at,last_payment_failure_at,billing_provider,
  provider_customer_id,provider_subscription_id
on public.studio_plan_assignments
for each row
execute function private.log_studio_subscription_event();

create or replace function private.enforce_automation_entitlement_on_insert()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not private.studio_has_module(new.studio_id, 'automations') then
    raise exception 'automations_entitlement_disabled';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_automation_entitlement_on_insert()
  from public,anon,authenticated,service_role;

drop trigger if exists automation_instances_entitlement_insert_trg
  on public.automation_instances;
create trigger automation_instances_entitlement_insert_trg
before insert on public.automation_instances
for each row
execute function private.enforce_automation_entitlement_on_insert();

drop trigger if exists automation_eligibility_entitlement_insert_trg
  on public.automation_eligibility_evaluations;
create trigger automation_eligibility_entitlement_insert_trg
before insert on public.automation_eligibility_evaluations
for each row
execute function private.enforce_automation_entitlement_on_insert();

drop trigger if exists automation_executions_entitlement_insert_trg
  on public.automation_executions;
create trigger automation_executions_entitlement_insert_trg
before insert on public.automation_executions
for each row
execute function private.enforce_automation_entitlement_on_insert();

drop trigger if exists automation_attempts_entitlement_insert_trg
  on public.automation_execution_attempts;
create trigger automation_attempts_entitlement_insert_trg
before insert on public.automation_execution_attempts
for each row
execute function private.enforce_automation_entitlement_on_insert();
