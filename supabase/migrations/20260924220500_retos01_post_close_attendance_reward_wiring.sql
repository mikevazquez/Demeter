CREATE OR REPLACE FUNCTION public.admin_add_post_close_attendee(target_session_id uuid, target_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_acquisition record;
  v_reservation_id uuid;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_class_date date;
  v_timezone text;
  v_reason text := 'no_active_product';
  v_has_active_acquisition boolean := false;
  v_has_discipline_acquisition boolean := false;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if v_session.status <> 'completed' then
    raise exception 'session_not_completed';
  end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.has_studio_role(
       v_session.studio_id,
       array['owner'::public.studio_role, 'admin'::public.studio_role]
     ) then
    raise exception 'forbidden';
  end if;

  select * into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id
  for update;

  if not found then
    raise exception 'student_not_found';
  end if;

  if not v_student.active or v_student.lifecycle_status <> 'active' then
    raise exception 'student_not_operable';
  end if;

  if exists (
    select 1
    from public.reservations
    where session_id = target_session_id
      and student_id = target_student_id
      and status in ('reserved', 'attended', 'no_show')
  ) then
    raise exception 'already_in_roster';
  end if;

  select
    ct.discipline_id,
    greatest(coalesce(ct.credit_cost, 1), 1)
  into v_discipline_id, v_credit_cost
  from public.class_templates ct
  where ct.id = v_session.template_id;

  select timezone into v_timezone
  from public.studios
  where id = v_session.studio_id;

  v_class_date := (
    v_session.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
  )::date;

  select exists (
    select 1
    from public.product_acquisitions pa
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
  ) into v_has_active_acquisition;

  select exists (
    select 1
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pa.product_template_id
     and ptd.studio_id = pa.studio_id
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
      and ptd.discipline_id = v_discipline_id
  ) into v_has_discipline_acquisition;

  select
    pa.id,
    pa.unlimited,
    public.acquisition_credit_balance(pa.id) as available_credits
  into v_acquisition
  from public.product_acquisitions pa
  join public.product_template_disciplines ptd
    on ptd.product_template_id = pa.product_template_id
   and ptd.studio_id = pa.studio_id
  where pa.studio_id = v_session.studio_id
    and pa.student_id = target_student_id
    and pa.status = 'active'
    and not pa.access_blocked
    and (
      (pa.activation_mode = 'first_usage' and pa.starts_on is null)
      or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
    )
    and ptd.discipline_id = v_discipline_id
    and (
      pa.unlimited
      or public.acquisition_credit_balance(pa.id) >= v_credit_cost
    )
  order by
    pa.unlimited desc,
    coalesce(pa.expires_on, 'infinity'::date) asc,
    pa.created_at asc
  limit 1
  for update of pa;

  if found then
    insert into public.reservations(
      studio_id,
      session_id,
      student_id,
      student_user_id,
      acquisition_id,
      status,
      credits_held
    )
    values (
      v_session.studio_id,
      target_session_id,
      target_student_id,
      v_student.user_id,
      v_acquisition.id,
      'attended',
      v_credit_cost
    )
    returning id into v_reservation_id;

    if not coalesce(v_acquisition.unlimited, false) then
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
        v_session.studio_id,
        v_acquisition.id,
        'consume',
        -v_credit_cost,
        v_reservation_id,
        format(
          '%s crédito(s) consumidos por asistencia agregada manualmente después del cierre',
          v_credit_cost
        ),
        (select auth.uid())
      );
    end if;

    perform private.activate_acquisition_on_first_usage(
      v_acquisition.id,
      v_reservation_id
    );
  else
    if v_has_discipline_acquisition then
      v_reason := 'no_credits';
    elsif v_has_active_acquisition then
      v_reason := 'outside_product';
    end if;

    insert into public.reservations(
      studio_id,
      session_id,
      student_id,
      student_user_id,
      status,
      credits_held
    )
    values (
      v_session.studio_id,
      target_session_id,
      target_student_id,
      v_student.user_id,
      'attended',
      v_credit_cost
    )
    returning id into v_reservation_id;

    perform public.emit_domain_event(
      p_studio_id => v_session.studio_id,
      p_event_type => 'walkin.commercial_pending',
      p_source_entity_type => 'reservation',
      p_source_entity_id => v_reservation_id,
      p_deduplication_key => 'walkin.commercial_pending:' || v_reservation_id::text,
      p_actor_user_id => (select auth.uid()),
      p_payload => jsonb_build_object(
        'student_id', target_student_id,
        'session_id', target_session_id,
        'reason_code', v_reason,
        'credit_cost', v_credit_cost,
        'walkin', true,
        'commercial_pending', true,
        'post_close', true
      )
    );
  end if;

  perform public.emit_domain_event(
    p_studio_id => v_session.studio_id,
    p_event_type => 'attendance.post_close_added',
    p_source_entity_type => 'reservation',
    p_source_entity_id => v_reservation_id,
    p_deduplication_key => 'attendance.post_close_added:' || v_reservation_id::text,
    p_actor_user_id => (select auth.uid()),
    p_payload => jsonb_build_object(
      'student_id', target_student_id,
      'session_id', target_session_id,
      'status', 'attended',
      'provenance', 'Agregada manualmente después del cierre'
    )
  );

  perform private.reward_try_emit_domain_event(
    v_session.studio_id,
    'attendance.finalized',
    'reservation',
    v_reservation_id,
    'rewards:attendance:finalized:' || v_reservation_id::text,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'student_id', target_student_id,
      'reservation_id', v_reservation_id,
      'session_id', target_session_id,
      'attendance_status', 'attended',
      'post_close', true
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'student_id', target_student_id,
    'status', 'attended',
    'post_close', true,
    'commercial_pending', v_acquisition.id is null,
    'reason_code', case when v_acquisition.id is null then v_reason else null end,
    'acquisition_id', v_acquisition.id,
    'unlimited', coalesce(v_acquisition.unlimited, false),
    'credit_cost', v_credit_cost,
    'provenance', 'Agregada manualmente después del cierre'
  );
end;
$function$
