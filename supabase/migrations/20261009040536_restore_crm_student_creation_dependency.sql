-- Restore the original DEV-04F static limit definitions used by the existing student creation trigger.
-- Source: sandbox migration 20260926180439; tables were dropped by 20261007054052.
-- Does not change trigger/function logic, overwrite custom limits or alter transaction histories.

create table if not exists public.saas_limit_definitions (
  limit_key text primary key,
  name text not null,
  description text,
  unit text not null,
  sort_order integer not null default 0,
  enforce boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_limit_definitions_key_format check (limit_key ~ '^[a-z][a-z0-9_]*$')
);

create table if not exists public.saas_plan_limits (
  plan_id uuid not null references public.saas_plans(id) on delete cascade,
  limit_key text not null references public.saas_limit_definitions(limit_key) on delete cascade,
  limit_value bigint,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(plan_id,limit_key),
  constraint saas_plan_limits_positive check (limit_value is null or limit_value > 0)
);

create index if not exists saas_plan_limits_limit_key_idx
  on public.saas_plan_limits(limit_key);

alter table public.saas_limit_definitions enable row level security;
alter table public.saas_plan_limits enable row level security;

drop policy if exists saas_limit_definitions_authenticated_read on public.saas_limit_definitions;
create policy saas_limit_definitions_authenticated_read
  on public.saas_limit_definitions for select to authenticated using (true);

drop policy if exists saas_plan_limits_authenticated_read on public.saas_plan_limits;
create policy saas_plan_limits_authenticated_read
  on public.saas_plan_limits for select to authenticated using (true);

revoke all on public.saas_limit_definitions from anon,authenticated;
revoke all on public.saas_plan_limits from anon,authenticated;
grant select on public.saas_limit_definitions to authenticated;
grant select on public.saas_plan_limits to authenticated;
grant all on public.saas_limit_definitions to service_role;
grant all on public.saas_plan_limits to service_role;

insert into public.saas_limit_definitions(
  limit_key,name,description,unit,sort_order,enforce
)
values
  ('active_students','Alumnas activas','Alumnas activas dentro del estudio.','alumnas',10,true),
  ('sites','Sedes activas','Sedes activas configuradas para el estudio.','sedes',20,true),
  ('admin_users','Usuarios administrativos','Usuarios activos con acceso al portal administrativo.','usuarios',30,true),
  ('instructors','Coaches / instructores','Coaches o instructores activos del estudio.','coaches',40,false)
on conflict(limit_key) do nothing;


insert into public.saas_plan_limits(plan_id,limit_key,limit_value,note)
select p.id,v.limit_key,v.limit_value,v.note
from public.saas_plans p
join (
  values
    ('core','active_students',100::bigint,null::text),
    ('core','sites',1::bigint,null::text),
    ('core','admin_users',3::bigint,null::text),
    ('core','instructors',null::bigint,'Ilimitados'),
    ('growth','active_students',250::bigint,null::text),
    ('growth','sites',1::bigint,null::text),
    ('growth','admin_users',8::bigint,null::text),
    ('growth','instructors',null::bigint,'Ilimitados'),
    ('pro','active_students',null::bigint,'Ilimitadas · sujeto a uso razonable'),
    ('pro','sites',2::bigint,null::text),
    ('pro','admin_users',null::bigint,'Ilimitados'),
    ('pro','instructors',null::bigint,'Ilimitados'),
    ('all_access','active_students',null::bigint,'Ilimitadas'),
    ('all_access','sites',null::bigint,'Ilimitadas'),
    ('all_access','admin_users',null::bigint,'Ilimitados'),
    ('all_access','instructors',null::bigint,'Ilimitados')
) as v(plan_key,limit_key,limit_value,note)
  on v.plan_key=p.plan_key
on conflict(plan_id,limit_key) do nothing;


