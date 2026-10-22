-- NEB-01-03 · Nébora: solicitud de activación de un módulo desde el propio estudio.
-- Decisión de Mike (22-oct-2026): lo no contratado se muestra con candado y botón «Activar».
-- Activan el dueño y administración (settings.write). El cobro proporcional con Stripe y la
-- activación automática al confirmarse el pago llegan en NEB-01-34; mientras tanto la solicitud
-- queda en la bitácora de la plataforma para que Mike la vea y la active desde la consola.

create or replace function public.studio_request_module(p_studio uuid, p_module text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_capability(p_studio, 'settings.write') then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.platform_modules where key = p_module) then
    raise exception 'module_invalid';
  end if;
  if private.studio_has_module(p_studio, p_module) then
    raise exception 'module_already_active';
  end if;

  perform private.platform_audit(p_studio, 'studio.module.requested',
    jsonb_build_object('module', p_module));
  return jsonb_build_object('requested', true, 'module', p_module);
end;
$$;
revoke all on function public.studio_request_module(uuid, text) from public, anon;
grant execute on function public.studio_request_module(uuid, text) to authenticated;
