
create table if not exists public.saas_modules (
  module_key text primary key,
  name text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_modules_key_format check (module_key ~ '^[a-z][a-z0-9_]*$')
);

create table if not exists public.saas_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  name text not null,
  description text,
  internal_only boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_plans_key_format check (plan_key ~ '^[a-z][a-z0-9_]*$')
);

create table if not exists public.saas_plan_modules (
  plan_id uuid not null references public.saas_plans(id) on delete cascade,
  module_key text not null references public.saas_modules(module_key) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (plan_id,module_key)
);

create table if not exists public.saas_module_capabilities (
  capability_key text primary key,
  module_key text not null references public.saas_modules(module_key) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.studio_plan_assignments (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  plan_id uuid not null references public.saas_plans(id),
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_plan_assignments_status
    check (status in ('trialing','active','past_due','suspended','cancelled')),
  constraint studio_plan_assignments_dates
    check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.studio_module_overrides (
  studio_id uuid not null references public.studios(id) on delete cascade,
  module_key text not null references public.saas_modules(module_key) on delete cascade,
  enabled boolean not null,
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (studio_id,module_key)
);

create index if not exists saas_module_capabilities_module_idx
  on public.saas_module_capabilities(module_key);
create index if not exists saas_plan_modules_module_idx
  on public.saas_plan_modules(module_key);
create index if not exists studio_module_overrides_module_idx
  on public.studio_module_overrides(module_key);
create index if not exists studio_plan_assignments_plan_idx
  on public.studio_plan_assignments(plan_id);

alter table public.saas_modules enable row level security;
alter table public.saas_plans enable row level security;
alter table public.saas_plan_modules enable row level security;
alter table public.saas_module_capabilities enable row level security;
alter table public.studio_plan_assignments enable row level security;
alter table public.studio_module_overrides enable row level security;

do $$
begin
  create policy saas_modules_authenticated_read
    on public.saas_modules for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy saas_plans_authenticated_read
    on public.saas_plans for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy saas_plan_modules_authenticated_read
    on public.saas_plan_modules for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy saas_module_capabilities_authenticated_read
    on public.saas_module_capabilities for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy studio_plan_assignments_member_read
    on public.studio_plan_assignments for select to authenticated
    using ((select private.is_studio_member(studio_id)));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy studio_module_overrides_member_read
    on public.studio_module_overrides for select to authenticated
    using ((select private.is_studio_member(studio_id)));
exception when duplicate_object then null;
end $$;

revoke all on public.saas_modules from anon,authenticated;
revoke all on public.saas_plans from anon,authenticated;
revoke all on public.saas_plan_modules from anon,authenticated;
revoke all on public.saas_module_capabilities from anon,authenticated;
revoke all on public.studio_plan_assignments from anon,authenticated;
revoke all on public.studio_module_overrides from anon,authenticated;

grant select on public.saas_modules to authenticated;
grant select on public.saas_plans to authenticated;
grant select on public.saas_plan_modules to authenticated;
grant select on public.saas_module_capabilities to authenticated;
grant select on public.studio_plan_assignments to authenticated;
grant select on public.studio_module_overrides to authenticated;

grant all on public.saas_modules to service_role;
grant all on public.saas_plans to service_role;
grant all on public.saas_plan_modules to service_role;
grant all on public.saas_module_capabilities to service_role;
grant all on public.studio_plan_assignments to service_role;
grant all on public.studio_module_overrides to service_role;

insert into public.saas_modules(module_key,name,description,sort_order)
values
  ('core','Core','Operación esencial: agenda, alumnas, productos, ventas y asistencia.',10),
  ('waitlist','Lista de espera','Lista de espera y promoción automática de lugares.',20),
  ('resources','Recursos','Asignación y selección de recursos por actividad, sesión y reserva.',30),
  ('documents','Documentos','Documentos, responsivas y seguimiento de aceptaciones.',40),
  ('evaluations','Evaluaciones','Evaluaciones técnicas, niveles e invitaciones.',50),
  ('rewards','Progreso y recompensas','Medallas, retos, beneficios y progreso.',60),
  ('automations','Automatizaciones','Automatizaciones operativas y de engagement.',70),
  ('intelligence','Inteligencia','Métricas, conversión e inteligencia del negocio.',80),
  ('notifications','Notificaciones','Motor multicanal y preferencias de comunicaciones.',90),
  ('integrations','Integraciones','Integraciones externas y proveedores.',100)
on conflict(module_key) do update
set name=excluded.name,
    description=excluded.description,
    sort_order=excluded.sort_order,
    active=true,
    updated_at=now();

insert into public.saas_plans(plan_key,name,description,internal_only,active)
values(
  'all_access',
  'All Access',
  'Plan interno de transición que conserva todas las funciones existentes.',
  true,
  true
)
on conflict(plan_key) do update
set name=excluded.name,
    description=excluded.description,
    internal_only=true,
    active=true,
    updated_at=now();

insert into public.saas_plan_modules(plan_id,module_key,enabled)
select p.id,m.module_key,true
from public.saas_plans p
cross join public.saas_modules m
where p.plan_key='all_access'
on conflict(plan_id,module_key) do update
set enabled=true;

insert into public.saas_module_capabilities(capability_key,module_key)
values
  ('documents.read','documents'),
  ('documents.manage','documents'),
  ('evaluations.read','evaluations'),
  ('evaluations.write','evaluations'),
  ('evaluations.configure','evaluations'),
  ('rewards.read','rewards'),
  ('rewards.manage','rewards'),
  ('automations.read','automations'),
  ('automations.manage','automations'),
  ('reports.read','intelligence')
on conflict(capability_key) do update
set module_key=excluded.module_key;

insert into public.studio_plan_assignments(studio_id,plan_id,status)
select s.id,p.id,'active'
from public.studios s
cross join public.saas_plans p
where p.plan_key='all_access'
on conflict(studio_id) do nothing;

create or replace function private.studio_has_module(
  p_studio_id uuid,
  p_module_key text
)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select
    coalesce((
      select
        case
          when spa.status not in ('active','trialing') then false
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

revoke all on function private.studio_has_module(uuid,text) from public,anon,authenticated;
grant execute on function private.studio_has_module(uuid,text) to service_role;

create or replace function private.has_capability(
  p_studio_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
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
    )
    and (
      not exists (
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

create or replace function public.current_studio_capabilities(
  p_studio_id uuid
)
returns table(capability_key text)
language sql
stable
security invoker
set search_path=''
as $function$
  select rc.capability_key
  from public.studio_memberships m
  join public.role_capabilities rc on rc.role=m.role
  where m.studio_id=p_studio_id
    and m.user_id=(select auth.uid())
    and m.active=true
    and (
      not exists (
        select 1
        from public.saas_module_capabilities mc
        where mc.capability_key=rc.capability_key
      )
      or exists (
        select 1
        from public.saas_module_capabilities mc
        join public.studio_plan_assignments spa
          on spa.studio_id=m.studio_id
         and spa.status in ('active','trialing')
        join public.saas_plans sp
          on sp.id=spa.plan_id
         and sp.active=true
        join public.saas_modules sm
          on sm.module_key=mc.module_key
         and sm.active=true
        left join public.saas_plan_modules spm
          on spm.plan_id=spa.plan_id
         and spm.module_key=mc.module_key
        left join public.studio_module_overrides smo
          on smo.studio_id=m.studio_id
         and smo.module_key=mc.module_key
        where mc.capability_key=rc.capability_key
          and coalesce(
            case
              when smo.enabled is not null
                and (smo.expires_at is null or smo.expires_at > now())
                then smo.enabled
              else spm.enabled
            end,
            false
          )
      )
    )
  order by rc.capability_key;
$function$;

revoke all on function public.current_studio_capabilities(uuid) from public,anon;
grant execute on function public.current_studio_capabilities(uuid) to authenticated,service_role;

create or replace function public.current_studio_modules(
  p_studio_id uuid
)
returns table(module_key text)
language sql
stable
security invoker
set search_path=''
as $function$
  select sm.module_key
  from public.studio_memberships m
  join public.studio_plan_assignments spa
    on spa.studio_id=m.studio_id
   and spa.status in ('active','trialing')
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

revoke all on function public.current_studio_modules(uuid) from public,anon;
grant execute on function public.current_studio_modules(uuid) to authenticated,service_role;

create or replace function public.service_provision_studio_v2(
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
  p_space_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_phone_country_calling_code text := btrim(coalesce(p_phone_country_calling_code,''));
  v_all_access_plan_id uuid;
begin
  if v_phone_country_calling_code !~ '^\+[1-9][0-9]{0,3}$' then
    raise exception 'phone_country_calling_code_invalid' using errcode='22023';
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

  select id into v_all_access_plan_id
  from public.saas_plans
  where plan_key='all_access'
    and active=true
  limit 1;

  if v_all_access_plan_id is null then
    raise exception 'default_saas_plan_missing';
  end if;

  insert into public.studio_plan_assignments(studio_id,plan_id,status)
  values((v_result->>'studio_id')::uuid,v_all_access_plan_id,'active')
  on conflict(studio_id) do nothing;

  return v_result;
end;
$function$;

revoke all on function public.service_provision_studio_v2(
  text,text,text,text,text,text,text,uuid,text,boolean,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_provision_studio_v2(
  text,text,text,text,text,text,text,uuid,text,boolean,text,text,text
) to service_role;
