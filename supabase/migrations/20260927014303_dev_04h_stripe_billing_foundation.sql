create table if not exists public.saas_plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.saas_plans(id) on delete cascade,
  provider text not null default 'stripe',
  billing_interval text not null,
  currency text not null,
  amount_minor integer not null,
  provider_product_id text not null,
  provider_price_id text not null,
  trial_days integer not null default 0,
  grace_days integer not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_plan_prices_provider_check check (provider in ('stripe')),
  constraint saas_plan_prices_interval_check check (billing_interval in ('month','year')),
  constraint saas_plan_prices_currency_check check (currency ~ '^[a-z]{3}$'),
  constraint saas_plan_prices_amount_check check (amount_minor > 0),
  constraint saas_plan_prices_trial_days_check check (trial_days between 0 and 365),
  constraint saas_plan_prices_grace_days_check check (grace_days between 0 and 30)
);

create unique index if not exists saas_plan_prices_provider_price_uidx
  on public.saas_plan_prices(provider, provider_price_id);

create unique index if not exists saas_plan_prices_active_slot_uidx
  on public.saas_plan_prices(plan_id, provider, billing_interval, currency)
  where active = true;

create table if not exists public.saas_billing_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  plan_id uuid not null references public.saas_plans(id) on delete restrict,
  plan_price_id uuid not null references public.saas_plan_prices(id) on delete restrict,
  provider text not null default 'stripe',
  client_request_key uuid not null,
  created_by uuid null references auth.users(id) on delete set null,
  status text not null default 'created',
  provider_checkout_session_id text null,
  checkout_url text null,
  failure_code text null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_billing_checkout_provider_check check (provider in ('stripe')),
  constraint saas_billing_checkout_status_check
    check (status in ('created','checkout_created','completed','expired','error')),
  constraint saas_billing_checkout_studio_request_uidx unique(studio_id, client_request_key)
);

create unique index if not exists saas_billing_checkout_provider_session_uidx
  on public.saas_billing_checkout_attempts(provider, provider_checkout_session_id)
  where provider_checkout_session_id is not null;

create index if not exists saas_billing_checkout_studio_created_idx
  on public.saas_billing_checkout_attempts(studio_id, created_at desc);

create table if not exists public.saas_billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  event_id text not null,
  event_type text not null,
  event_created_at timestamptz not null,
  studio_id uuid null references public.studios(id) on delete set null,
  provider_customer_id text null,
  provider_subscription_id text null,
  status text not null default 'received',
  error_code text null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint saas_billing_webhook_provider_check check (provider in ('stripe')),
  constraint saas_billing_webhook_status_check
    check (status in ('received','processing','completed','ignored','failed')),
  constraint saas_billing_webhook_event_uidx unique(provider, event_id)
);

create index if not exists saas_billing_webhook_subscription_idx
  on public.saas_billing_webhook_events(provider_subscription_id, event_created_at desc)
  where provider_subscription_id is not null;

alter table public.studio_plan_assignments
  add column if not exists provider_price_id text null,
  add column if not exists provider_status text null,
  add column if not exists provider_event_created_at timestamptz null,
  add column if not exists last_invoice_id text null,
  add column if not exists last_payment_at timestamptz null;

create unique index if not exists studio_plan_assignments_provider_subscription_uidx
  on public.studio_plan_assignments(billing_provider, provider_subscription_id)
  where billing_provider is not null and provider_subscription_id is not null;

create unique index if not exists studio_plan_assignments_provider_customer_uidx
  on public.studio_plan_assignments(billing_provider, provider_customer_id)
  where billing_provider is not null and provider_customer_id is not null;

alter table public.saas_plan_prices enable row level security;
alter table public.saas_billing_checkout_attempts enable row level security;
alter table public.saas_billing_webhook_events enable row level security;

drop policy if exists saas_plan_prices_authenticated_read on public.saas_plan_prices;
create policy saas_plan_prices_authenticated_read
on public.saas_plan_prices
for select
to authenticated
using (true);

drop policy if exists saas_plan_prices_platform_admin_insert on public.saas_plan_prices;
create policy saas_plan_prices_platform_admin_insert
on public.saas_plan_prices
for insert
to authenticated
with check (
  exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.active = true
  )
);

drop policy if exists saas_plan_prices_platform_admin_update on public.saas_plan_prices;
create policy saas_plan_prices_platform_admin_update
on public.saas_plan_prices
for update
to authenticated
using (
  exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.active = true
  )
)
with check (
  exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.active = true
  )
);

drop policy if exists saas_plan_prices_platform_admin_delete on public.saas_plan_prices;
create policy saas_plan_prices_platform_admin_delete
on public.saas_plan_prices
for delete
to authenticated
using (
  exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.active = true
  )
);

drop policy if exists saas_billing_checkout_authorized_read on public.saas_billing_checkout_attempts;
create policy saas_billing_checkout_authorized_read
on public.saas_billing_checkout_attempts
for select
to authenticated
using (
  exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = saas_billing_checkout_attempts.studio_id
      and sm.user_id = (select auth.uid())
      and sm.active = true
      and sm.role = 'owner'
  )
  or exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.active = true
  )
);

drop policy if exists saas_billing_webhook_platform_admin_read on public.saas_billing_webhook_events;
create policy saas_billing_webhook_platform_admin_read
on public.saas_billing_webhook_events
for select
to authenticated
using (
  exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.active = true
  )
);

revoke insert, update, delete on public.saas_billing_checkout_attempts from anon, authenticated;
revoke insert, update, delete on public.saas_billing_webhook_events from anon, authenticated;

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
      'billing_source','stripe_webhook',
      'billing_reason',coalesce(nullif(p_reason,''),'Stripe subscription event')
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
    or new.provider_subscription_id is distinct from old.provider_subscription_id
    or new.provider_price_id is distinct from old.provider_price_id
    or new.provider_status is distinct from old.provider_status
    or new.provider_event_created_at is distinct from old.provider_event_created_at
    or new.last_invoice_id is distinct from old.last_invoice_id
    or new.last_payment_at is distinct from old.last_payment_at;

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
        'provider_subscription_id',new.provider_subscription_id,
        'provider_price_id',new.provider_price_id,
        'provider_status',new.provider_status,
        'provider_event_created_at',new.provider_event_created_at,
        'last_invoice_id',new.last_invoice_id,
        'last_payment_at',new.last_payment_at
      )
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists studio_subscription_event_trg on public.studio_plan_assignments;

create trigger studio_subscription_event_trg
after update of
  status,trial_started_at,trial_ends_at,current_period_start,current_period_end,
  grace_ends_at,next_billing_at,cancel_at_period_end,cancelled_at,suspended_at,
  last_payment_failure_at,billing_provider,provider_customer_id,provider_subscription_id,
  provider_price_id,provider_status,provider_event_created_at,last_invoice_id,last_payment_at
on public.studio_plan_assignments
for each row
execute function private.log_studio_subscription_event();
