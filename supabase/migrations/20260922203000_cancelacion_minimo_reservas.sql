-- CANCELACION-MIN-01 · Cancelación automática por mínimo de reservas.
-- Reglas aprobadas:
-- - aforo = ocupados / capacidad total
-- - una sola revisión por sesión
-- - si no se alcanza el mínimo, se cancela solo la sesión
-- - las reservas se cancelan por el estudio, se liberan créditos/recursos
-- - la sesión puede tener la excepción "Impartir aunque no alcance el mínimo"
-- - se emiten eventos de dominio para trazabilidad y notificaciones

alter table public.class_templates
  add column if not exists minimum_reservations_enabled boolean not null default false,
  add column if not exists minimum_reservations integer not null default 2,
  add column if not exists minimum_review_minutes_before integer not null default 120,
  add column if not exists allow_minimum_reservation_override boolean not null default true;

alter table public.class_templates
  drop constraint if exists class_templates_minimum_reservations_check,
  add constraint class_templates_minimum_reservations_check
    check (minimum_reservations >= 1),
  drop constraint if exists class_templates_minimum_review_minutes_check,
  add constraint class_templates_minimum_review_minutes_check
    check (minimum_review_minutes_before between 15 and 10080);

alter table public.class_sessions
  add column if not exists minimum_reservations_enabled boolean not null default false,
  add column if not exists minimum_reservations integer not null default 2,
  add column if not exists minimum_review_minutes_before integer not null default 120,
  add column if not exists minimum_override_allowed boolean not null default true,
  add column if not exists minimum_override boolean not null default false,
  add column if not exists minimum_review_status text not null default 'not_required',
  add column if not exists minimum_review_at timestamptz,
  add column if not exists minimum_reviewed_at timestamptz,
  add column if not exists minimum_reservations_at_review integer,
  add column if not exists minimum_cancelled_at timestamptz,
  add column if not exists minimum_cancelled_reservations integer,
  add column if not exists minimum_credits_returned integer,
  add column if not exists minimum_overridden_at timestamptz,
  add column if not exists minimum_overridden_by uuid references auth.users(id) on delete set null;

alter table public.class_sessions
  drop constraint if exists class_sessions_minimum_reservations_check,
  add constraint class_sessions_minimum_reservations_check
    check (minimum_reservations >= 1),
  drop constraint if exists class_sessions_minimum_review_minutes_check,
  add constraint class_sessions_minimum_review_minutes_check
    check (minimum_review_minutes_before between 15 and 10080),
  drop constraint if exists class_sessions_minimum_review_status_check,
  add constraint class_sessions_minimum_review_status_check
    check (minimum_review_status in ('not_required','pending','met','cancelled','overridden')),
  drop constraint if exists class_sessions_minimum_review_count_check,
  add constraint class_sessions_minimum_review_count_check
    check (minimum_reservations_at_review is null or minimum_reservations_at_review >= 0),
  drop constraint if exists class_sessions_minimum_cancelled_count_check,
  add constraint class_sessions_minimum_cancelled_count_check
    check (minimum_cancelled_reservations is null or minimum_cancelled_reservations >= 0),
  drop constraint if exists class_sessions_minimum_credits_returned_check,
  add constraint class_sessions_minimum_credits_returned_check
    check (minimum_credits_returned is null or minimum_credits_returned >= 0);

create index if not exists class_sessions_minimum_review_due_idx
  on public.class_sessions(minimum_review_at, studio_id)
  where status = 'scheduled'
    and minimum_reservations_enabled
    and not minimum_override
    and minimum_review_status = 'pending';

create or replace function private.minimum_reservation_prepare_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.class_templates%rowtype;
  v_reset boolean := false;
