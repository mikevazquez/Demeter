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

create index if not exists studio_plan_assignment_events_studio_idx
  on public.studio_plan_assignment_events(studio_id,occurred_at desc);

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
