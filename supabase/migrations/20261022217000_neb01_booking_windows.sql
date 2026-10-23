-- NEB-01-38/39/40 · Nébora: reglas de reserva configurables por estudio y por actividad.
-- Decisiones de Mike (22-oct-2026):
--  * Tiempo para cancelar: el del estudio y, opcional, uno por actividad.
--  * Registro con QR: minutos antes y después del inicio, por estudio y opcional por actividad.
--    Una sola regla para el QR de la alumna, el kiosco y la pantalla del coach.
--  * Apertura de reservas: sin límite (como hoy), X minutos antes de cada clase, o un día y hora
--    fijos que abren toda la semana siguiente (ej. domingo 20:00), en la hora del estudio.
--  * Cierre de reservas: minutos antes del inicio. Lo respetan la app de la alumna y Demi.
--    Recepción, coaches y administración (schedule.write o attendance.write) pueden saltarlo.
-- Valores de arranque: cancelar 5 h (como hoy), QR 20 min antes y 30 min después (como hoy),
-- apertura sin límite (como hoy) y cierre 30 min antes (lo que Demi ya usa; Mike lo confirma en
-- la demo). Solo cambia para Demeter que la app de la alumna ya no reserva en los últimos 30 min.

-- 1 · Columnas -------------------------------------------------------------------------------

alter table public.studio_operating_policies
  add column if not exists booking_close_minutes_before integer not null default 30,
  add column if not exists booking_open_mode text not null default 'none',
  add column if not exists booking_open_minutes_before integer,
  add column if not exists booking_open_weekday smallint,
  add column if not exists booking_open_time time,
  add column if not exists checkin_opens_minutes_before integer not null default 20,
  add column if not exists checkin_closes_minutes_after integer not null default 30;

alter table public.studio_operating_policies
  drop constraint if exists studio_operating_policies_booking_close_check,
  drop constraint if exists studio_operating_policies_booking_open_check,
  drop constraint if exists studio_operating_policies_checkin_check;
alter table public.studio_operating_policies
  add constraint studio_operating_policies_booking_close_check
    check (booking_close_minutes_before between 0 and 10080),
  add constraint studio_operating_policies_booking_open_check check (
    coalesce(booking_open_mode = 'none', false)
    or (booking_open_mode = 'relative' and booking_open_minutes_before is not null
        and booking_open_minutes_before between 60 and 129600)
    or (booking_open_mode = 'weekly' and booking_open_weekday is not null
        and booking_open_weekday between 0 and 6 and booking_open_time is not null)
  ),
  add constraint studio_operating_policies_checkin_check check (
    checkin_opens_minutes_before between 0 and 240 and checkin_closes_minutes_after between 0 and 240
  );

-- Por actividad: null = usa la regla del estudio.
alter table public.class_templates
  add column if not exists cancellation_cutoff_minutes integer,
  add column if not exists booking_close_minutes_before integer,
  add column if not exists booking_open_mode text,
  add column if not exists booking_open_minutes_before integer,
  add column if not exists booking_open_weekday smallint,
  add column if not exists booking_open_time time,
  add column if not exists checkin_opens_minutes_before integer,
  add column if not exists checkin_closes_minutes_after integer;

alter table public.class_templates
  drop constraint if exists class_templates_neb_cancellation_check,
  drop constraint if exists class_templates_neb_booking_close_check,
  drop constraint if exists class_templates_neb_booking_open_check,
  drop constraint if exists class_templates_neb_checkin_check;
alter table public.class_templates
  add constraint class_templates_neb_cancellation_check
    check (cancellation_cutoff_minutes is null or cancellation_cutoff_minutes between 0 and 10080),
  add constraint class_templates_neb_booking_close_check
    check (booking_close_minutes_before is null or booking_close_minutes_before between 0 and 10080),
  add constraint class_templates_neb_booking_open_check check (
    booking_open_mode is null
    or booking_open_mode = 'none'
    or (booking_open_mode = 'relative' and booking_open_minutes_before is not null
        and booking_open_minutes_before between 60 and 129600)
    or (booking_open_mode = 'weekly' and booking_open_weekday is not null
        and booking_open_weekday between 0 and 6 and booking_open_time is not null)
  ),
  add constraint class_templates_neb_checkin_check check (
    (checkin_opens_minutes_before is null or checkin_opens_minutes_before between 0 and 240)
    and (checkin_closes_minutes_after is null or checkin_closes_minutes_after between 0 and 240)
  );