begin
  if tg_op = 'INSERT'
     or new.template_id is distinct from old.template_id then
    select *
      into v_template
    from public.class_templates
    where id = new.template_id
      and studio_id = new.studio_id;

    if not found then
      raise exception 'activity_not_found';
    end if;

    new.minimum_reservations_enabled := v_template.minimum_reservations_enabled;
    new.minimum_reservations := v_template.minimum_reservations;
    new.minimum_review_minutes_before := v_template.minimum_review_minutes_before;
    new.minimum_override_allowed := v_template.allow_minimum_reservation_override;

    if tg_op = 'INSERT' then
      new.minimum_override := false;
      new.minimum_overridden_at := null;
      new.minimum_overridden_by := null;
    end if;
  end if;

  if not new.minimum_reservations_enabled then
    new.minimum_override := false;
    new.minimum_review_status := 'not_required';
    new.minimum_review_at := null;
    new.minimum_reviewed_at := null;
    new.minimum_reservations_at_review := null;
    new.minimum_cancelled_at := null;
    new.minimum_cancelled_reservations := null;
    new.minimum_credits_returned := null;
    new.minimum_overridden_at := null;
    new.minimum_overridden_by := null;
    return new;
  end if;

  new.minimum_review_at :=
    new.starts_at - make_interval(mins => new.minimum_review_minutes_before);

  if new.minimum_override and not new.minimum_override_allowed then
    new.minimum_override := false;
    new.minimum_overridden_at := null;
    new.minimum_overridden_by := null;
  end if;

  if tg_op = 'INSERT' then
    v_reset := true;
  else
    v_reset :=
      new.starts_at is distinct from old.starts_at
      or new.template_id is distinct from old.template_id
      or new.minimum_reservations_enabled is distinct from old.minimum_reservations_enabled
      or new.minimum_reservations is distinct from old.minimum_reservations
      or new.minimum_review_minutes_before is distinct from old.minimum_review_minutes_before
      or new.minimum_override_allowed is distinct from old.minimum_override_allowed
      or (old.minimum_override and not new.minimum_override);
  end if;

  if new.minimum_override then
    new.minimum_review_status := 'overridden';
    new.minimum_reviewed_at := null;
    new.minimum_reservations_at_review := null;
    new.minimum_cancelled_at := null;
    new.minimum_cancelled_reservations := null;
    new.minimum_credits_returned := null;
  elsif v_reset then
    new.minimum_review_status := 'pending';
    new.minimum_reviewed_at := null;
    new.minimum_reservations_at_review := null;
    new.minimum_cancelled_at := null;
    new.minimum_cancelled_reservations := null;
    new.minimum_credits_returned := null;
  end if;

  return new;
end;
$$;

revoke all on function private.minimum_reservation_prepare_session()
from public, anon, authenticated, service_role;

drop trigger if exists minimum_reservation_prepare_session on public.class_sessions;
create trigger minimum_reservation_prepare_session
before insert or update of
  starts_at,
  template_id,
  minimum_reservations_enabled,
  minimum_reservations,
  minimum_review_minutes_before,
  minimum_override_allowed,
  minimum_override
on public.class_sessions
for each row
execute function private.minimum_reservation_prepare_session();

create or replace function private.cancel_session_reservations_internal(
  target_session_id uuid,
  target_reason text default null,
  target_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_reservation record;
  v_credit_cost integer;
  v_count integer := 0;
  v_credits_returned integer := 0;
  v_inserted integer := 0;
begin
  select *
    into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  for v_reservation in
    select r.id, r.acquisition_id, r.credits_held, pa.unlimited
    from public.reservations r
    left join public.product_acquisitions pa on pa.id = r.acquisition_id
    where r.session_id = target_session_id
      and r.status = 'reserved'
    for update of r
  loop
    v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);

    update public.reservations
    set status = 'cancelled_by_studio',
        cancelled_at = clock_timestamp(),
        cancellation_reason = coalesce(
          nullif(trim(target_reason), ''),
          'Clase cancelada por el estudio'
        ),
        cancelled_by = target_actor_user_id,
        updated_at = clock_timestamp()
    where id = v_reservation.id;

    if v_reservation.acquisition_id is not null
       and not coalesce(v_reservation.unlimited, false) then
      insert into public.credit_ledger (
        studio_id,
        acquisition_id,
        movement_type,
        quantity,
        reservation_id,
        note,
        created_by
      )
      values (
        v_session.studio_id,
        v_reservation.acquisition_id,
        'release',
        v_credit_cost,
        v_reservation.id,
        format('%s crédito(s) devueltos por cancelación del estudio', v_credit_cost),
        target_actor_user_id
      )
      on conflict (reservation_id, movement_type) do nothing;

      get diagnostics v_inserted = row_count;
      if v_inserted = 1 then
        v_credits_returned := v_credits_returned + v_credit_cost;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  update public.class_waitlist_entries
  set status = 'expired',
      resolved_at = coalesce(resolved_at, clock_timestamp()),
      resolution_reason = coalesce(resolution_reason, 'session_cancelled_by_studio'),
      updated_at = clock_timestamp()
  where session_id = target_session_id
    and studio_id = v_session.studio_id
    and status = 'active';

  return jsonb_build_object(
    'reservations_cancelled', v_count,
    'credits_returned', v_credits_returned
  );
end;
$$;

