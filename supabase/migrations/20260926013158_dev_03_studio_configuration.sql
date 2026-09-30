-- DEV-03 · Configuración por estudio
-- Política operativa, branding y configuración regional por tenant.

create table if not exists public.studio_operating_policies (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  cancellation_cutoff_minutes integer not null default 300,
  late_cancellation_consumes_credit boolean not null default true,
  no_show_consumes_credit boolean not null default true,
  updated_by_user_id uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint studio_operating_policies_cutoff_check
    check (cancellation_cutoff_minutes between 0 and 10080)
);

alter table public.studio_operating_policies enable row level security;

grant select, update on public.studio_operating_policies to authenticated;
revoke all on public.studio_operating_policies from anon;

drop policy if exists studio_operating_policies_select on public.studio_operating_policies;
create policy studio_operating_policies_select
on public.studio_operating_policies
for select
to authenticated
using (private.has_capability(studio_id,'settings.write'));

drop policy if exists studio_operating_policies_update on public.studio_operating_policies;
create policy studio_operating_policies_update
on public.studio_operating_policies
for update
to authenticated
using (private.has_capability(studio_id,'settings.write'))
with check (private.has_capability(studio_id,'settings.write'));

insert into public.studio_operating_policies(studio_id)
select id from public.studios
on conflict(studio_id) do nothing;

alter table public.studios
  add column if not exists tagline text null;

alter table public.studios
  drop constraint if exists studios_tagline_length_chk,
  add constraint studios_tagline_length_chk
    check (tagline is null or length(tagline) <= 120);

update public.studios
set tagline='Movimiento que transforma'
where id='9fe23cfa-fb47-4670-afeb-ed4a56433772'
  and nullif(trim(coalesce(tagline,'')),'') is null;

drop trigger if exists seed_studio_operating_policy on public.studios;
drop function if exists private.reservation_cancellation_outcome(timestamptz);
drop function if exists public.get_public_studio_portal(text);