-- 2 · Política del estudio con los valores nuevos cuando todavía no tiene renglón ---------------

create or replace function private.studio_operating_policy(p_studio_id uuid)
returns public.studio_operating_policies
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_policy public.studio_operating_policies%rowtype;
begin
  select * into v_policy
  from public.studio_operating_policies
  where studio_id=p_studio_id;

  if not found then
    v_policy.studio_id := p_studio_id;
    v_policy.cancellation_cutoff_minutes := 300;
    v_policy.late_cancellation_consumes_credit := true;
    v_policy.no_show_consumes_credit := true;
    v_policy.default_minimum_reservations_enabled := false;
    v_policy.default_minimum_reservations := 2;
    v_policy.default_minimum_review_minutes_before := 120;
    v_policy.default_minimum_override_allowed := true;
    v_policy.unlimited_late_cancellation_penalty_minor := 0;
    v_policy.unlimited_no_show_penalty_minor := 0;
    v_policy.booking_close_minutes_before := 30;
    v_policy.booking_open_mode := 'none';
    v_policy.checkin_opens_minutes_before := 20;
    v_policy.checkin_closes_minutes_after := 30;
    v_policy.updated_by_user_id := null;
    v_policy.updated_at := now();
  end if;

  return v_policy;
end;
$$;

-- 3 · Reglas efectivas de una clase --------------------------------------------------------------

create or replace function private.session_booking_rules(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_policy public.studio_operating_policies%rowtype;
  v_tz text;
  v_cancel integer;
  v_close integer;
  v_mode text;
  v_open_minutes integer;
  v_open_weekday smallint;
  v_open_time time;
  v_checkin_before integer;
  v_checkin_after integer;
  v_opens_at timestamptz;
  v_week_start date;
  v_open_date date;
begin
  select * into v_session from public.class_sessions where id = p_session_id;
  if not found then return null; end if;
  select * into v_template from public.class_templates where id = v_session.template_id;
  v_policy := private.studio_operating_policy(v_session.studio_id);
  v_tz := coalesce(
    (select nullif(btrim(s.timezone), '') from public.studios s where s.id = v_session.studio_id),
    'America/Mexico_City');

  v_cancel := coalesce(v_template.cancellation_cutoff_minutes, v_policy.cancellation_cutoff_minutes, 300);
  v_close := coalesce(v_template.booking_close_minutes_before, v_policy.booking_close_minutes_before, 30);
  v_checkin_before := coalesce(v_template.checkin_opens_minutes_before, v_policy.checkin_opens_minutes_before, 20);
  v_checkin_after := coalesce(v_template.checkin_closes_minutes_after, v_policy.checkin_closes_minutes_after, 30);

  if v_template.booking_open_mode is not null then
    v_mode := v_template.booking_open_mode;
    v_open_minutes := v_template.booking_open_minutes_before;
    v_open_weekday := v_template.booking_open_weekday;
    v_open_time := v_template.booking_open_time;
  else
    v_mode := coalesce(v_policy.booking_open_mode, 'none');
    v_open_minutes := v_policy.booking_open_minutes_before;
    v_open_weekday := v_policy.booking_open_weekday;
    v_open_time := v_policy.booking_open_time;
  end if;

  if v_mode = 'relative' and v_open_minutes is not null then
    v_opens_at := v_session.starts_at - make_interval(mins => v_open_minutes);
  elsif v_mode = 'weekly' and v_open_weekday is not null and v_open_time is not null then
    -- La semana de la clase empieza el lunes; abre el día y hora configurados de los 7 días
    -- previos (domingo 20:00 abre de lunes a domingo siguientes).
    v_week_start := date_trunc('week', v_session.starts_at at time zone v_tz)::date;
    v_open_date := v_week_start - (case when ((1 - v_open_weekday + 7) % 7) = 0 then 7
                                        else (1 - v_open_weekday + 7) % 7 end);
    v_opens_at := (v_open_date + v_open_time) at time zone v_tz;
  else
    v_mode := 'none';
    v_opens_at := null;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'studio_id', v_session.studio_id,
    'timezone', v_tz,
    'starts_at', v_session.starts_at,
    'cancellation_cutoff_minutes', v_cancel,
    'cancellation_cutoff_at', v_session.starts_at - make_interval(mins => v_cancel),
    'booking_open_mode', v_mode,
    'booking_opens_at', v_opens_at,
    'booking_close_minutes_before', v_close,
    'booking_closes_at', v_session.starts_at - make_interval(mins => v_close),
    'checkin_opens_at', v_session.starts_at - make_interval(mins => v_checkin_before),
    'checkin_closes_at', v_session.starts_at + make_interval(mins => v_checkin_after)
  );
