create table if not exists public.capabilities (
  key text primary key,
  description text not null
);

create table if not exists public.role_capabilities (
  role public.studio_role not null,
  capability_key text not null references public.capabilities(key) on delete cascade,
  primary key (role, capability_key)
);

alter table public.capabilities enable row level security;
alter table public.role_capabilities enable row level security;

drop policy if exists "capabilities_read_authenticated" on public.capabilities;
create policy "capabilities_read_authenticated"
on public.capabilities for select
to authenticated
using (true);

drop policy if exists "role_capabilities_read_authenticated" on public.role_capabilities;
create policy "role_capabilities_read_authenticated"
on public.role_capabilities for select
to authenticated
using (true);

revoke insert, update, delete on public.capabilities from authenticated;
revoke insert, update, delete on public.role_capabilities from authenticated;
grant select on public.capabilities to authenticated;
grant select on public.role_capabilities to authenticated;

insert into public.capabilities (key, description) values
  ('students.read', 'Consultar alumnas dentro del alcance autorizado'),
  ('students.write', 'Crear y editar alumnas'),
  ('students.archive', 'Archivar y reactivar alumnas'),
  ('instructors.read', 'Consultar instructoras dentro del alcance autorizado'),
  ('instructors.write', 'Crear y editar instructoras'),
  ('schedule.read', 'Consultar agenda y sesiones'),
  ('schedule.write', 'Crear y modificar agenda y sesiones'),
  ('attendance.write', 'Registrar y corregir asistencia autorizada'),
  ('products.read', 'Consultar productos'),
  ('products.write', 'Crear y editar productos'),
  ('sales.read', 'Consultar ventas y pagos'),
  ('sales.write', 'Registrar ventas y pagos'),
  ('reports.read', 'Consultar reportes'),
  ('settings.write', 'Modificar configuración del estudio'),
  ('student.portal', 'Acceder al portal de alumna'),
  ('student.profile.self', 'Consultar y editar perfil propio autorizado'),
  ('student.booking.self', 'Reservar y cancelar clases propias'),
  ('instructor.portal', 'Acceder a la experiencia de instructor/coach')
on conflict (key) do update set description = excluded.description;

insert into public.role_capabilities (role, capability_key)
select r.role::public.studio_role, c.key
from (values ('owner'), ('admin')) as r(role)
cross join public.capabilities c
on conflict do nothing;

insert into public.role_capabilities (role, capability_key) values
  ('reception', 'students.read'),
  ('reception', 'students.write'),
  ('reception', 'instructors.read'),
  ('reception', 'schedule.read'),
  ('instructor', 'students.read'),
  ('instructor', 'instructors.read'),
  ('instructor', 'schedule.read'),
  ('instructor', 'attendance.write'),
  ('instructor', 'instructor.portal'),
  ('coach', 'students.read'),
  ('coach', 'instructors.read'),
  ('coach', 'schedule.read'),
  ('coach', 'attendance.write'),
  ('coach', 'instructor.portal'),
  ('student', 'student.portal'),
  ('student', 'student.profile.self'),
  ('student', 'student.booking.self')
on conflict do nothing;

create or replace function private.has_capability(p_studio_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_memberships m
    join public.role_capabilities rc on rc.role = m.role
    where m.studio_id = p_studio_id
      and m.user_id = (select auth.uid())
      and m.active = true
      and rc.capability_key = p_capability
  );
$$;

revoke all on function private.has_capability(uuid, text) from public;
grant execute on function private.has_capability(uuid, text) to authenticated;
