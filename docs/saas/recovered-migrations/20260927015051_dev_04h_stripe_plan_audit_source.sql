create or replace function public.service_apply_stripe_subscription_state(
  p_event_created_at timestamptz,
  p_studio_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_provider_status text,
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null,
  p_trial_started_at timestamptz default null,
  p_trial_ends_at timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_cancelled_at timestamptz default null,
  p_invoice_id text default null,
  p_payment_succeeded boolean default false,
  p_payment_failed boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_assignment public.studio_plan_assignments%rowtype;
  v_price public.saas_plan_prices%rowtype;
  v_target_status text;
  v_now timestamptz := now();
  v_grace_ends_at timestamptz;
  v_reason text := coalesce(nullif(p_reason,''),'Stripe subscription event');
begin
  if p_event_created_at is null
     or p_studio_id is null
     or nullif(btrim(p_customer_id),'') is null
     or nullif(btrim(p_subscription_id),'') is null
     or nullif(btrim(p_price_id),'') is null
     or nullif(btrim(p_provider_status),'') is null then
    raise exception 'stripe_subscription_state_invalid';
  end if;

  select *
  into v_price
  from public.saas_plan_prices spp
  where spp.provider = 'stripe'
    and spp.provider_price_id = p_price_id
    and spp.active = true
  limit 1;

  if not found then
    raise exception 'stripe_price_unmapped';
  end if;

  if exists (
    select 1
    from public.saas_plans sp
    where sp.id = v_price.plan_id
      and sp.internal_only = true
  ) then
    raise exception 'stripe_internal_plan_forbidden';
  end if;

  select *
  into v_assignment
  from public.studio_plan_assignments spa
  where spa.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'stripe_assignment_missing';
  end if;

  if v_assignment.provider_event_created_at is not null
     and v_assignment.provider_event_created_at > p_event_created_at then
    return jsonb_build_object(
      'ok', true,
      'ignored', true,
      'reason', 'stale_event',
      'status', v_assignment.status
    );
  end if;

  v_target_status := case lower(p_provider_status)
    when 'trialing' then 'trialing'
    when 'active' then 'active'
    when 'past_due' then 'past_due'
    when 'canceled' then 'cancelled'
    when 'cancelled' then 'cancelled'
    when 'unpaid' then 'suspended'
    when 'paused' then 'suspended'
    when 'incomplete' then 'suspended'
    when 'incomplete_expired' then 'suspended'
    else null
  end;

  if v_target_status is null then
    return jsonb_build_object(
      'ok', true,
      'ignored', true,
      'reason', 'unsupported_provider_status',
      'provider_status', p_provider_status
    );
  end if;

  if v_target_status = 'past_due' then
    v_grace_ends_at := case
      when v_assignment.status = 'past_due'
       and v_assignment.grace_ends_at is not null
       and v_assignment.grace_ends_at > p_event_created_at
        then v_assignment.grace_ends_at
      else p_event_created_at + make_interval(days => v_price.grace_days)
    end;
  else
    v_grace_ends_at := null;
  end if;

  update public.studio_plan_assignments
  set
    plan_id = v_price.plan_id,
    status = v_target_status,
    starts_at = case
      when plan_id is distinct from v_price.plan_id then p_event_created_at
      else starts_at
    end,
    ends_at = null,
    trial_started_at = case
      when v_target_status = 'trialing' then coalesce(p_trial_started_at, p_event_created_at)
      else null
    end,
    trial_ends_at = case
      when v_target_status = 'trialing' then p_trial_ends_at
      else null
    end,
    current_period_start = p_current_period_start,
    current_period_end = p_current_period_end,
    grace_ends_at = v_grace_ends_at,
    next_billing_at = case
      when v_target_status in ('trialing','active','past_due') and not p_cancel_at_period_end
        then p_current_period_end
      else null
    end,
    cancel_at_period_end = case
      when v_target_status in ('trialing','active','past_due') then coalesce(p_cancel_at_period_end,false)
      else false
    end,
    cancelled_at = case
      when v_target_status = 'cancelled' then coalesce(p_cancelled_at,p_event_created_at)
      else null
    end,
    suspended_at = case
      when v_target_status = 'suspended' then p_event_created_at
      else null
    end,
    last_payment_failure_at = case
      when p_payment_failed then p_event_created_at
      when v_target_status in ('active','trialing') then null
      else last_payment_failure_at
    end,
    billing_provider = 'stripe',
    provider_customer_id = p_customer_id,
    provider_subscription_id = p_subscription_id,
    provider_price_id = p_price_id,
    provider_status = lower(p_provider_status),
    provider_event_created_at = p_event_created_at,
    last_invoice_id = coalesce(p_invoice_id,last_invoice_id),
    last_payment_at = case
      when p_payment_succeeded then p_event_created_at
      else last_payment_at
    end,
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'assignment_source','stripe_webhook',
      'change_reason',v_reason,
      'billing_source','stripe_webhook',
      'billing_reason',v_reason
    ),
    updated_at = v_now
  where studio_id = p_studio_id;

  return jsonb_build_object(
    'ok', true,
    'ignored', false,
    'status', v_target_status,
    'plan_id', v_price.plan_id,
    'grace_ends_at', v_grace_ends_at
  );
end;
$function$;

revoke all on function public.service_apply_stripe_subscription_state(
  timestamptz,uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean,timestamptz,text,boolean,boolean,text
) from public,anon,authenticated;
grant execute on function public.service_apply_stripe_subscription_state(
  timestamptz,uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean,timestamptz,text,boolean,boolean,text
) to service_role;
