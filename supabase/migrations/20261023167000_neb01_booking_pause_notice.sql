-- NEB-01-43 · Aviso a la alumna cuando se pausan sus reservas (pendiente de NEB-01-41).
-- Al crearse una pausa se emite student.booking_paused; la regla operations.booking_paused (APAGADA)
-- avisa por la bandeja de la app y push. WhatsApp queda para cuando haya plantilla aprobada.

create or replace function private.neb_emit_booking_paused()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  select coalesce(nullif(timezone, ''), 'America/Mexico_City') into v_tz from public.studios where id = new.studio_id;
  perform private.notification_try_emit_domain_event(
    new.studio_id, 'student.booking_paused', 'student_booking_penalty', new.id,
    'student.booking_paused:' || new.id::text,
    jsonb_build_object(
      'student_id', new.student_id,
      'penalty_id', new.id,
      'kind', new.kind,
      'kind_label', case when new.kind = 'no_show' then 'faltas' else 'cancelaciones tardías' end,
      'ends_at', new.ends_at,
      'ends_on', to_char(new.ends_at at time zone coalesce(v_tz, 'America/Mexico_City'), 'DD/MM/YYYY HH24:MI')),
    null, clock_timestamp());
  return new;
end;
$$;
revoke all on function private.neb_emit_booking_paused() from public, anon, authenticated;

drop trigger if exists neb_emit_booking_paused on public.student_booking_penalties;
create trigger neb_emit_booking_paused after insert on public.student_booking_penalties
  for each row execute function private.neb_emit_booking_paused();

create or replace function private.seed_booking_paused_notification_rule(p_studio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.notification_rules%rowtype;
begin
  insert into public.notification_rules (studio_id, rule_key, event_type, enabled, current_version_number)
  values (p_studio_id, 'operations.booking_paused', 'student.booking_paused', false, 1)
  on conflict (studio_id, rule_key) do nothing;
  select * into r from public.notification_rules
  where studio_id = p_studio_id and rule_key = 'operations.booking_paused' for update;
  if r.archived_at is not null then return; end if;
  if exists (select 1 from public.notification_rule_versions v where v.rule_id = r.id and v.version_number = r.current_version_number) then
    return;
  end if;
  insert into public.notification_rule_versions (studio_id, rule_id, version_number, notification_type, communication_class,
    priority, recipient_strategy_key, conditions, timing_strategy_key, timing_config, revalidation_strategy_key,
    template_key, expires_after_seconds, activated_at)
  values (p_studio_id, r.id, r.current_version_number, 'booking_paused', 'P0', 'normal', 'payload_student', '{}'::jsonb,
    'immediate', '{}'::jsonb, null, 'booking_paused', 86400, clock_timestamp());
  insert into public.notification_rule_channels (studio_id, rule_id, version_number, channel_key, is_required, ordinal, channel_policy)
  values
    (p_studio_id, r.id, r.current_version_number, 'inbox', true, 1, jsonb_build_object(
      'url', '/student/reservar',
      'title_template', 'Tus reservas están en pausa',
      'body_template', 'Por {{kind_label}} recientes, tus reservas quedaron en pausa hasta el {{ends_on}}. Si crees que es un error, escríbenos.',
      'delivery_max_attempts', 3)),
    (p_studio_id, r.id, r.current_version_number, 'push', false, 0, jsonb_build_object(
      'url', '/student/reservar',
      'title_template', 'Tus reservas están en pausa',
      'body_template', 'Por {{kind_label}} recientes, podrás reservar de nuevo el {{ends_on}}.',
      'delivery_max_attempts', 3));
end;
$$;
revoke all on function private.seed_booking_paused_notification_rule(uuid) from public, anon, authenticated, service_role;

create or replace function private.seed_booking_paused_notification_rule_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_booking_paused_notification_rule(new.id);
  return new;
end;
$$;
revoke all on function private.seed_booking_paused_notification_rule_trigger() from public, anon, authenticated, service_role;

drop trigger if exists zzz_studios_seed_booking_paused_notification on public.studios;
create trigger zzz_studios_seed_booking_paused_notification after insert on public.studios
  for each row execute function private.seed_booking_paused_notification_rule_trigger();

do $seed$
declare
  s record;
begin
  for s in select id from public.studios loop
    perform private.seed_booking_paused_notification_rule(s.id);
  end loop;
end
$seed$;
