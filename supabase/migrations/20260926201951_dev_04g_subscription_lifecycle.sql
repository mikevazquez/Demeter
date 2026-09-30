-- DEV-04G: subscription lifecycle, grace periods, restricted access and billing audit.

alter table public.studio_plan_assignments
  add column if not exists trial_ends_at timestamptz,
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists grace_ends_at timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists last_payment_failure_at timestamptz,
  add column if not exists billing_provider text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_subscription_id text;

alter table public.studio_plan_assignments
  drop constraint if exists studio_plan_assignments_trial_dates,
  add constraint studio_plan_assignments_trial_dates
    check (trial_ends_at is null or trial_ends_at > starts_at);

alter table public.studio_plan_assignments
  drop constraint if exists studio_plan_assignments_period_dates,
  add constraint studio_plan_assignments_period_dates
    check (
      current_period_start is null
      or current_period_end is null
      or current_period_end > current_period_start
    );

create table if not exists public.studio_subscription_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  plan_id uuid not null references public.saas_plans(id),
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  source text not null default 'platform',
  reason text,
  effective_access text not null,
  snapshot jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint studio_subscription_events_access
    check (effective_access in ('full','restricted'))
);

create index if not exists studio_subscription_events_studio_idx
  on public.studio_subscription_events(studio_id,occurred_at desc);
create index if not exists studio_subscription_events_plan_idx
  on public.studio_subscription_events(plan_id);

alter table public.studio_subscription_events enable row level security;

drop policy if exists studio_subscription_events_platform_admin_select
  on public.studio_subscription_events;
create policy studio_subscription_events_platform_admin_select
  on public.studio_subscription_events
  for select to authenticated
  using (
    exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  );

revoke all on public.studio_subscription_events from anon,authenticated;
grant select on public.studio_subscription_events to authenticated;
grant all on public.studio_subscription_events to service_role;

drop policy if exists studio_plan_assignments_member_read
  on public.studio_plan_assignments;
drop policy if exists studio_plan_assignments_platform_admin_select
  on public.studio_plan_assignments;
drop policy if exists studio_plan_assignments_authorized_read
  on public.studio_plan_assignments;
create policy studio_plan_assignments_authorized_read
  on public.studio_plan_assignments
  for select to authenticated
  using (
    private.is_studio_member(studio_id)
    or exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  );

