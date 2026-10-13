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
on conflict(limit_key) do update
set name=excluded.name,
    description=excluded.description,
    unit=excluded.unit,
    sort_order=excluded.sort_order,
    enforce=excluded.enforce,
    updated_at=now();

delete from public.saas_plan_limits spl
using public.saas_plans p
where spl.plan_id=p.id
  and p.plan_key in ('core','growth','pro','all_access');

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
on conflict(plan_id,limit_key) do update
set limit_value=excluded.limit_value,
    note=excluded.note,
    updated_at=now();

create or replace function private.studio_plan_limit_value(
  p_studio_id uuid,
  p_limit_key text
)
returns bigint
language sql
stable
security definer
set search_path=''
as $function$
  select spl.limit_value
  from public.studio_plan_assignments spa
  join public.saas_plans p
    on p.id=spa.plan_id
   and p.active=true
  join public.saas_plan_limits spl
    on spl.plan_id=p.id
   and spl.limit_key=p_limit_key
  where spa.studio_id=p_studio_id
    and spa.status in ('active','trialing')
  limit 1;
$function$;

revoke all on function private.studio_plan_limit_value(uuid,text)
  from public,anon,authenticated;
grant execute on function private.studio_plan_limit_value(uuid,text) to service_role;

create or replace function private.studio_plan_limit_usage(
  p_studio_id uuid,
  p_limit_key text
)
returns bigint
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  case p_limit_key
    when 'active_students' then
      return (
        select count(*)::bigint
        from public.students s
        where s.studio_id=p_studio_id
          and s.active=true
          and s.lifecycle_status::text='active'
      );
    when 'sites' then
      return (
        select count(*)::bigint
        from public.sites s
        where s.studio_id=p_studio_id
          and s.active=true
      );
    when 'admin_users' then
      return (
        select count(distinct m.user_id)::bigint
        from public.studio_memberships m
        where m.studio_id=p_studio_id
          and m.active=true
          and exists(
            select 1
            from public.role_capabilities rc
            where rc.role=m.role
              and rc.capability_key='admin.portal'
          )
      );
    when 'instructors' then
      return (
        select count(*)::bigint
        from public.instructors i
        where i.studio_id=p_studio_id
          and i.status='active'
      );
    else
      raise exception 'unknown_plan_limit'
        using detail=jsonb_build_object('limit_key',p_limit_key)::text;
  end case;
end;
$function$;

revoke all on function private.studio_plan_limit_usage(uuid,text)
  from public,anon,authenticated;
grant execute on function private.studio_plan_limit_usage(uuid,text)
  to authenticated,service_role;

create or replace function private.assert_studio_plan_limit_increment(
  p_studio_id uuid,
  p_limit_key text,
  p_increment bigint default 1
)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_limit bigint;
  v_usage bigint;
  v_has_assignment boolean;
begin
  if p_increment <= 0 then
    return;
  end if;

  select exists(
    select 1
    from public.studio_plan_assignments spa
    where spa.studio_id=p_studio_id
      and spa.status in ('active','trialing')
  ) into v_has_assignment;

  if not v_has_assignment then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_studio_id::text || ':' || p_limit_key,0)
  );

  v_limit := private.studio_plan_limit_value(p_studio_id,p_limit_key);

  if v_limit is null then
    return;
  end if;

  v_usage := private.studio_plan_limit_usage(p_studio_id,p_limit_key);

  if v_usage + p_increment > v_limit then
    raise exception 'plan_limit_exceeded'
      using
        errcode='P0001',
        detail=jsonb_build_object(
          'limit_key',p_limit_key,
          'limit_value',v_limit,
          'current_usage',v_usage,
          'requested_increment',p_increment
        )::text;
  end if;
end;
$function$;

revoke all on function private.assert_studio_plan_limit_increment(uuid,text,bigint)
  from public,anon,authenticated;
grant execute on function private.assert_studio_plan_limit_increment(uuid,text,bigint)
  to service_role;

create or replace function private.enforce_student_plan_limit()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_new_counts boolean;
  v_old_counts boolean := false;
