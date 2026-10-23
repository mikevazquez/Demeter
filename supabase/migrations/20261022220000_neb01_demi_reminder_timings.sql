-- NEB-01-37 · Nébora: tiempos de los recordatorios de Demi editables por el dueño.
-- Decisión de Mike (22-oct-2026): los cambia el dueño en la configuración de Demi; Nébora trae
-- valores por defecto, que son los que Demeter usa hoy:
--  * Pago pendiente: a las 2 y a las 6 horas.
--  * Paquete o inscripción por recuperar: a los 7, 15 y 30 días.
--  * Alumna inactiva: a los 14 días.
--  * Paquete por vencer: 3 días antes.
--  * Apartado de primera clase pagada por adelantado: 30 minutos para mandar el comprobante.

alter table public.demi_followup_settings
  add column if not exists payment_reminder_hours integer[] not null default '{2,6}',
  add column if not exists package_reminder_days integer[] not null default '{7,15,30}',
  add column if not exists inactive_reminder_days integer not null default 14,
  add column if not exists package_expiring_days_before integer not null default 3,
  add column if not exists trial_payment_hold_minutes integer not null default 30;

alter table public.demi_followup_settings
  drop constraint if exists demi_followup_settings_neb_timings_check;
alter table public.demi_followup_settings
  add constraint demi_followup_settings_neb_timings_check check (
    cardinality(payment_reminder_hours) between 1 and 3
    and 1 <= all(payment_reminder_hours) and 168 >= all(payment_reminder_hours)
    and cardinality(package_reminder_days) between 1 and 4
    and 1 <= all(package_reminder_days) and 90 >= all(package_reminder_days)
    and inactive_reminder_days between 3 and 90
    and package_expiring_days_before between 0 and 14
    and trial_payment_hold_minutes between 10 and 1440);

-- Recordatorios: los tiempos salen de la configuración del estudio (antes, fijos).
do $migration$
declare
  v_sig text := 'public.service_schedule_demi_followups(uuid,uuid,text,text,timestamp with time zone)';
  v_def text;
  v_new text;
  v_pairs text[] := array[
    'array[interval ''2 hours'',interval ''6 hours'']',
    '(select array_agg(make_interval(hours=>u.h) order by u.o) from unnest(settings.payment_reminder_hours) with ordinality u(h,o))',
    'array[interval ''7 days'',interval ''15 days'',interval ''30 days'']',
    '(select array_agg(make_interval(days=>u.d) order by u.o) from unnest(settings.package_reminder_days) with ordinality u(d,o))',
    'array[interval ''14 days'']',
    'array[make_interval(days=>settings.inactive_reminder_days)]',
    'array[interval ''-3 days'']',
    'array[make_interval(days=>-settings.package_expiring_days_before)]'
  ];
  i integer;
begin
  if to_regprocedure(v_sig) is null then
    raise notice 'NEB-01: % no existe en esta base; se omite', v_sig;
    return;
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  v_new := v_def;
  for i in 1 .. array_length(v_pairs, 1) by 2 loop
    if position(v_pairs[i] in v_new) = 0 then
      raise exception 'NEB-01: definición inesperada de % (recordatorios): falta «%»', v_sig, v_pairs[i];
    end if;
    v_new := replace(v_new, v_pairs[i], v_pairs[i + 1]);
  end loop;
  execute v_new;
end
$migration$;

-- Apartado de primera clase pagada por adelantado.
create or replace function private.set_trial_transfer_expiry()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.intent_kind='trial_class' and new.status='awaiting_receipt' then
    new.expires_at := clock_timestamp() + make_interval(mins => coalesce(
      (select s.trial_payment_hold_minutes from public.demi_followup_settings s where s.studio_id = new.studio_id),
      30));
  end if;
  return new;
end;
$function$;

-- Guardar desde Demi › Seguimientos.
create or replace function public.admin_save_demi_reminder_timings(
  p_studio uuid,
  p_payment_reminder_hours integer[],
  p_package_reminder_days integer[],
  p_inactive_reminder_days integer,
  p_package_expiring_days_before integer,
  p_trial_payment_hold_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_capability(p_studio, 'settings.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.demi_followup_settings (studio_id) values (p_studio)
  on conflict (studio_id) do nothing;
  update public.demi_followup_settings set
    payment_reminder_hours = (select array_agg(x order by x) from unnest(p_payment_reminder_hours) x),
    package_reminder_days = (select array_agg(x order by x) from unnest(p_package_reminder_days) x),
    inactive_reminder_days = p_inactive_reminder_days,
    package_expiring_days_before = p_package_expiring_days_before,
    trial_payment_hold_minutes = p_trial_payment_hold_minutes
  where studio_id = p_studio;
end;
$$;
revoke all on function public.admin_save_demi_reminder_timings(uuid, integer[], integer[], integer, integer, integer) from public, anon;
grant execute on function public.admin_save_demi_reminder_timings(uuid, integer[], integer[], integer, integer, integer) to authenticated;
