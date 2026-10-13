-- Recovered from dev-03-studio-config. Historical files are archived, not replayed.
-- This migration restores SaaS dependencies without changing current authentication guards.


create or replace function public.service_provision_studio(
  p_name text,
  p_slug text,
  p_timezone text,
  p_currency text,
  p_locale text,
  p_primary_color text,
  p_owner_user_id uuid,
  p_owner_full_name text,
  p_owner_requires_activation boolean,
  p_site_name text,
  p_address text,
  p_space_name text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_studio_id uuid;
  v_site_id uuid;
  v_location_id uuid;
  v_space_id uuid;
begin
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'studio_name_required'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'studio_slug_invalid'; end if;
  if p_owner_user_id is null then raise exception 'owner_user_required'; end if;
  if nullif(trim(coalesce(p_owner_full_name,'')),'') is null then raise exception 'owner_name_required'; end if;
  if nullif(trim(coalesce(p_site_name,'')),'') is null then raise exception 'site_name_required'; end if;
  if nullif(trim(coalesce(p_space_name,'')),'') is null then raise exception 'space_name_required'; end if;
  if p_primary_color is null or p_primary_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'primary_color_invalid'; end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then raise exception 'currency_invalid'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'timezone_invalid';
  end if;
  if not exists (select 1 from auth.users where id=p_owner_user_id) then
    raise exception 'owner_auth_user_not_found';
  end if;

  insert into public.studios(name,slug,timezone,currency,locale,primary_color,status)
  values(trim(p_name),p_slug,p_timezone,p_currency,coalesce(nullif(trim(p_locale),''),'es-MX'),upper(p_primary_color),'active')
  returning id into v_studio_id;

  insert into public.sites(studio_id,name,address,active)
  values(v_studio_id,trim(p_site_name),nullif(trim(coalesce(p_address,'')),''),true)
  returning id into v_site_id;

  insert into public.studio_locations(studio_id,name,address,active)
  values(v_studio_id,trim(p_site_name),nullif(trim(coalesce(p_address,'')),''),true)
  returning id into v_location_id;

  insert into public.spaces(studio_id,site_id,name,active)
  values(v_studio_id,v_site_id,trim(p_space_name),true)
  returning id into v_space_id;

  insert into public.profiles(id,full_name)
  values(p_owner_user_id,trim(p_owner_full_name))
  on conflict(id) do update
    set full_name=case
      when nullif(trim(coalesce(public.profiles.full_name,'')),'') is null then excluded.full_name
      else public.profiles.full_name
    end,
    updated_at=now();

  insert into public.user_accounts(id,status,must_change_password)
  values(p_owner_user_id,'active',coalesce(p_owner_requires_activation,true))
  on conflict(id) do update
    set status='active',
        must_change_password=case
          when coalesce(p_owner_requires_activation,true) then true
          else public.user_accounts.must_change_password
        end,
        updated_at=now();

  insert into public.studio_memberships(studio_id,user_id,role,active,person_id)
  values(v_studio_id,p_owner_user_id,'owner',true,null);

  return jsonb_build_object(
    'studio_id',v_studio_id,
    'site_id',v_site_id,
    'location_id',v_location_id,
    'space_id',v_space_id,
    'owner_user_id',p_owner_user_id
  );
exception
  when unique_violation then
    if exists(select 1 from public.studios where slug=p_slug) then
      raise exception 'studio_slug_exists';
    end if;
    raise;
end;
$$;

revoke all on function public.service_provision_studio(
  text,text,text,text,text,text,uuid,text,boolean,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_provision_studio(
  text,text,text,text,text,text,uuid,text,boolean,text,text,text
) to service_role;


-- DEV-04E: commercial plan catalog, platform plan administration, audit trail and plan-aware provisioning.

alter table public.saas_plans
  add column if not exists sort_order integer not null default 0;

insert into public.saas_plans(
  plan_key,name,description,internal_only,active,sort_order
)
values
  (
    'core',
    'Core',
    'Operación esencial del estudio con documentos y notificaciones.',
    false,
    true,
    10
  ),
  (
    'growth',
    'Growth',
    'Operación avanzada con lista de espera, recursos, automatizaciones, inteligencia e integraciones.',
    false,
    true,
    20
  ),
  (
    'pro',
    'Pro',
    'Suite completa con evaluaciones, progreso y recompensas además de todas las funciones Growth.',
    false,
    true,
    30
  )
on conflict(plan_key) do update
set name=excluded.name,
    description=excluded.description,
    internal_only=excluded.internal_only,
    active=excluded.active,
    sort_order=excluded.sort_order,
    updated_at=now();

update public.saas_plans
set sort_order=999,
    internal_only=true,
    updated_at=now()
where plan_key='all_access';

delete from public.saas_plan_modules pm
using public.saas_plans p
where pm.plan_id=p.id
  and p.plan_key in ('core','growth','pro');

insert into public.saas_plan_modules(plan_id,module_key,enabled)
select p.id,m.module_key,true
from public.saas_plans p
join public.saas_modules m on (
  (p.plan_key='core' and m.module_key in (
    'core','documents','notifications'
  ))
  or
  (p.plan_key='growth' and m.module_key in (
    'core','documents','notifications','waitlist','resources',
    'automations','intelligence','integrations'
  ))
  or
  (p.plan_key='pro' and m.module_key in (
    'core','documents','notifications','waitlist','resources',
    'automations','intelligence','integrations','evaluations','rewards'
  ))
)
where p.plan_key in ('core','growth','pro')
on conflict(plan_id,module_key) do update
set enabled=true;

create table if not exists public.studio_plan_assignment_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  from_plan_id uuid references public.saas_plans(id),
  to_plan_id uuid not null references public.saas_plans(id),
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  source text not null default 'platform',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

-- Keep the newer audit representation introduced in October.
alter table public.studio_plan_assignment_events
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create index if not exists studio_plan_assignment_events_studio_idx
  on public.studio_plan_assignment_events(studio_id,created_at desc);

alter table public.studio_plan_assignment_events enable row level security;

drop policy if exists studios_platform_admin_select on public.studios;
create policy studios_platform_admin_select
  on public.studios
  for select to authenticated
  using (
    exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  );

drop policy if exists studio_plan_assignments_platform_admin_select
  on public.studio_plan_assignments;
create policy studio_plan_assignments_platform_admin_select
  on public.studio_plan_assignments
  for select to authenticated
  using (
    exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  );

drop policy if exists studio_plan_assignments_platform_admin_insert
  on public.studio_plan_assignments;
create policy studio_plan_assignments_platform_admin_insert
  on public.studio_plan_assignments
  for insert to authenticated
  with check (
    exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  );

drop policy if exists studio_plan_assignments_platform_admin_update
  on public.studio_plan_assignments;
create policy studio_plan_assignments_platform_admin_update
  on public.studio_plan_assignments
  for update to authenticated
  using (
    exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  )
  with check (
    exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  );

drop policy if exists studio_plan_assignment_events_platform_admin_select
  on public.studio_plan_assignment_events;
create policy studio_plan_assignment_events_platform_admin_select
  on public.studio_plan_assignment_events
  for select to authenticated
  using (
    exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  );

revoke all on public.studio_plan_assignment_events from anon,authenticated;
grant select on public.studio_plan_assignment_events to authenticated;
grant all on public.studio_plan_assignment_events to service_role;
grant insert,update on public.studio_plan_assignments to authenticated;

create or replace function private.log_studio_plan_assignment_event()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if tg_op='INSERT' then
    insert into public.studio_plan_assignment_events(
      studio_id,from_plan_id,to_plan_id,from_status,to_status,
      actor_user_id,source,reason,metadata
    )
    values(
      new.studio_id,
      null,
      new.plan_id,
      null,
      new.status,
      (select auth.uid()),
      coalesce(nullif(new.metadata->>'assignment_source',''),'platform'),
      nullif(new.metadata->>'change_reason',''),
      new.metadata
    );
    return new;
  end if;

  if new.plan_id is distinct from old.plan_id
     or new.status is distinct from old.status then
    insert into public.studio_plan_assignment_events(
      studio_id,from_plan_id,to_plan_id,from_status,to_status,
      actor_user_id,source,reason,metadata
    )
    values(
      new.studio_id,
      old.plan_id,
      new.plan_id,
      old.status,
      new.status,
      (select auth.uid()),
      coalesce(nullif(new.metadata->>'assignment_source',''),'platform'),
      nullif(new.metadata->>'change_reason',''),
      new.metadata
    );
  end if;

  return new;
end;
$function$;

revoke all on function private.log_studio_plan_assignment_event()
  from public,anon,authenticated;

drop trigger if exists studio_plan_assignment_event_trg
  on public.studio_plan_assignments;
create trigger studio_plan_assignment_event_trg
after insert or update of plan_id,status
on public.studio_plan_assignments
for each row
execute function private.log_studio_plan_assignment_event();

create or replace function public.service_provision_studio_v3(
  p_name text,
  p_slug text,
  p_timezone text,
  p_currency text,
  p_locale text,
  p_phone_country_calling_code text,
  p_primary_color text,
  p_owner_user_id uuid,
  p_owner_full_name text,
  p_owner_requires_activation boolean,
  p_site_name text,
  p_address text,
  p_space_name text,
  p_plan_key text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_result jsonb;
  v_phone_country_calling_code text := btrim(coalesce(p_phone_country_calling_code,''));
  v_plan_key text := lower(btrim(coalesce(p_plan_key,'')));
  v_plan_id uuid;
begin
  if v_phone_country_calling_code !~ '^\+[1-9][0-9]{0,3}$' then
    raise exception 'phone_country_calling_code_invalid' using errcode='22023';
  end if;

  if v_plan_key='' then
    raise exception 'saas_plan_required' using errcode='22023';
  end if;

  select id into v_plan_id
  from public.saas_plans
  where plan_key=v_plan_key
    and active=true
    and internal_only=false
  limit 1;

  if v_plan_id is null then
    raise exception 'saas_plan_invalid' using errcode='22023';
  end if;

  v_result := public.service_provision_studio(
    p_name,
    p_slug,
    p_timezone,
    p_currency,
    p_locale,
    p_primary_color,
    p_owner_user_id,
    p_owner_full_name,
    p_owner_requires_activation,
    p_site_name,
    p_address,
    p_space_name
  );

  update public.studios
  set phone_country_calling_code=v_phone_country_calling_code
  where id=(v_result->>'studio_id')::uuid;

  insert into public.studio_plan_assignments(
    studio_id,plan_id,status,metadata
  )
  values(
    (v_result->>'studio_id')::uuid,
    v_plan_id,
    'active',
    jsonb_build_object(
      'assignment_source','platform_provisioning',
      'change_reason','initial_plan'
    )
  );

  return v_result || jsonb_build_object('plan_key',v_plan_key);
end;
$function$;

revoke all on function public.service_provision_studio_v3(
  text,text,text,text,text,text,text,uuid,text,boolean,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_provision_studio_v3(
  text,text,text,text,text,text,text,uuid,text,boolean,text,text,text,text
) to service_role;


alter table public.studio_plan_assignments add column if not exists trial_started_at timestamptz;

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


create index if not exists saas_billing_checkout_plan_idx
  on public.saas_billing_checkout_attempts(plan_id);

create index if not exists saas_billing_checkout_plan_price_idx
  on public.saas_billing_checkout_attempts(plan_price_id);

create index if not exists saas_billing_checkout_created_by_idx
  on public.saas_billing_checkout_attempts(created_by)
  where created_by is not null;

create index if not exists saas_billing_webhook_studio_idx
  on public.saas_billing_webhook_events(studio_id, event_created_at desc)
  where studio_id is not null;


revoke all on public.saas_plan_prices, public.saas_billing_checkout_attempts, public.saas_billing_webhook_events from anon, authenticated;
grant select on public.saas_plan_prices, public.saas_billing_checkout_attempts, public.saas_billing_webhook_events to authenticated;
grant all on public.saas_plan_prices, public.saas_billing_checkout_attempts, public.saas_billing_webhook_events to service_role;
