-- DEV-04G: explicit trial start metadata and audited trial windows.

alter table public.studio_plan_assignments
  add column if not exists trial_started_at timestamptz;

update public.studio_plan_assignments
set trial_started_at=coalesce(trial_started_at,starts_at)
where status='trialing'
  and trial_started_at is null;

alter table public.studio_plan_assignments
  drop constraint if exists studio_plan_assignments_trial_window,
  add constraint studio_plan_assignments_trial_window
    check (
      status <> 'trialing'
      or (
        trial_started_at is not null
        and trial_ends_at is not null
        and trial_ends_at > trial_started_at
      )
    );

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
    or new.trial_started_at is distinct from old.trial_started_at
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
        'trial_started_at',new.trial_started_at,
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
  status,trial_started_at,trial_ends_at,current_period_start,current_period_end,
  grace_ends_at,next_billing_at,cancel_at_period_end,cancelled_at,
  suspended_at,last_payment_failure_at,billing_provider,
  provider_customer_id,provider_subscription_id
on public.studio_plan_assignments
for each row
execute function private.log_studio_subscription_event();
