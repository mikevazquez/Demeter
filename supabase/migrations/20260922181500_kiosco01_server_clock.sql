-- KIOSCO-01 · server clock helper
-- Evita depender del reloj del navegador/servidor de render para habilitar
-- controles operativos; Studio Flow usa la hora de PostgreSQL como autoridad.

create or replace function public.current_server_time()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $function$
  select now();
$function$;

revoke all on function public.current_server_time() from public, anon;
grant execute on function public.current_server_time() to authenticated;