revoke all on function private.cancel_session_reservations_internal(uuid,text,uuid)
from public, anon, authenticated, service_role;

create or replace function public.cancel_session_reservations(
  target_session_id uuid,
  target_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_result jsonb;
begin
  select *
    into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_session.studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  v_result := private.cancel_session_reservations_internal(
    target_session_id,
    target_reason,
    (select auth.uid())
  );

  return coalesce((v_result->>'reservations_cancelled')::integer, 0);
end;
$$;

revoke all on function public.cancel_session_reservations(uuid,text)
from public, anon;
grant execute on function public.cancel_session_reservations(uuid,text)
to authenticated;

create or replace function public.handle_session_cancelled_reservations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from new.status then
    perform private.cancel_session_reservations_internal(
      new.id,
      case
        when new.minimum_review_status = 'cancelled'
          then 'Clase cancelada automáticamente: mínimo de reservas no alcanzado'
        else 'Clase cancelada por el estudio'
      end,
      (select auth.uid())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists class_session_cancel_reservations on public.class_sessions;
create trigger class_session_cancel_reservations
after update of status on public.class_sessions
for each row
execute function public.handle_session_cancelled_reservations();

create or replace function private.process_due_minimum_reservation_sessions(
  p_studio_id uuid default null,
  p_session_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.class_sessions%rowtype;
  v_reserved_count integer;
  v_credits_to_return integer;
  v_processed integer := 0;
  v_reason text := 'Clase cancelada automáticamente: mínimo de reservas no alcanzado';
begin
  for v_session in
    select cs.*
    from public.class_sessions cs
    where cs.status = 'scheduled'
      and cs.minimum_reservations_enabled
      and not cs.minimum_override
      and cs.minimum_review_status = 'pending'
      and cs.minimum_review_at is not null
      and cs.minimum_review_at <= v_now
      and cs.starts_at > v_now
      and (p_studio_id is null or cs.studio_id = p_studio_id)
      and (p_session_id is null or cs.id = p_session_id)
    order by cs.minimum_review_at, cs.id
    for update skip locked
  loop
    select
      count(*)::integer,
      coalesce(sum(
        case
          when r.acquisition_id is null or coalesce(pa.unlimited, false) then 0
          else greatest(coalesce(r.credits_held, 1), 1)
        end
      ), 0)::integer
      into v_reserved_count, v_credits_to_return
    from public.reservations r
    left join public.product_acquisitions pa on pa.id = r.acquisition_id
    where r.session_id = v_session.id
      and r.status = 'reserved';

    if v_reserved_count >= v_session.minimum_reservations then
      update public.class_sessions
      set minimum_review_status = 'met',
          minimum_reviewed_at = v_now,
          minimum_reservations_at_review = v_reserved_count
      where id = v_session.id;

      perform public.emit_domain_event(
        v_session.studio_id,
        'session.minimum_reviewed',
        'class_session',
        v_session.id,
        'session.minimum_reviewed:' || v_session.id::text,
        v_now,
        null,
        jsonb_build_object(
          'session_id', v_session.id,
          'minimum_required', v_session.minimum_reservations,
          'reservations_at_review', v_reserved_count,
          'reviewed_at', v_now,
          'outcome', 'met'
        ),
        null,
        null,
        null
      );
    else
      update public.class_sessions
      set status = 'cancelled',
          minimum_review_status = 'cancelled',
          minimum_reviewed_at = v_now,
          minimum_reservations_at_review = v_reserved_count,
          minimum_cancelled_at = v_now,
          minimum_cancelled_reservations = v_reserved_count,
          minimum_credits_returned = v_credits_to_return
      where id = v_session.id;

      perform public.emit_domain_event(
        v_session.studio_id,
        'session.minimum_cancelled',
        'class_session',
        v_session.id,
        'session.minimum_cancelled:' || v_session.id::text,
        v_now,
        null,
        jsonb_build_object(
          'session_id', v_session.id,
          'activity_id', v_session.template_id,
          'instructor_id', v_session.instructor_id,
          'starts_at', v_session.starts_at,
          'minimum_required', v_session.minimum_reservations,
          'reservations_at_review', v_reserved_count,
          'reservations_cancelled', v_reserved_count,
          'credits_returned', v_credits_to_return,
          'reason', v_reason,
          'cancelled_at', v_now
        ),
        null,
        null,
        null
      );
    end if;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function private.process_due_minimum_reservation_sessions(uuid,uuid)
from public, anon, authenticated, service_role;


create or replace function public.admin_process_session_minimum_review(
  target_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_session.studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  perform private.process_due_minimum_reservation_sessions(
    v_session.studio_id,
    v_session.id
  );

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status::text,
    'minimum_review_status', v_session.minimum_review_status,
    'minimum_review_at', v_session.minimum_review_at,
    'minimum_reviewed_at', v_session.minimum_reviewed_at
  );
end;
$$;

revoke all on function public.admin_process_session_minimum_review(uuid)
from public, anon;
grant execute on function public.admin_process_session_minimum_review(uuid)
to authenticated;

create or replace function public.admin_set_session_minimum_override(
  target_session_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_session.studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  if v_session.status <> 'scheduled' then
    raise exception 'session_not_scheduled';
  end if;

  if not v_session.minimum_reservations_enabled then
    raise exception 'minimum_rule_disabled';
  end if;

  if p_enabled and not v_session.minimum_override_allowed then
    raise exception 'minimum_override_not_allowed';
  end if;

  if p_enabled and v_session.minimum_review_status = 'met' then
    raise exception 'minimum_review_already_completed';
  end if;

  update public.class_sessions
  set minimum_override = p_enabled,
      minimum_overridden_at = case when p_enabled then clock_timestamp() else null end,
      minimum_overridden_by = case when p_enabled then (select auth.uid()) else null end
  where id = v_session.id;

  perform public.emit_domain_event(
    v_session.studio_id,
    case when p_enabled then 'session.minimum_override_enabled' else 'session.minimum_override_disabled' end,
    'class_session',
    v_session.id,
    'session.minimum_override:' || v_session.id::text || ':' || p_enabled::text || ':' || extract(epoch from clock_timestamp())::bigint::text,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'session_id', v_session.id,
      'enabled', p_enabled,
      'minimum_required', v_session.minimum_reservations,
      'review_at', v_session.minimum_review_at
    ),
    null,
    null,
    null
  );

  if not p_enabled then
    perform private.process_due_minimum_reservation_sessions(
      v_session.studio_id,
      v_session.id
    );
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  return jsonb_build_object(
    'session_id', v_session.id,
    'minimum_override', v_session.minimum_override,
    'minimum_review_status', v_session.minimum_review_status,
    'minimum_review_at', v_session.minimum_review_at
  );
end;
$$;

revoke all on function public.admin_set_session_minimum_override(uuid,boolean)
from public, anon;
grant execute on function public.admin_set_session_minimum_override(uuid,boolean)
to authenticated;

create or replace function public.admin_save_activity(
  p_studio_id uuid,
  p_activity_id uuid,
  p_name text,
  p_description text,
  p_duration_minutes integer,
  p_capacity integer,
  p_color_hex text,
  p_requires_resource boolean,
  p_drop_in_price_minor integer,
  p_individual_purchase_notes text,
  p_default_instructor_id uuid,
  p_default_space_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_schedules jsonb,
  p_minimum_reservations_enabled boolean,
  p_minimum_reservations integer,
  p_minimum_review_minutes_before integer,
  p_allow_minimum_reservation_override boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not private.has_capability(p_studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  if coalesce(p_minimum_reservations_enabled, false) and (
    p_minimum_reservations is null
    or p_minimum_reservations < 1
    or p_minimum_reservations > p_capacity
    or p_minimum_review_minutes_before is null
    or p_minimum_review_minutes_before < 15
    or p_minimum_review_minutes_before > 10080
  ) then
    raise exception 'invalid_minimum_reservation_rule';
  end if;

  v_activity_id := public.admin_save_activity(
    p_studio_id,
    p_activity_id,
    p_name,
    p_description,
    p_duration_minutes,
    p_capacity,
    p_color_hex,
    p_requires_resource,
    p_drop_in_price_minor,
    p_individual_purchase_notes,
    p_default_instructor_id,
    p_default_space_id,
    p_starts_on,
    p_ends_on,
    p_schedules
  );

  update public.class_templates
  set minimum_reservations_enabled = coalesce(p_minimum_reservations_enabled, false),
      minimum_reservations = greatest(coalesce(p_minimum_reservations, 2), 1),
      minimum_review_minutes_before = greatest(
        coalesce(p_minimum_review_minutes_before, 120),
        15
      ),
      allow_minimum_reservation_override = coalesce(
        p_allow_minimum_reservation_override,
        true
      )
  where id = v_activity_id
    and studio_id = p_studio_id;

  update public.class_sessions cs
  set minimum_reservations_enabled = coalesce(p_minimum_reservations_enabled, false),
      minimum_reservations = greatest(coalesce(p_minimum_reservations, 2), 1),
      minimum_review_minutes_before = greatest(
        coalesce(p_minimum_review_minutes_before, 120),
        15
      ),
      minimum_override_allowed = coalesce(
        p_allow_minimum_reservation_override,
        true
      )
  where cs.studio_id = p_studio_id
    and cs.template_id = v_activity_id
    and cs.status = 'scheduled'
    and cs.starts_at > clock_timestamp()
    and cs.minimum_review_status not in ('met','cancelled');

  perform private.process_due_minimum_reservation_sessions(
    p_studio_id,
    null
  );

  return v_activity_id;
end;
$$;

revoke all on function public.admin_save_activity(
  uuid,uuid,text,text,integer,integer,text,boolean,integer,text,uuid,uuid,date,date,jsonb,
  boolean,integer,integer,boolean
) from public, anon;
grant execute on function public.admin_save_activity(
  uuid,uuid,text,text,integer,integer,text,boolean,integer,text,uuid,uuid,date,date,jsonb,
  boolean,integer,integer,boolean
) to authenticated;

-- Asistian: nuevo tipo de mensaje para el coach asignado.
create or replace function public.admin_set_asistian_webhook(
  target_studio_id uuid,
  target_template text,
  target_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text := trim(coalesce(target_template, ''));
  v_url text := trim(coalesce(target_url, ''));
  v_secret_name text;
  v_secret_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_template not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder',
    'class_cancelled_coach'
  ) then
    raise exception 'template_not_allowed';
  end if;

  if v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'url_invalid';
  end if;

  v_secret_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;

  select s.id
    into v_secret_id
  from vault.secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_url,
      v_secret_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_url,
      v_secret_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_asistian_webhook(uuid,text,text)
from public, anon, service_role;
grant execute on function public.admin_set_asistian_webhook(uuid,text,text)
to authenticated;

create or replace function public.service_get_asistian_webhook(
  target_studio_id uuid,
  target_template text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text := trim(coalesce(target_template, ''));
  v_secret_name text;
  v_url text;
begin
  if v_template not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder',
    'class_cancelled_coach'
  ) then
    return null;
  end if;

  v_secret_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;

  select s.decrypted_secret
    into v_url
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  return v_url;
end;
$$;

revoke all on function public.service_get_asistian_webhook(uuid,text)
from public, anon, authenticated;
grant execute on function public.service_get_asistian_webhook(uuid,text)
to service_role;

create or replace function private.dispatch_session_minimum_cancelled_event_id(
  p_event_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_dispatch_token text;
  v_request_id bigint;
begin
  select s.decrypted_secret
    into v_project_url
  from vault.decrypted_secrets s
  where s.name = 'studio_flow_project_url'
  limit 1;

  select s.decrypted_secret
    into v_dispatch_token
  from vault.decrypted_secrets s
  where s.name = 'studio_flow_automation_dispatch_token'
  limit 1;

  if nullif(trim(coalesce(v_project_url, '')), '') is null
     or nullif(trim(coalesce(v_dispatch_token, '')), '') is null then
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/process-session-minimum-cancelled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-studio-flow-dispatch-token', v_dispatch_token
    ),
    body := jsonb_build_object('eventId', p_event_id),
    timeout_milliseconds := 5000
  )
  into v_request_id;

  return v_request_id;
exception
  when others then
    return null;
end;
$$;

create or replace function private.dispatch_session_minimum_cancelled_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_session_minimum_cancelled_event_id(new.event_id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists minimum_reservation_cancelled_dispatch on public.domain_events;
create trigger minimum_reservation_cancelled_dispatch
after insert on public.domain_events
for each row
when (new.event_type = 'session.minimum_cancelled')
execute function private.dispatch_session_minimum_cancelled_event();

do $$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
  from cron.job
  where jobname = 'studio_flow_minimum_reservation_review'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'studio_flow_minimum_reservation_review',
    '* * * * *',
    'select private.process_due_minimum_reservation_sessions();'
  );
end;
$$;

comment on column public.class_templates.minimum_reservations_enabled is
  'CANCELACION-MIN-01 enables one automatic minimum-reservation review per session.';
comment on column public.class_sessions.minimum_review_status is
  'CANCELACION-MIN-01 snapshot state: not_required, pending, met, cancelled or overridden.';
comment on function private.process_due_minimum_reservation_sessions(uuid,uuid) is
  'CANCELACION-MIN-01 evaluates due sessions once and cancels only the session when the minimum is not met.';