begin
  v_new_counts := new.active=true and new.lifecycle_status::text='active';

  if tg_op='UPDATE' then
    v_old_counts := old.active=true and old.lifecycle_status::text='active';
  end if;

  if v_new_counts
     and (
       tg_op='INSERT'
       or not v_old_counts
       or new.studio_id is distinct from old.studio_id
     ) then
    perform private.assert_studio_plan_limit_increment(
      new.studio_id,'active_students',1
    );
  end if;

  return new;
end;
$function$;

create or replace function private.enforce_site_plan_limit()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_old_counts boolean := false;
begin
  if tg_op='UPDATE' then
    v_old_counts := old.active=true;
  end if;

  if new.active=true
     and (
       tg_op='INSERT'
       or not v_old_counts
       or new.studio_id is distinct from old.studio_id
     ) then
    perform private.assert_studio_plan_limit_increment(
      new.studio_id,'sites',1
    );
  end if;

  return new;
end;
$function$;

create or replace function private.enforce_admin_user_plan_limit()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_new_counts boolean;
  v_old_counts boolean := false;
begin
  v_new_counts := new.active=true and exists(
    select 1
    from public.role_capabilities rc
    where rc.role=new.role
      and rc.capability_key='admin.portal'
  );

  if tg_op='UPDATE' then
    v_old_counts := old.active=true and exists(
      select 1
      from public.role_capabilities rc
      where rc.role=old.role
        and rc.capability_key='admin.portal'
    );
  end if;

  if v_new_counts
     and (
       tg_op='INSERT'
       or not v_old_counts
       or new.studio_id is distinct from old.studio_id
     ) then
    perform private.assert_studio_plan_limit_increment(
      new.studio_id,'admin_users',1
    );
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_student_plan_limit()
  from public,anon,authenticated;
revoke all on function private.enforce_site_plan_limit()
  from public,anon,authenticated;
revoke all on function private.enforce_admin_user_plan_limit()
  from public,anon,authenticated;

drop trigger if exists students_plan_limit_trg on public.students;
create trigger students_plan_limit_trg
before insert or update of studio_id,active,lifecycle_status
on public.students
for each row execute function private.enforce_student_plan_limit();

drop trigger if exists sites_plan_limit_trg on public.sites;
create trigger sites_plan_limit_trg
before insert or update of studio_id,active
on public.sites
for each row execute function private.enforce_site_plan_limit();

drop trigger if exists studio_memberships_plan_limit_trg on public.studio_memberships;
create trigger studio_memberships_plan_limit_trg
before insert or update of studio_id,role,active
on public.studio_memberships
for each row execute function private.enforce_admin_user_plan_limit();

create or replace function public.current_studio_plan_usage(
  p_studio_id uuid
)
returns table(
  plan_key text,
  plan_name text,
  limit_key text,
  limit_name text,
  unit text,
  limit_value bigint,
  usage bigint,
  unlimited boolean,
  over_limit boolean,
  remaining bigint,
  note text
)
language plpgsql
stable
security invoker
set search_path=''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not (
    exists(
      select 1
      from public.studio_memberships m
      join public.role_capabilities rc on rc.role=m.role
      where m.studio_id=p_studio_id
        and m.user_id=(select auth.uid())
        and m.active=true
        and rc.capability_key='admin.portal'
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
    d.limit_key,
    d.name,
    d.unit,
    l.limit_value,
    private.studio_plan_limit_usage(p_studio_id,d.limit_key) as usage,
    l.limit_value is null as unlimited,
    (
      l.limit_value is not null
      and private.studio_plan_limit_usage(p_studio_id,d.limit_key) > l.limit_value
    ) as over_limit,
    case
      when l.limit_value is null then null
      else greatest(
        l.limit_value-private.studio_plan_limit_usage(p_studio_id,d.limit_key),
        0
      )
    end as remaining,
    l.note
  from public.studio_plan_assignments spa
  join public.saas_plans p on p.id=spa.plan_id
  join public.saas_plan_limits l on l.plan_id=p.id
  join public.saas_limit_definitions d on d.limit_key=l.limit_key
  where spa.studio_id=p_studio_id
    and spa.status in ('active','trialing')
  order by d.sort_order,d.limit_key;
end;
$function$;

revoke all on function public.current_studio_plan_usage(uuid)
  from public,anon;
grant execute on function public.current_studio_plan_usage(uuid)
  to authenticated,service_role;