CREATE OR REPLACE FUNCTION private.finalize_attendance_core(target_session_id uuid, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_reservation record;
  v_credit_cost integer;
  v_attended integer := 0;
  v_no_show integer := 0;
begin
  -- El orden de locks coincide con check_in_reservation: sesión -> reservas.
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if v_session.status = 'cancelled' then
    raise exception 'session_cancelled';
  end if;

  if v_session.status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'already_finalized', true,
      'session_id', v_session.id
    );
  end if;

  if now() < v_session.ends_at then
    raise exception 'session_not_ended';
  end if;

  update public.reservations
  set status = 'no_show',
      updated_at = clock_timestamp()
  where session_id = target_session_id
    and status = 'reserved';

  for v_reservation in
    select
      r.id,
      r.studio_id,
      r.acquisition_id,
      r.status,
      r.credits_held,
      pa.unlimited
    from public.reservations r
    left join public.product_acquisitions pa
      on pa.id = r.acquisition_id
    where r.session_id = target_session_id
      and r.status in ('attended', 'no_show')
    for update of r
  loop
    v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);

    if v_reservation.status = 'attended' then
      v_attended := v_attended + 1;
    else
      v_no_show := v_no_show + 1;
    end if;

    if v_reservation.acquisition_id is not null
       and not coalesce(v_reservation.unlimited, false) then
      if exists (
        select 1
        from public.credit_ledger cl
        where cl.reservation_id = v_reservation.id
          and cl.movement_type = 'reserve'
      ) then
        insert into public.credit_ledger(
          studio_id,
          acquisition_id,
          movement_type,
          quantity,
          reservation_id,
          note,
          created_by
        )
        values (
          v_reservation.studio_id,
          v_reservation.acquisition_id,
          'release',
          v_credit_cost,
          v_reservation.id,
          format(
            'Cierre automático del hold de %s crédito(s) al finalizar asistencia',
            v_credit_cost
          ),
          p_actor_user_id
        )
        on conflict (reservation_id, movement_type) do nothing;
      end if;

      if private.reservation_credit_should_consume(
        v_reservation.studio_id,
        v_reservation.status
      ) then
        insert into public.credit_ledger(
          studio_id,
          acquisition_id,
          movement_type,
          quantity,
          reservation_id,
          note,
          created_by
        )
        values (
          v_reservation.studio_id,
          v_reservation.acquisition_id,
          'consume',
          -v_credit_cost,
          v_reservation.id,
          case
            when v_reservation.status = 'attended'
              then format('%s crédito(s) consumidos por asistencia', v_credit_cost)
            else format('%s crédito(s) consumidos por no-show', v_credit_cost)
          end,
          p_actor_user_id
        )
        on conflict (reservation_id, movement_type) do nothing;
      end if;
    end if;

    if v_reservation.acquisition_id is not null
       and private.reservation_credit_should_consume(
         v_reservation.studio_id,
         v_reservation.status
       ) then
      perform private.activate_acquisition_on_first_usage(
        v_reservation.acquisition_id,
        v_reservation.id
      );
    end if;
  end loop;

  update public.class_sessions
  set status = 'completed'
  where id = target_session_id
    and status = 'scheduled';

  return jsonb_build_object(
    'ok', true,
    'already_finalized', false,
    'session_id', v_session.id,
    'attended', v_attended,
    'no_show', v_no_show
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reservation_cancellation_outcome(target_studio_id uuid, target_starts_at timestamp with time zone)
 RETURNS reservation_status
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy public.studio_operating_policies%rowtype;
begin
  v_policy := private.studio_operating_policy(target_studio_id);

  if now() <= target_starts_at - make_interval(mins => v_policy.cancellation_cutoff_minutes) then
    return 'cancelled_on_time'::public.reservation_status;
  end if;

  return 'cancelled_late'::public.reservation_status;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reservation_credit_should_consume(p_studio_id uuid, p_status reservation_status)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy public.studio_operating_policies%rowtype;
begin
  v_policy := private.studio_operating_policy(p_studio_id);

  return case
    when p_status='attended' then true
    when p_status='no_show' then v_policy.no_show_consumes_credit
    when p_status='cancelled_late' then v_policy.late_cancellation_consumes_credit
    else false
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.seed_studio_operating_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.studio_operating_policies(studio_id)
  values(new.id)
  on conflict(studio_id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.studio_operating_policy(p_studio_id uuid)
 RETURNS studio_operating_policies
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    v_policy.updated_by_user_id := null;
    v_policy.updated_at := now();
  end if;

  return v_policy;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_reservation(target_reservation_id uuid, target_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_credit_cost integer;
  v_new_status public.reservation_status;
  v_is_staff boolean;
begin
  select *
    into v_reservation
  from public.reservations
  where id = target_reservation_id
  for update;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = v_reservation.session_id;

  select *
    into v_student
  from public.students
  where id = v_reservation.student_id;

  v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);

  v_is_staff := private.has_capability(v_reservation.studio_id, 'schedule.write');

  if not v_is_staff and not (
    v_student.user_id = (select auth.uid())
    and private.has_capability(v_reservation.studio_id, 'student.booking.self')
  ) then
    raise exception 'forbidden';
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'reservation_not_cancellable'
    );
  end if;

  v_new_status := private.reservation_cancellation_outcome(v_reservation.studio_id, v_session.starts_at);

  update public.reservations
  set status = v_new_status,
      cancelled_at = now(),
      cancellation_reason = nullif(trim(target_reason), ''),
      cancelled_by = (select auth.uid()),
      updated_at = now()
  where id = v_reservation.id;

  if v_reservation.acquisition_id is not null then
    select *
      into v_acquisition
    from public.product_acquisitions
    where id = v_reservation.acquisition_id
    for update;

    if found and not v_acquisition.unlimited then
      insert into public.credit_ledger(
        studio_id,
        acquisition_id,
        movement_type,
        quantity,
        reservation_id,
        note,
        created_by
      )
      values (
        v_reservation.studio_id,
        v_reservation.acquisition_id,
        'release',
        v_credit_cost,
        v_reservation.id,
        case
          when v_new_status = 'cancelled_on_time'
            then format('%s crédito(s) devueltos por cancelación a tiempo', v_credit_cost)
          else format('Cierre del hold de %s crédito(s) por cancelación tardía', v_credit_cost)
        end,
        (select auth.uid())
      )
      on conflict (reservation_id, movement_type) do nothing;

      if private.reservation_credit_should_consume(v_reservation.studio_id, v_new_status) then
        insert into public.credit_ledger(
          studio_id,
          acquisition_id,
          movement_type,
          quantity,
          reservation_id,
          note,
          created_by
        )
        values (
          v_reservation.studio_id,
          v_reservation.acquisition_id,
          'consume',
          -v_credit_cost,
          v_reservation.id,
          format('%s crédito(s) consumidos por cancelación tardía', v_credit_cost),
          (select auth.uid())
        )
        on conflict (reservation_id, movement_type) do nothing;
      end if;
    end if;

    if private.reservation_credit_should_consume(v_reservation.studio_id, v_new_status) then
      perform private.activate_acquisition_on_first_usage(
        v_reservation.acquisition_id,
        v_reservation.id
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_new_status::text,
    'credit_cost', v_credit_cost
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_public_studio_portal(p_slug text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, slug text, primary_color text, logo_path text, tagline text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    s.id,
    s.name,
    s.slug,
    s.primary_color,
    s.logo_path,
    s.tagline
  from public.studios s
  where s.status='active'::public.studio_status
    and (
      (
        p_slug is not null
        and s.slug=lower(trim(p_slug))
      )
      or (
        p_slug is null
        and 1=(
          select count(*)
          from public.studios active_studio
          where active_studio.status='active'::public.studio_status
        )
      )
    )
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.owner_update_studio_operating_policy(p_studio_id uuid, p_cancellation_cutoff_minutes integer, p_late_cancellation_consumes_credit boolean, p_no_show_consumes_credit boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.has_studio_role(
    p_studio_id,
    array['owner'::public.studio_role]
  ) then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if p_cancellation_cutoff_minutes is null
     or p_cancellation_cutoff_minutes < 0
     or p_cancellation_cutoff_minutes > 10080 then
    raise exception 'cancellation_cutoff_invalid' using errcode='22023';
  end if;

  insert into public.studio_operating_policies(
    studio_id,
    cancellation_cutoff_minutes,
    late_cancellation_consumes_credit,
    no_show_consumes_credit,
    updated_by_user_id,
    updated_at
  )
  values(
    p_studio_id,
    p_cancellation_cutoff_minutes,
    coalesce(p_late_cancellation_consumes_credit,true),
    coalesce(p_no_show_consumes_credit,true),
    (select auth.uid()),
    now()
  )
  on conflict(studio_id) do update
  set cancellation_cutoff_minutes=excluded.cancellation_cutoff_minutes,
      late_cancellation_consumes_credit=excluded.late_cancellation_consumes_credit,
      no_show_consumes_credit=excluded.no_show_consumes_credit,
      updated_by_user_id=(select auth.uid()),
      updated_at=now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.owner_update_studio_portal_branding(p_studio_id uuid, p_name text, p_logo_path text, p_tagline text, p_primary_color text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_name text := btrim(coalesce(p_name,''));
  normalized_logo_path text := nullif(btrim(coalesce(p_logo_path,'')),'');
  normalized_tagline text := nullif(btrim(coalesce(p_tagline,'')),'');
  normalized_color text := upper(btrim(coalesce(p_primary_color,'')));
begin
  if not private.has_studio_role(
    p_studio_id,
    array['owner'::public.studio_role]
  ) then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if length(normalized_name) < 2 or length(normalized_name) > 80 then
    raise exception 'studio_name_invalid' using errcode='22023';
  end if;

  if normalized_tagline is not null and length(normalized_tagline) > 120 then
    raise exception 'studio_tagline_invalid' using errcode='22023';
  end if;

  if normalized_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'studio_primary_color_invalid' using errcode='22023';
  end if;

  if normalized_logo_path is not null then
    if length(normalized_logo_path) > 500
       or split_part(normalized_logo_path,'/',1) <> p_studio_id::text then
      raise exception 'studio_logo_path_invalid' using errcode='22023';
    end if;
  end if;

  update public.studios
  set name=normalized_name,
      logo_path=normalized_logo_path,
      tagline=normalized_tagline,
      primary_color=normalized_color
  where id=p_studio_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.owner_update_studio_regional_settings(p_studio_id uuid, p_timezone text, p_currency text, p_locale text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text := btrim(coalesce(p_timezone,''));
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_locale text := btrim(coalesce(p_locale,''));
begin
  if not private.has_studio_role(
    p_studio_id,
    array['owner'::public.studio_role]
  ) then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name=v_timezone
  ) then
    raise exception 'studio_timezone_invalid' using errcode='22023';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'studio_currency_invalid' using errcode='22023';
  end if;

  if length(v_locale) < 2 or length(v_locale) > 20 then
    raise exception 'studio_locale_invalid' using errcode='22023';
  end if;

  update public.studios
  set timezone=v_timezone,
      currency=v_currency,
      locale=v_locale
  where id=p_studio_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.service_apply_asistian_booking_event(target_studio_id uuid, target_source_event_id uuid, target_event_name text, target_booking_id text, target_service_name text, target_starts_at timestamp with time zone, target_external_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event text := lower(trim(coalesce(target_event_name, '')));
  v_booking_id text := trim(coalesce(target_booking_id, ''));
  v_service_name text := nullif(trim(coalesce(target_service_name, '')), '');
  v_external_status text := lower(trim(coalesce(target_external_status, '')));
  v_link public.asistian_booking_links%rowtype;
  v_reservation public.reservations%rowtype;
  v_old_session public.class_sessions%rowtype;
  v_target_session public.class_sessions%rowtype;
  v_target_count integer := 0;
  v_occupied integer := 0;
  v_new_status public.reservation_status;
  v_acquisition public.product_acquisitions%rowtype;
  v_credit_cost integer := 1;
  v_coverage jsonb;
  v_new_acquisition_id uuid;
  v_new_unlimited boolean := false;
  v_new_credit_cost integer := 1;
  v_has_reservation boolean := false;
begin
  if target_studio_id is null
     or target_source_event_id is null
     or v_event = ''
     or v_booking_id = '' then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if not exists (
    select 1
    from public.asistian_webhook_events e
    where e.id = target_source_event_id
      and e.studio_id = target_studio_id
      and e.event_name = v_event
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'source_event_invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_studio_id::text || ':' || v_booking_id, 0)
  );

  select *
    into v_link
  from public.asistian_booking_links l
  where l.studio_id = target_studio_id
    and l.asistian_booking_id = v_booking_id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', 'booking_link_not_found',
      'asistian_booking_id', v_booking_id
    );
  end if;

  update public.asistian_booking_links
  set external_status = nullif(target_external_status, ''),
      last_event_name = v_event,
      last_event_at = now(),
      source_event_id = target_source_event_id
  where id = v_link.id;

  if v_link.reservation_id is not null then
    select *
      into v_reservation
    from public.reservations r
    where r.id = v_link.reservation_id
      and r.studio_id = target_studio_id
    for update;
    v_has_reservation := found;
  end if;

  if v_event = 'booking_rescheduled' then
    if v_service_name is null or target_starts_at is null then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'reschedule_context_incomplete'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'reschedule_context_incomplete',
        'asistian_booking_id', v_booking_id
      );
    end if;

    select count(*)
      into v_target_count
    from public.class_sessions cs
    join public.class_templates ct
      on ct.id = cs.template_id
     and ct.studio_id = cs.studio_id
    left join public.disciplines d
      on d.id = ct.discipline_id
     and d.studio_id = cs.studio_id
    where cs.studio_id = target_studio_id
      and cs.status = 'scheduled'
      and cs.starts_at = target_starts_at
      and (
        lower(trim(ct.name)) = lower(v_service_name)
        or lower(trim(coalesce(d.name, ''))) = lower(v_service_name)
      );

    if v_target_count <> 1 then
      update public.asistian_booking_links
      set service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'requires_attention',
          last_error_code = case when v_target_count = 0 then 'session_not_found' else 'session_ambiguous' end
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', case when v_target_count = 0 then 'session_not_found' else 'session_ambiguous' end,
        'asistian_booking_id', v_booking_id
      );
    end if;

    select cs.*
      into v_target_session
    from public.class_sessions cs
    join public.class_templates ct
      on ct.id = cs.template_id
     and ct.studio_id = cs.studio_id
    left join public.disciplines d
      on d.id = ct.discipline_id
     and d.studio_id = cs.studio_id
    where cs.studio_id = target_studio_id
      and cs.status = 'scheduled'
      and cs.starts_at = target_starts_at
      and (
        lower(trim(ct.name)) = lower(v_service_name)
        or lower(trim(coalesce(d.name, ''))) = lower(v_service_name)
      )
    limit 1
    for update of cs;

    if coalesce(v_target_session.requires_resource, false) then
      update public.asistian_booking_links
      set service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'requires_attention',
          last_error_code = 'resource_selection_required'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'resource_selection_required',
        'target_session_id', v_target_session.id,
        'reservation_id', v_link.reservation_id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    if v_link.reservation_id is null or not v_has_reservation then
      update public.asistian_booking_links
      set session_id = v_target_session.id,
          service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'requires_attention',
          last_error_code = 'local_reservation_missing'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'local_reservation_missing',
        'target_session_id', v_target_session.id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    if v_reservation.status <> 'reserved' then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'reservation_not_reschedulable'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'reservation_not_reschedulable',
        'reservation_id', v_reservation.id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    if exists (
      select 1
      from public.reservations r
      where r.session_id = v_target_session.id
        and r.student_id = v_reservation.student_id
        and r.status in ('reserved', 'attended')
        and r.id <> v_reservation.id
    ) then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'already_reserved_target_session'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'already_reserved_target_session',
        'target_session_id', v_target_session.id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    select count(*)
      into v_occupied
    from public.reservations r
    where r.session_id = v_target_session.id
      and r.status in ('reserved', 'attended')
      and r.id <> v_reservation.id;

    if v_occupied >= v_target_session.capacity then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'session_full'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'session_full',
        'target_session_id', v_target_session.id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    if v_reservation.acquisition_id is not null then
      v_coverage := private.sf177_walkin_commercial_coverage(v_reservation.id);

      if v_link.session_id <> v_target_session.id then
        update public.reservations
        set session_id = v_target_session.id,
            updated_at = now()
        where id = v_reservation.id;

        v_coverage := private.sf177_walkin_commercial_coverage(v_reservation.id);

        if not coalesce((v_coverage->>'covered')::boolean, false)
           or (v_coverage->>'acquisition_id')::uuid <> v_reservation.acquisition_id
           or greatest(coalesce((v_coverage->>'credit_cost')::integer, 1), 1)
              <> greatest(coalesce(v_reservation.credits_held, 1), 1) then
          update public.reservations
          set session_id = v_link.session_id,
              updated_at = now()
          where id = v_reservation.id;

          update public.asistian_booking_links
          set sync_status = 'requires_attention',
              last_error_code = case
                when coalesce((v_coverage->>'covered')::boolean, false)
                     and (v_coverage->>'acquisition_id')::uuid = v_reservation.acquisition_id
                  then 'credit_cost_changed'
                else 'package_not_valid_for_reschedule'
              end
          where id = v_link.id;

          return jsonb_build_object(
            'ok', true,
            'sync_status', 'requires_attention',
            'reason_code', case
              when coalesce((v_coverage->>'covered')::boolean, false)
                   and (v_coverage->>'acquisition_id')::uuid = v_reservation.acquisition_id
                then 'credit_cost_changed'
              else 'package_not_valid_for_reschedule'
            end,
            'reservation_id', v_reservation.id,
            'asistian_booking_id', v_booking_id
          );
        end if;
      end if;
    else
      update public.reservations
      set session_id = v_target_session.id,
          updated_at = now()
      where id = v_reservation.id;

      v_coverage := private.sf177_walkin_commercial_coverage(v_reservation.id);

      if coalesce((v_coverage->>'covered')::boolean, false) then
        v_new_acquisition_id := (v_coverage->>'acquisition_id')::uuid;
        v_new_unlimited := coalesce((v_coverage->>'unlimited')::boolean, false);
        v_new_credit_cost := greatest(coalesce((v_coverage->>'credit_cost')::integer, 1), 1);

        perform 1
        from public.product_acquisitions pa
        where pa.id = v_new_acquisition_id
        for update;

        update public.reservations
        set acquisition_id = v_new_acquisition_id,
            credits_held = v_new_credit_cost,
            commercial_status = 'package_covered',
            updated_at = now()
        where id = v_reservation.id;

        if not v_new_unlimited then
          insert into public.credit_ledger(
            studio_id, acquisition_id, movement_type, quantity,
            reservation_id, note, created_by
          )
          values (
            target_studio_id, v_new_acquisition_id, 'reserve', -v_new_credit_cost,
            v_reservation.id, format('%s crédito(s) reservados al reprogramar desde Asistian', v_new_credit_cost), null
          )
          on conflict (reservation_id, movement_type) do nothing;
        end if;
      end if;
    end if;

    update public.reservation_resource_assignments
    set released_at = now(),
        release_reason = 'asistian_rescheduled'
    where reservation_id = v_reservation.id
      and released_at is null
      and session_id <> v_target_session.id;

    update public.asistian_booking_links
    set session_id = v_target_session.id,
        service_name = v_service_name,
        starts_at = target_starts_at,
        sync_status = 'synced',
        last_error_code = null
    where id = v_link.id;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synced',
      'action', 'rescheduled',
      'reservation_id', v_reservation.id,
      'session_id', v_target_session.id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  if v_event = 'booking_cancelled'
     or (
       v_event = 'booking_status_changed'
       and v_external_status in ('cancelled', 'canceled')
     ) then
    if v_link.reservation_id is not null and v_has_reservation and v_reservation.status = 'reserved' then
      select *
        into v_old_session
      from public.class_sessions cs
      where cs.id = v_reservation.session_id
      for update;

      v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
      v_new_status := private.reservation_cancellation_outcome(target_studio_id, v_old_session.starts_at);

      update public.reservations
      set status = v_new_status,
          cancelled_at = now(),
          cancellation_reason = 'asistian:' || v_booking_id,
          cancelled_by = null,
          updated_at = now()
      where id = v_reservation.id;

      if v_reservation.acquisition_id is not null then
        select *
          into v_acquisition
        from public.product_acquisitions pa
        where pa.id = v_reservation.acquisition_id
        for update;

        if found and not v_acquisition.unlimited then
          insert into public.credit_ledger(
            studio_id, acquisition_id, movement_type, quantity,
            reservation_id, note, created_by
          )
          values (
            target_studio_id, v_reservation.acquisition_id, 'release', v_credit_cost,
            v_reservation.id,
            case
              when v_new_status = 'cancelled_on_time'
                then format('%s crédito(s) devueltos por cancelación Asistian a tiempo', v_credit_cost)
              else format('Cierre del hold de %s crédito(s) por cancelación Asistian tardía', v_credit_cost)
            end,
            null
          )
          on conflict (reservation_id, movement_type) do nothing;

          if private.reservation_credit_should_consume(target_studio_id, v_new_status) then
            insert into public.credit_ledger(
              studio_id, acquisition_id, movement_type, quantity,
              reservation_id, note, created_by
            )
            values (
              target_studio_id, v_reservation.acquisition_id, 'consume', -v_credit_cost,
              v_reservation.id,
              format('%s crédito(s) consumidos por cancelación Asistian tardía', v_credit_cost),
              null
            )
            on conflict (reservation_id, movement_type) do nothing;
          end if;
        end if;

        if private.reservation_credit_should_consume(target_studio_id, v_new_status) then
          perform private.activate_acquisition_on_first_usage(
            v_reservation.acquisition_id,
            v_reservation.id
          );
        end if;
      end if;
    end if;

    update public.students
    set trial_status = 'cancelled',
        updated_at = now()
    where id = v_link.student_id
      and student_type = 'trial';

    update public.asistian_booking_links
    set sync_status = 'synced',
        last_error_code = null
    where id = v_link.id;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synced',
      'action', 'cancelled',
      'reservation_id', v_link.reservation_id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  if v_event in ('booking_no_show', 'booking_completed')
     or (
       v_event = 'booking_status_changed'
       and v_external_status in ('no_show', 'noshow', 'completed', 'attended', 'done')
     ) then
    if v_link.reservation_id is null or not v_has_reservation then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'local_reservation_missing'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'local_reservation_missing',
        'asistian_booking_id', v_booking_id
      );
    end if;

    if v_reservation.status = 'reserved' then
      v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
      v_new_status := case
        when v_event = 'booking_no_show'
          or v_external_status in ('no_show', 'noshow')
          then 'no_show'::public.reservation_status
        else 'attended'::public.reservation_status
      end;

      update public.reservations
      set status = v_new_status,
          updated_at = now()
      where id = v_reservation.id;

      if v_reservation.acquisition_id is not null then
        select *
          into v_acquisition
        from public.product_acquisitions pa
        where pa.id = v_reservation.acquisition_id
        for update;

        if found and not v_acquisition.unlimited then
          if exists (
            select 1
            from public.credit_ledger cl
            where cl.reservation_id = v_reservation.id
              and cl.movement_type = 'reserve'
          ) then
            insert into public.credit_ledger(
              studio_id, acquisition_id, movement_type, quantity,
              reservation_id, note, created_by
            )
            values (
              target_studio_id, v_reservation.acquisition_id, 'release', v_credit_cost,
              v_reservation.id,
              format('Cierre del hold de %s crédito(s) por estado Asistian', v_credit_cost),
              null
            )
            on conflict (reservation_id, movement_type) do nothing;
          end if;

          if private.reservation_credit_should_consume(target_studio_id, v_new_status) then
            insert into public.credit_ledger(
              studio_id, acquisition_id, movement_type, quantity,
              reservation_id, note, created_by
            )
            values (
              target_studio_id, v_reservation.acquisition_id, 'consume', -v_credit_cost,
              v_reservation.id,
              case
                when v_new_status = 'attended'
                  then format('%s crédito(s) consumidos por asistencia Asistian', v_credit_cost)
                else format('%s crédito(s) consumidos por no-show Asistian', v_credit_cost)
              end,
              null
            )
            on conflict (reservation_id, movement_type) do nothing;
          end if;
        end if;

        if private.reservation_credit_should_consume(target_studio_id, v_new_status) then
          perform private.activate_acquisition_on_first_usage(
            v_reservation.acquisition_id,
            v_reservation.id
          );
        end if;
      end if;

      update public.students
      set trial_status = case
            when v_new_status = 'attended' then 'attended'::public.trial_status
            else 'no_show'::public.trial_status
          end,
          updated_at = now()
      where id = v_link.student_id
        and student_type = 'trial';
    end if;

    update public.asistian_booking_links
    set sync_status = 'synced',
        last_error_code = null
    where id = v_link.id;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synced',
      'action', case
        when v_event = 'booking_no_show' or v_external_status in ('no_show', 'noshow')
          then 'no_show'
        else 'attended'
      end,
      'reservation_id', v_link.reservation_id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  update public.asistian_booking_links
  set sync_status = 'synced',
      last_error_code = null
  where id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'sync_status', 'synced',
    'action', case
      when v_event = 'booking_confirmed' then 'confirmed'
      when v_event = 'booking_updated' then 'metadata_updated'
      when v_event = 'booking_status_changed' then 'status_recorded'
      else 'recorded'
    end,
    'reservation_id', v_link.reservation_id,
    'asistian_booking_id', v_booking_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_cancel_guest_invitation(target_invitation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_invite public.reward_guest_invitations%rowtype;
  v_guest public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_new_status public.reservation_status;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select * into v_invite
  from public.reward_guest_invitations
  where id=target_invitation_id
    and studio_id=v_student.studio_id
    and host_student_id=v_student.id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','invitation_not_found');
  end if;

  select * into v_guest
  from public.reservations
  where id=v_invite.guest_reservation_id
  for update;

  if not found or v_guest.status<>'reserved' then
    return jsonb_build_object('ok',false,'reason_code','invitation_not_cancellable');
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_guest.session_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  v_new_status:=private.reservation_cancellation_outcome(v_guest.studio_id, v_session.starts_at);

  update public.reservations
  set status=v_new_status,
      cancelled_at=now(),
      cancellation_reason='Invitación cancelada por anfitriona',
      cancelled_by=(select auth.uid()),
      updated_at=now()
  where id=v_guest.id;

  return jsonb_build_object(
    'ok',true,
    'status',v_new_status::text,
    'returned',v_new_status='cancelled_on_time'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_cancellation_preview(target_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_outcome public.reservation_status;
  v_credit_cost integer;
  v_uses_credits boolean := false;
  v_unlimited boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_reservation
  from public.reservations
  where id = target_reservation_id;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  if v_reservation.student_id is null
     or not private.is_current_student(
       v_reservation.student_id,
       v_reservation.studio_id
     ) then
    raise exception 'forbidden';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = v_reservation.session_id;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'reservation_not_cancellable'
    );
  end if;

  if v_reservation.acquisition_id is not null then
    select *
      into v_acquisition
    from public.product_acquisitions
    where id = v_reservation.acquisition_id;

    if found then
      v_unlimited := coalesce(v_acquisition.unlimited, false);
      v_uses_credits := not v_unlimited;
    end if;
  end if;

  v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
  v_outcome := private.reservation_cancellation_outcome(v_reservation.studio_id, v_session.starts_at);

  return jsonb_build_object(
    'ok', true,
    'status', v_outcome::text,
    'late', v_outcome = 'cancelled_late',
    'uses_credits', v_uses_credits,
    'unlimited', v_unlimited,
    'credit_cost', v_credit_cost,
    'credit_will_return',
      case
        when not v_uses_credits then null
        else not private.reservation_credit_should_consume(v_reservation.studio_id, v_outcome)
      end
  );
end;
$function$
;

drop trigger if exists seed_studio_operating_policy on public.studios;
create trigger seed_studio_operating_policy
after insert on public.studios
for each row
execute function private.seed_studio_operating_policy();

revoke all on function private.seed_studio_operating_policy()
from public,anon,authenticated,service_role;
revoke all on function private.studio_operating_policy(uuid)
from public,anon,authenticated,service_role;
revoke all on function private.reservation_credit_should_consume(uuid,public.reservation_status)
from public,anon,authenticated,service_role;
revoke all on function private.reservation_cancellation_outcome(uuid,timestamptz)
from public,anon,authenticated,service_role;

revoke all on function public.get_public_studio_portal(text) from public;
grant execute on function public.get_public_studio_portal(text) to anon,authenticated;

revoke all on function public.owner_update_studio_portal_branding(uuid,text,text,text,text)
from public,anon;
grant execute on function public.owner_update_studio_portal_branding(uuid,text,text,text,text)
to authenticated;

revoke all on function public.owner_update_studio_regional_settings(uuid,text,text,text)
from public,anon;
grant execute on function public.owner_update_studio_regional_settings(uuid,text,text,text)
to authenticated;

revoke all on function public.owner_update_studio_operating_policy(uuid,integer,boolean,boolean)
from public,anon;
grant execute on function public.owner_update_studio_operating_policy(uuid,integer,boolean,boolean)
to authenticated;