end;
$$;
revoke all on function private.session_booking_rules(uuid) from public, anon, authenticated;

create or replace function private.session_booking_opens_at(p_session_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select (private.session_booking_rules(p_session_id) ->> 'booking_opens_at')::timestamptz;
$$;
create or replace function private.session_booking_closes_at(p_session_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select (private.session_booking_rules(p_session_id) ->> 'booking_closes_at')::timestamptz;
$$;
create or replace function private.session_checkin_opens_at(p_session_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select (private.session_booking_rules(p_session_id) ->> 'checkin_opens_at')::timestamptz;
$$;
create or replace function private.session_checkin_closes_at(p_session_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select (private.session_booking_rules(p_session_id) ->> 'checkin_closes_at')::timestamptz;
$$;
-- 'open' | 'not_open' | 'closed' (o null si la clase no existe).
create or replace function private.session_booking_window_state(p_session_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when r is null then null
    when (r ->> 'booking_opens_at') is not null and now() < (r ->> 'booking_opens_at')::timestamptz then 'not_open'
    when now() >= (r ->> 'booking_closes_at')::timestamptz then 'closed'
    else 'open' end
  from (select private.session_booking_rules(p_session_id) as r) x;
$$;
create or replace function private.session_booking_open_now(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.session_booking_window_state(p_session_id) = 'open', false);
$$;
revoke all on function private.session_booking_opens_at(uuid) from public, anon, authenticated;
revoke all on function private.session_booking_closes_at(uuid) from public, anon, authenticated;
revoke all on function private.session_checkin_opens_at(uuid) from public, anon, authenticated;
revoke all on function private.session_checkin_closes_at(uuid) from public, anon, authenticated;
revoke all on function private.session_booking_window_state(uuid) from public, anon, authenticated;
revoke all on function private.session_booking_open_now(uuid) from public, anon, authenticated;

-- Cancelación a tiempo o tardía con la regla de la actividad (o la del estudio).
create or replace function private.reservation_cancellation_outcome_for_session(p_session_id uuid)
returns public.reservation_status
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when now() <= (private.session_booking_rules(p_session_id) ->> 'cancellation_cutoff_at')::timestamptz
      then 'cancelled_on_time'::public.reservation_status
    else 'cancelled_late'::public.reservation_status end;
$$;
revoke all on function private.reservation_cancellation_outcome_for_session(uuid) from public, anon, authenticated;

-- 4 · Quién respeta la ventana: alumnas y Demi. El equipo del estudio la puede saltar. ------------

create or replace function private.booking_window_applies(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not (
    coalesce(current_setting('nebora.booking_window_bypass', true), '') = 'on'
    or ((select auth.uid()) is not null and (
      private.has_capability(p_studio_id, 'schedule.write')
      or private.has_capability(p_studio_id, 'attendance.write')))
  );
$$;
revoke all on function private.booking_window_applies(uuid) from public, anon, authenticated;

create or replace function private.neb_guard_booking_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if new.status::text <> 'reserved' then return new; end if;
  if not private.booking_window_applies(new.studio_id) then return new; end if;
  -- Las promociones desde lista de espera no se frenan (la alumna ya estaba esperando).
  if new.student_id is not null and exists (
    select 1 from public.class_waitlist_entries w
    where w.session_id = new.session_id and w.student_id = new.student_id and w.status = 'active'
  ) then
    return new;
  end if;
  v_state := private.session_booking_window_state(new.session_id);
  if v_state = 'not_open' then
    raise exception 'booking_not_open'
      using detail = coalesce(private.session_booking_opens_at(new.session_id)::text, '');
  elsif v_state = 'closed' then
    raise exception 'booking_closed';
  end if;
  return new;
end;
$$;
revoke all on function private.neb_guard_booking_window() from public, anon, authenticated;

drop trigger if exists neb_guard_booking_window on public.reservations;
create trigger neb_guard_booking_window before insert on public.reservations
  for each row execute function private.neb_guard_booking_window();

-- Agrega el motivo a una respuesta de elegibilidad que de otra forma diría "sí".
create or replace function private.neb_booking_window_overlay(p_session_id uuid, p_result jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_rules jsonb;
begin
  if p_result is null or coalesce((p_result ->> 'eligible')::boolean, false) is not true then
    return p_result;
  end if;
  v_rules := private.session_booking_rules(p_session_id);
  if v_rules is null or not private.booking_window_applies((v_rules ->> 'studio_id')::uuid) then
    return p_result;
  end if;
  v_state := private.session_booking_window_state(p_session_id);
  if v_state = 'not_open' then
    return p_result || jsonb_build_object('eligible', false, 'reason_code', 'booking_not_open',
      'booking_opens_at', v_rules -> 'booking_opens_at');
  elsif v_state = 'closed' then
    return p_result || jsonb_build_object('eligible', false, 'reason_code', 'booking_closed',
      'booking_closes_at', v_rules -> 'booking_closes_at');
  end if;
  return p_result;
end;
$$;
revoke all on function private.neb_booking_window_overlay(uuid, jsonb) from public, anon, authenticated;

-- 5 · Ventanas para la app y para Demi ------------------------------------------------------------

create or replace function public.session_booking_windows(p_session_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.session_booking_rules(cs.id)), '[]'::jsonb)
  from public.class_sessions cs
  where cs.id = any(coalesce(p_session_ids, '{}'::uuid[]))
    and (
      private.has_capability(cs.studio_id, 'schedule.read')
      or exists (select 1 from public.students st
                 where st.studio_id = cs.studio_id and st.user_id = (select auth.uid()) and st.active)
    );
$$;
revoke all on function public.session_booking_windows(uuid[]) from public, anon;
grant execute on function public.session_booking_windows(uuid[]) to authenticated;

create or replace function public.service_session_booking_windows(p_studio_id uuid, p_session_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.session_booking_rules(cs.id)), '[]'::jsonb)
  from public.class_sessions cs
  where cs.studio_id = p_studio_id and cs.id = any(coalesce(p_session_ids, '{}'::uuid[]));
$$;
revoke all on function public.service_session_booking_windows(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.service_session_booking_windows(uuid, uuid[]) to service_role;

-- 6 · Guardar las reglas (Configuración › Reservas y la ficha de cada actividad) -----------------

create or replace function public.owner_update_studio_booking_windows(
  p_studio_id uuid,
  p_booking_close_minutes_before integer,
  p_booking_open_mode text,
  p_booking_open_minutes_before integer,
  p_booking_open_weekday smallint,
  p_booking_open_time time,
  p_checkin_opens_minutes_before integer,
  p_checkin_closes_minutes_after integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_capability(p_studio_id, 'settings.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_booking_open_mode not in ('none', 'relative', 'weekly') then
    raise exception 'booking_open_mode_invalid' using errcode = '22023';
  end if;

  insert into public.studio_operating_policies (studio_id) values (p_studio_id)
  on conflict (studio_id) do nothing;

  update public.studio_operating_policies set
    booking_close_minutes_before = p_booking_close_minutes_before,
    booking_open_mode = p_booking_open_mode,
    booking_open_minutes_before = case when p_booking_open_mode = 'relative' then p_booking_open_minutes_before end,
    booking_open_weekday = case when p_booking_open_mode = 'weekly' then p_booking_open_weekday end,
    booking_open_time = case when p_booking_open_mode = 'weekly' then p_booking_open_time end,
    checkin_opens_minutes_before = p_checkin_opens_minutes_before,
    checkin_closes_minutes_after = p_checkin_closes_minutes_after,
    updated_by_user_id = (select auth.uid()),
    updated_at = now()
  where studio_id = p_studio_id;
end;
$$;
revoke all on function public.owner_update_studio_booking_windows(uuid, integer, text, integer, smallint, time, integer, integer) from public, anon;
grant execute on function public.owner_update_studio_booking_windows(uuid, integer, text, integer, smallint, time, integer, integer) to authenticated;

-- Reglas propias de una actividad; null en un campo = usa la del estudio.
create or replace function public.admin_update_activity_booking_rules(
  p_template_id uuid,
  p_cancellation_cutoff_minutes integer,
  p_booking_close_minutes_before integer,
  p_booking_open_mode text,
  p_booking_open_minutes_before integer,
  p_booking_open_weekday smallint,
  p_booking_open_time time,
  p_checkin_opens_minutes_before integer,
  p_checkin_closes_minutes_after integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio uuid;
begin
  select studio_id into v_studio from public.class_templates where id = p_template_id;
  if v_studio is null then raise exception 'activity_not_found'; end if;
  if not private.has_capability(v_studio, 'schedule.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_booking_open_mode is not null and p_booking_open_mode not in ('none', 'relative', 'weekly') then
    raise exception 'booking_open_mode_invalid' using errcode = '22023';
  end if;

  update public.class_templates set
    cancellation_cutoff_minutes = p_cancellation_cutoff_minutes,
    booking_close_minutes_before = p_booking_close_minutes_before,
    booking_open_mode = p_booking_open_mode,
    booking_open_minutes_before = case when p_booking_open_mode = 'relative' then p_booking_open_minutes_before end,
    booking_open_weekday = case when p_booking_open_mode = 'weekly' then p_booking_open_weekday end,
    booking_open_time = case when p_booking_open_mode = 'weekly' then p_booking_open_time end,
    checkin_opens_minutes_before = p_checkin_opens_minutes_before,
    checkin_closes_minutes_after = p_checkin_closes_minutes_after
  where id = p_template_id;
end;
$$;
revoke all on function public.admin_update_activity_booking_rules(uuid, integer, integer, text, integer, smallint, time, integer, integer) from public, anon;
grant execute on function public.admin_update_activity_booking_rules(uuid, integer, integer, text, integer, smallint, time, integer, integer) to authenticated;

-- 7 · Aplicar las reglas en las funciones que hoy tienen tiempos fijos ----------------------------
-- Se modifican las definiciones vigentes en la base (pg_get_functiondef) porque varias ya fueron
-- ajustadas en caliente por migraciones anteriores. Si una no tiene el texto esperado, la
-- migración se detiene para que Codex lo revise. Si la función no existe (base de pruebas local),
-- se omite.

create or replace function pg_temp.neb_patch(p_signature text, p_pattern text, p_replacement text, p_label text)
returns void
language plpgsql
as $$
declare
  v_def text;
  v_new text;
begin
  if to_regprocedure(p_signature) is null then
    raise notice 'NEB-01: % no existe en esta base; se omite (%)', p_signature, p_label;
    return;
  end if;
  v_def := pg_get_functiondef(p_signature::regprocedure);
  v_new := regexp_replace(v_def, p_pattern, p_replacement, 'g');
  if v_new = v_def then
    raise exception 'NEB-01: definición inesperada de % (%)', p_signature, p_label;
  end if;
  execute v_new;
end;
$$;

-- 7a · Cancelación: usa el tiempo de la actividad.
select pg_temp.neb_patch(sig,
  'private\.reservation_cancellation_outcome\(\s*[a-z_.]+\s*,\s*(v_session|v_old_session)\.starts_at\s*\)',
  'private.reservation_cancellation_outcome_for_session(\1.id)',
  'cancelación por actividad')
from unnest(array[
  'public.cancel_reservation(uuid,text)',
  'public.service_cancel_reservation(uuid,uuid,uuid,text)',
  'public.student_cancel_guest_invitation(uuid)',
  'public.student_cancellation_preview(uuid)',
  'public.service_apply_asistian_booking_event(uuid,uuid,text,text,text,timestamp with time zone,text)'
]) as sig;

-- 7b · Registro con QR: ventana del estudio o de la actividad (antes 20 min antes / 30 después).
select pg_temp.neb_patch(sig,
  'v_session\.starts_at\s*-\s*interval\s*''20 minutes''',
  'private.session_checkin_opens_at(v_session.id)',
  'apertura de registro')
from unnest(array['public.check_in_reservation(text)', 'public.student_reservation_checkin_token(uuid)']) as sig;
select pg_temp.neb_patch(sig,
  'v_session\.starts_at\s*\+\s*interval\s*''30 minutes''',
  'private.session_checkin_closes_at(v_session.id)',
  'cierre de registro')
from unnest(array['public.check_in_reservation(text)', 'public.student_reservation_checkin_token(uuid)']) as sig;

-- 7c · Demi: en lugar de "30 minutos antes" fijos, la ventana de reserva de la clase.
select pg_temp.neb_patch(sig,
  '([a-z_]+\.)?starts_at\s*<=\s*clock_timestamp\(\)\s*\+\s*interval\s*''30 minutes''',
  'not private.session_booking_open_now(\1id)',
  'Demi: cierre de reservas')
from unnest(array[
  'public.service_prepare_demi_group(uuid,uuid,uuid,integer,integer)',
  'public.service_prepare_demi_prospect_payment(uuid,uuid,uuid,uuid,uuid)'
]) as sig;
select pg_temp.neb_patch(sig,
  '([a-z_]+\.)?starts_at\s*>\s*clock_timestamp\(\)\s*\+\s*interval\s*''30 minutes''',
  'private.session_booking_open_now(\1id)',
  'Demi: cierre de reservas')
from unnest(array[
  'public.service_complete_demi_group(uuid,uuid,uuid,jsonb)',
  'public.service_prepare_demi_mercadopago(uuid,uuid,uuid)'
]) as sig;

-- 7d · Reservas que llegan desde Asistian ya existen allá: no se frenan.
select pg_temp.neb_patch(
  'public.service_apply_asistian_booking_event(uuid,uuid,text,text,text,timestamp with time zone,text)',
  '\nbegin\n',
  E'\nbegin\n  perform set_config(''nebora.booking_window_bypass'', ''on'', true);\n',
  'Asistian sin ventana');

-- 8 · Elegibilidad: la app de la alumna ve "Abre el …" o "Reservas cerradas" ---------------------

select pg_temp.neb_patch('public.booking_eligibility(uuid,uuid)',
  'return private\.booking_eligibility_core\(target_session_id,\s*target_student_id,\s*false\);',
  'return private.neb_booking_window_overlay(target_session_id, private.booking_eligibility_core(target_session_id,target_student_id,false));',
  'elegibilidad con ventana (programas)');
select pg_temp.neb_patch('public.booking_eligibility(uuid,uuid)',
  'return private\.booking_eligibility_regular_program_baseline\(target_session_id,\s*target_student_id\);',
  'return private.neb_booking_window_overlay(target_session_id, private.booking_eligibility_regular_program_baseline(target_session_id,target_student_id));',
  'elegibilidad con ventana');
select pg_temp.neb_patch('public.service_booking_eligibility(uuid,uuid,uuid)',
  'return private\.booking_eligibility_core\(\s*target_session_id,\s*target_student_id,\s*false\s*\);',
  'return private.neb_booking_window_overlay(target_session_id, private.booking_eligibility_core(target_session_id, target_student_id, false));',
  'Demi: elegibilidad con ventana');
