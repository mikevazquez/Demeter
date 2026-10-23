-- NEB-01-03 · Nébora: bloqueo en la base de lo que el estudio no tiene contratado.
-- Decisiones de Mike (22-oct-2026):
--  * Un módulo no contratado no se puede usar: la pantalla lo oculta y la base de datos lo
--    rechaza aunque alguien llame directo a la API.
--  * En solo lectura (impago después de 7 días) o suspendido, el estudio ve sus datos pero no
--    puede vender ni reservar. Nada se borra. Cobrar pagos pendientes de ventas viejas sigue
--    permitido.
-- Se protegen solo los puntos de entrada que crea una persona (altas). Los procesos
-- automáticos que derivan de ellos no reciben trigger para no romper cadenas existentes.
-- Demeter y los estudios de prueba están en All Access/interno, así que nada cambia para ellos.

create or replace function private.neb_guard_can_operate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.studio_can_operate(new.studio_id) then
    raise exception 'studio_read_only' using detail = tg_table_name;
  end if;
  return new;
end;
$$;
revoke all on function private.neb_guard_can_operate() from public, anon, authenticated;

create or replace function private.neb_guard_module()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.studio_has_module(new.studio_id, tg_argv[0]) then
    raise exception 'module_not_contracted' using detail = tg_argv[0];
  end if;
  return new;
end;
$$;
revoke all on function private.neb_guard_module() from public, anon, authenticated;

-- Vender y reservar.
drop trigger if exists neb_guard_can_operate on public.sales;
create trigger neb_guard_can_operate before insert on public.sales
  for each row execute function private.neb_guard_can_operate();
drop trigger if exists neb_guard_can_operate on public.reservations;
create trigger neb_guard_can_operate before insert on public.reservations
  for each row execute function private.neb_guard_can_operate();

-- Recompensas (programas y retos).
drop trigger if exists neb_guard_module on public.reward_programs;
create trigger neb_guard_module before insert on public.reward_programs
  for each row execute function private.neb_guard_module('recompensas');
drop trigger if exists neb_guard_module on public.reward_challenge_enrollments;
create trigger neb_guard_module before insert on public.reward_challenge_enrollments
  for each row execute function private.neb_guard_module('recompensas');

-- Catálogo y evaluaciones.
drop trigger if exists neb_guard_module on public.evaluation_templates;
create trigger neb_guard_module before insert on public.evaluation_templates
  for each row execute function private.neb_guard_module('catalogo');
drop trigger if exists neb_guard_module on public.technical_evaluations;
create trigger neb_guard_module before insert on public.technical_evaluations
  for each row execute function private.neb_guard_module('catalogo');
drop trigger if exists neb_guard_module on public.evaluation_invitations;
create trigger neb_guard_module before insert on public.evaluation_invitations
  for each row execute function private.neb_guard_module('catalogo');

-- Recursos y mapa.
drop trigger if exists neb_guard_module on public.resources;
create trigger neb_guard_module before insert on public.resources
  for each row execute function private.neb_guard_module('recursos');
drop trigger if exists neb_guard_module on public.space_maps;
create trigger neb_guard_module before insert on public.space_maps
  for each row execute function private.neb_guard_module('recursos');
drop trigger if exists neb_guard_module on public.reservation_resource_assignments;
create trigger neb_guard_module before insert on public.reservation_resource_assignments
  for each row execute function private.neb_guard_module('recursos');

-- Para procesos del servidor (webhook de WhatsApp de Demi) que corren con service_role.
create or replace function public.platform_studio_entitlements_service(p_studio uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.studio_entitlements(p_studio);
$$;
revoke all on function public.platform_studio_entitlements_service(uuid) from public, anon, authenticated;
grant execute on function public.platform_studio_entitlements_service(uuid) to service_role;