CREATE OR REPLACE FUNCTION private.has_capability(p_studio_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (
      private.requested_studio_id() is null
      or p_studio_id = private.requested_studio_id()
    )
    and exists (
      select 1
      from public.studio_memberships m
      join public.role_capabilities rc on rc.role = m.role
      where m.studio_id = p_studio_id
        and m.user_id = (select auth.uid())
        and m.active = true
        and rc.capability_key = p_capability
        and (
          private.studio_subscription_access_mode(p_studio_id)='full'
          or (
            m.role='owner'
            and p_capability='admin.portal'
          )
        )
    )
    and (
      p_capability='admin.portal'
      or not exists (
        select 1
        from public.saas_module_capabilities mc
        where mc.capability_key=p_capability
      )
      or exists (
        select 1
        from public.saas_module_capabilities mc
        where mc.capability_key=p_capability
          and private.studio_has_module(p_studio_id,mc.module_key)
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.log_studio_subscription_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_changed boolean;
begin
  v_changed :=
    new.status is distinct from old.status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.current_period_start is distinct from old.current_period_start
    or new.current_period_end is distinct from old.current_period_end
    or new.grace_ends_at is distinct from old.grace_ends_at
    or new.cancel_at_period_end is distinct from old.cancel_at_period_end
    or new.cancelled_at is distinct from old.cancelled_at
    or new.suspended_at is distinct from old.suspended_at
    or new.last_payment_failure_at is distinct from old.last_payment_failure_at;

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
        'cancel_at_period_end',new.cancel_at_period_end,
        'cancelled_at',new.cancelled_at,
        'suspended_at',new.suspended_at,
        'last_payment_failure_at',new.last_payment_failure_at,
        'billing_provider',new.billing_provider
      )
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.studio_has_module(p_studio_id uuid, p_module_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    private.studio_subscription_access_mode(p_studio_id)='full'
    and coalesce((
      select
        case
          when smo.enabled is not null
            and (smo.expires_at is null or smo.expires_at > now())
            then smo.enabled
          else coalesce(spm.enabled,false)
        end
      from public.studio_plan_assignments spa
      join public.saas_plans sp on sp.id=spa.plan_id and sp.active=true
      join public.saas_modules sm on sm.module_key=p_module_key and sm.active=true
      left join public.saas_plan_modules spm
        on spm.plan_id=spa.plan_id
       and spm.module_key=sm.module_key
      left join public.studio_module_overrides smo
        on smo.studio_id=spa.studio_id
       and smo.module_key=sm.module_key
      where spa.studio_id=p_studio_id
      limit 1
    ),false);
$function$;

CREATE OR REPLACE FUNCTION private.studio_subscription_access_mode(p_studio_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select case
      when spa.status='active' then 'full'
      when spa.status='trialing'
        and (spa.trial_ends_at is null or spa.trial_ends_at > now())
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

CREATE OR REPLACE FUNCTION private.studio_subscription_effective_status(p_studio_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select case
      when spa.status='trialing'
        and spa.trial_ends_at is not null
        and spa.trial_ends_at <= now()
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

CREATE OR REPLACE FUNCTION public.current_studio_capabilities(p_studio_id uuid)
 RETURNS TABLE(capability_key text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select rc.capability_key
  from public.studio_memberships m
  join public.role_capabilities rc on rc.role=m.role
  where m.studio_id=p_studio_id
    and m.user_id=(select auth.uid())
    and m.active=true
    and (
      private.studio_subscription_access_mode(p_studio_id)='full'
      or (
        m.role='owner'
        and rc.capability_key='admin.portal'
      )
    )
    and (
      rc.capability_key='admin.portal'
      or not exists (
        select 1
        from public.saas_module_capabilities mc
        where mc.capability_key=rc.capability_key
      )
      or exists (
        select 1
        from public.saas_module_capabilities mc
        where mc.capability_key=rc.capability_key
          and private.studio_has_module(p_studio_id,mc.module_key)
      )
    )
  order by rc.capability_key;
$function$;

CREATE OR REPLACE FUNCTION public.current_studio_modules(p_studio_id uuid)
 RETURNS TABLE(module_key text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select sm.module_key
  from public.studio_memberships m
  join public.studio_plan_assignments spa
    on spa.studio_id=m.studio_id
  join public.saas_plans sp
    on sp.id=spa.plan_id
   and sp.active=true
  join public.saas_modules sm
    on sm.active=true
  left join public.saas_plan_modules spm
    on spm.plan_id=spa.plan_id
   and spm.module_key=sm.module_key
  left join public.studio_module_overrides smo
    on smo.studio_id=m.studio_id
   and smo.module_key=sm.module_key
  where m.studio_id=p_studio_id
    and m.user_id=(select auth.uid())
    and m.active=true
    and private.studio_subscription_access_mode(p_studio_id)='full'
    and coalesce(
      case
        when smo.enabled is not null
          and (smo.expires_at is null or smo.expires_at > now())
          then smo.enabled
        else spm.enabled
      end,
      false
    )
  order by sm.sort_order,sm.module_key;
$function$;

CREATE OR REPLACE FUNCTION public.current_studio_subscription(p_studio_id uuid)
 RETURNS TABLE(plan_key text, plan_name text, status text, effective_status text, access_mode text, trial_ends_at timestamp with time zone, current_period_start timestamp with time zone, current_period_end timestamp with time zone, grace_ends_at timestamp with time zone, cancel_at_period_end boolean, cancelled_at timestamp with time zone, suspended_at timestamp with time zone, last_payment_failure_at timestamp with time zone, billing_provider text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not (
    exists(
      select 1
      from public.studio_memberships m
      where m.studio_id=p_studio_id
        and m.user_id=(select auth.uid())
        and m.active=true
    )
    or exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    p.plan_key,
    p.name,
    spa.status,
    private.studio_subscription_effective_status(p_studio_id),
    private.studio_subscription_access_mode(p_studio_id),
    spa.trial_ends_at,
    spa.current_period_start,
    spa.current_period_end,
    spa.grace_ends_at,
    spa.cancel_at_period_end,
    spa.cancelled_at,
    spa.suspended_at,
    spa.last_payment_failure_at,
    spa.billing_provider
  from public.studio_plan_assignments spa
  join public.saas_plans p on p.id=spa.plan_id
  where spa.studio_id=p_studio_id
  limit 1;
end;
$function$;

revoke all on function private.studio_subscription_access_mode(uuid)
  from public,anon;
grant execute on function private.studio_subscription_access_mode(uuid)
  to authenticated,service_role;

revoke all on function private.studio_subscription_effective_status(uuid)
  from public,anon;
grant execute on function private.studio_subscription_effective_status(uuid)
  to authenticated,service_role;

revoke all on function public.current_studio_subscription(uuid)
  from public,anon;
grant execute on function public.current_studio_subscription(uuid)
  to authenticated,service_role;

revoke all on function private.log_studio_subscription_event()
  from public,anon,authenticated;

drop trigger if exists studio_subscription_event_trg
  on public.studio_plan_assignments;
create trigger studio_subscription_event_trg
after update of
  status,trial_ends_at,current_period_start,current_period_end,
  grace_ends_at,cancel_at_period_end,cancelled_at,suspended_at,
  last_payment_failure_at
on public.studio_plan_assignments
for each row
execute function private.log_studio_subscription_event();
