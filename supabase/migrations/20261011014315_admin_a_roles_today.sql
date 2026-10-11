-- StudioFlow admin block A. Apply to Sandbox before review; no production rollout.
begin;
insert into public.capabilities(key,description) values
 ('reservations.manage','Reservar y cancelar sin editar horarios'),
 ('plan.manage','Gestionar el plan y suscripción de StudioFlow')
on conflict(key) do update set description=excluded.description;
insert into public.role_capabilities(role,capability_key)
select 'admin'::public.studio_role,capability_key from public.role_capabilities where role='owner' and capability_key <> 'plan.manage'
on conflict do nothing;
insert into public.role_capabilities(role,capability_key) values
 ('owner','plan.manage'),('owner','reservations.manage'),('admin','reservations.manage'),
 ('reception','reservations.manage'),('reception','attendance.write'),('reception','sales.read'),('reception','sales.write'),('reception','products.read')
on conflict do nothing;
delete from public.role_capabilities where capability_key='plan.manage' and role <> 'owner';
-- Reception catalogue editing and documents permissions are pending decisions: preserve existing grants.
create policy reservations_staff_read_a on public.reservations for select to authenticated
using (private.has_capability(studio_id,'reservations.manage'));
drop policy if exists studio_payment_methods_write on public.studio_payment_methods;
create policy studio_payment_methods_write on public.studio_payment_methods for all to authenticated
using (private.has_capability(studio_id,'settings.write'))
with check (private.has_capability(studio_id,'settings.write'));

CREATE OR REPLACE FUNCTION public.owner_update_studio_regional_settings_v2(p_studio_id uuid, p_timezone text, p_currency text, p_locale text, p_phone_country_calling_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_phone_country_calling_code text := btrim(coalesce(p_phone_country_calling_code,''));
begin
  if v_phone_country_calling_code !~ '^\+[1-9][0-9]{0,3}$' then
    raise exception 'studio_phone_country_calling_code_invalid' using errcode='22023';
  end if;

  perform public.owner_update_studio_regional_settings(
    p_studio_id,
    p_timezone,
    p_currency,
    p_locale
  );

  update public.studios
  set phone_country_calling_code=v_phone_country_calling_code
  where id=p_studio_id;
end;
$function$
;
revoke all on function public.owner_update_studio_regional_settings_v2(uuid,text,text,text,text) from public, anon;
grant execute on function public.owner_update_studio_regional_settings_v2(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.book_student(target_session_id uuid, target_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_eligibility jsonb;
  v_acquisition_id uuid;
  v_unlimited boolean;
  v_credit_cost integer;
  v_reservation_id uuid;
  v_booked_count integer;
begin
  select *
  into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  select *
  into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;

  if not found then
    raise exception 'student_not_found';
  end if;

  if not (private.has_capability(v_session.studio_id, 'schedule.write') or private.has_capability(v_session.studio_id, 'reservations.manage'))
     and not (
       v_student.user_id = (select auth.uid())
       and private.has_capability(v_session.studio_id, 'student.booking.self')
     ) then
    raise exception 'forbidden';
  end if;

  v_eligibility := public.booking_eligibility(target_session_id, target_student_id);

  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return v_eligibility;
  end if;

  v_acquisition_id := (v_eligibility->>'acquisition_id')::uuid;
  v_unlimited := coalesce((v_eligibility->>'unlimited')::boolean, false);
  v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer, 1), 1);

  perform 1
  from public.product_acquisitions
  where id = v_acquisition_id
  for update;

  select count(*)
  into v_booked_count
  from public.reservations r
  where r.session_id = target_session_id
    and r.status in ('reserved', 'attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_full');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id = target_session_id
      and r.student_id = target_student_id
      and r.status in ('reserved', 'attended')
  ) then
    return jsonb_build_object('eligible', false, 'reason_code', 'already_reserved');
  end if;

  if not v_unlimited
     and public.acquisition_credit_balance(v_acquisition_id) < v_credit_cost then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'no_credits',
      'credit_cost', v_credit_cost
    );
  end if;

  insert into public.reservations (
    studio_id,
    session_id,
    student_id,
    student_user_id,
    acquisition_id,
    status,
    credits_held
  ) values (
    v_session.studio_id,
    target_session_id,
    target_student_id,
    v_student.user_id,
    v_acquisition_id,
    'reserved',
    v_credit_cost
  )
  returning id into v_reservation_id;

  if not v_unlimited then
    insert into public.credit_ledger (
      studio_id,
      acquisition_id,
      movement_type,
      quantity,
      reservation_id,
      note,
      created_by
    ) values (
      v_session.studio_id,
      v_acquisition_id,
      'reserve',
      -v_credit_cost,
      v_reservation_id,
      format('%s crédito(s) reservados al confirmar la clase', v_credit_cost),
      (select auth.uid())
    );
  end if;

  perform public.emit_domain_event(
    v_session.studio_id,
    'booking.created',
    'reservation',
    v_reservation_id,
    'booking.created:' || v_reservation_id::text,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'reservation_id', v_reservation_id,
      'session_id', target_session_id,
      'student_id', target_student_id,
      'acquisition_id', v_acquisition_id,
      'credit_cost', v_credit_cost,
      'unlimited', v_unlimited,
      'source', 'booking'
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'eligible', true,
    'reason_code', null,
    'reservation_id', v_reservation_id,
    'acquisition_id', v_acquisition_id,
    'unlimited', v_unlimited,
    'credit_cost', v_credit_cost
  );
end;
$function$
;
revoke all on function public.book_student(uuid,uuid) from public, anon;
grant execute on function public.book_student(uuid,uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.is_current_user_studio_owner_path(p_studio_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_studio_id uuid;
begin
  begin
    v_studio_id := p_studio_text::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  return private.has_capability(v_studio_id, 'settings.write');
end;
$function$
;
revoke all on function private.is_current_user_studio_owner_path(text) from public, anon;
grant execute on function private.is_current_user_studio_owner_path(text) to authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_studio_portal_branding(p_studio_id uuid, p_name text, p_logo_path text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_logo_path text := nullif(btrim(coalesce(p_logo_path, '')), '');
begin
  if not private.has_capability(p_studio_id, 'settings.write') then
    raise exception 'studio_owner_required' using errcode = '42501';
  end if;

  if length(normalized_name) < 2 or length(normalized_name) > 80 then
    raise exception 'studio_name_invalid' using errcode = '22023';
  end if;

  if normalized_logo_path is not null then
    if length(normalized_logo_path) > 500
       or split_part(normalized_logo_path, '/', 1) <> p_studio_id::text then
      raise exception 'studio_logo_path_invalid' using errcode = '22023';
    end if;
  end if;

  update public.studios
  set
    name = normalized_name,
    logo_path = normalized_logo_path
  where id = p_studio_id;
end;
$function$
;
revoke all on function public.owner_update_studio_portal_branding(uuid,text,text) from public, anon;
grant execute on function public.owner_update_studio_portal_branding(uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_studio_operating_policy(p_studio_id uuid, p_cancellation_cutoff_minutes integer, p_late_cancellation_consumes_credit boolean, p_no_show_consumes_credit boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.has_capability(p_studio_id, 'settings.write') then
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
revoke all on function public.owner_update_studio_operating_policy(uuid,integer,boolean,boolean) from public, anon;
grant execute on function public.owner_update_studio_operating_policy(uuid,integer,boolean,boolean) to authenticated;

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
  if not private.has_capability(p_studio_id, 'settings.write') then
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
revoke all on function public.owner_update_studio_portal_branding(uuid,text,text,text,text) from public, anon;
grant execute on function public.owner_update_studio_portal_branding(uuid,text,text,text,text) to authenticated;

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
  if not private.has_capability(p_studio_id, 'settings.write') then
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
revoke all on function public.owner_update_studio_regional_settings(uuid,text,text,text) from public, anon;
grant execute on function public.owner_update_studio_regional_settings(uuid,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_studio_operating_policy_v2(p_studio_id uuid, p_cancellation_cutoff_minutes integer, p_late_cancellation_consumes_credit boolean, p_no_show_consumes_credit boolean, p_default_minimum_reservations_enabled boolean, p_default_minimum_reservations integer, p_default_minimum_review_minutes_before integer, p_default_minimum_override_allowed boolean, p_unlimited_late_cancellation_penalty_minor integer, p_unlimited_no_show_penalty_minor integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.has_capability(p_studio_id, 'settings.write') then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if p_cancellation_cutoff_minutes is null
     or p_cancellation_cutoff_minutes < 0
     or p_cancellation_cutoff_minutes > 10080 then
    raise exception 'cancellation_cutoff_invalid' using errcode='22023';
  end if;

  if p_default_minimum_reservations is null
     or p_default_minimum_reservations < 1
     or p_default_minimum_reservations > 100 then
    raise exception 'minimum_reservations_invalid' using errcode='22023';
  end if;

  if p_default_minimum_review_minutes_before is null
     or p_default_minimum_review_minutes_before < 15
     or p_default_minimum_review_minutes_before > 10080 then
    raise exception 'minimum_review_invalid' using errcode='22023';
  end if;

  if coalesce(p_unlimited_late_cancellation_penalty_minor,-1) < 0
     or coalesce(p_unlimited_no_show_penalty_minor,-1) < 0 then
    raise exception 'unlimited_penalty_invalid' using errcode='22023';
  end if;

  insert into public.studio_operating_policies(
    studio_id,
    cancellation_cutoff_minutes,
    late_cancellation_consumes_credit,
    no_show_consumes_credit,
    default_minimum_reservations_enabled,
    default_minimum_reservations,
    default_minimum_review_minutes_before,
    default_minimum_override_allowed,
    unlimited_late_cancellation_penalty_minor,
    unlimited_no_show_penalty_minor,
    updated_by_user_id,
    updated_at
  )
  values(
    p_studio_id,
    p_cancellation_cutoff_minutes,
    coalesce(p_late_cancellation_consumes_credit,true),
    coalesce(p_no_show_consumes_credit,true),
    coalesce(p_default_minimum_reservations_enabled,false),
    p_default_minimum_reservations,
    p_default_minimum_review_minutes_before,
    coalesce(p_default_minimum_override_allowed,true),
    p_unlimited_late_cancellation_penalty_minor,
    p_unlimited_no_show_penalty_minor,
    (select auth.uid()),
    now()
  )
  on conflict(studio_id) do update
  set cancellation_cutoff_minutes=excluded.cancellation_cutoff_minutes,
      late_cancellation_consumes_credit=excluded.late_cancellation_consumes_credit,
      no_show_consumes_credit=excluded.no_show_consumes_credit,
      default_minimum_reservations_enabled=excluded.default_minimum_reservations_enabled,
      default_minimum_reservations=excluded.default_minimum_reservations,
      default_minimum_review_minutes_before=excluded.default_minimum_review_minutes_before,
      default_minimum_override_allowed=excluded.default_minimum_override_allowed,
      unlimited_late_cancellation_penalty_minor=excluded.unlimited_late_cancellation_penalty_minor,
      unlimited_no_show_penalty_minor=excluded.unlimited_no_show_penalty_minor,
      updated_by_user_id=(select auth.uid()),
      updated_at=now();
end;
$function$
;
revoke all on function public.owner_update_studio_operating_policy_v2(uuid,integer,boolean,boolean,boolean,integer,integer,boolean,integer,integer) from public, anon;
grant execute on function public.owner_update_studio_operating_policy_v2(uuid,integer,boolean,boolean,boolean,integer,integer,boolean,integer,integer) to authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_studio_portal_branding_v2_release(p_studio_id uuid, p_name text, p_logo_path text, p_tagline text, p_primary_color text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := btrim(coalesce(p_name,''));
  v_logo text := nullif(btrim(coalesce(p_logo_path,'')),'');
  v_tagline text := nullif(btrim(coalesce(p_tagline,'')),'');
  v_color text := upper(btrim(coalesce(p_primary_color,'')));
begin
  if not private.has_capability(p_studio_id, 'settings.write') then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'studio_name_invalid' using errcode='22023';
  end if;
  if v_tagline is not null and length(v_tagline) > 120 then
    raise exception 'studio_tagline_invalid' using errcode='22023';
  end if;
  if v_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'studio_primary_color_invalid' using errcode='22023';
  end if;
  if v_logo is not null and (
    length(v_logo) > 500 or split_part(v_logo,'/',1) <> p_studio_id::text
  ) then
    raise exception 'studio_logo_path_invalid' using errcode='22023';
  end if;
  update public.studios
  set name = v_name,
      logo_path = v_logo,
      tagline = v_tagline,
      primary_color = v_color
  where id = p_studio_id;
end;
$function$
;
revoke all on function public.owner_update_studio_portal_branding_v2_release(uuid,text,text,text,text) from public, anon;
grant execute on function public.owner_update_studio_portal_branding_v2_release(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_studio_regional_settings_v2_release(p_studio_id uuid, p_timezone text, p_currency text, p_locale text, p_phone_country_calling_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text := btrim(coalesce(p_timezone,''));
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_locale text := btrim(coalesce(p_locale,''));
  v_phone text := btrim(coalesce(p_phone_country_calling_code,''));
begin
  if not private.has_capability(p_studio_id, 'settings.write') then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'studio_timezone_invalid' using errcode='22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'studio_currency_invalid' using errcode='22023';
  end if;
  if length(v_locale) < 2 or length(v_locale) > 20 then
    raise exception 'studio_locale_invalid' using errcode='22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{0,3}$' then
    raise exception 'studio_phone_country_calling_code_invalid' using errcode='22023';
  end if;
  update public.studios
  set timezone = v_timezone,
      currency = v_currency,
      locale = v_locale,
      phone_country_calling_code = v_phone
  where id = p_studio_id;
end;
$function$
;
revoke all on function public.owner_update_studio_regional_settings_v2_release(uuid,text,text,text,text) from public, anon;
grant execute on function public.owner_update_studio_regional_settings_v2_release(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.booking_eligibility(target_session_id uuid, target_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_class_date date;
  v_timezone text;
  v_booked_count integer;
  v_has_active_acquisition boolean := false;
  v_has_discipline_acquisition boolean := false;
  v_has_required_enrollment boolean := false;
  v_has_blocked_acquisition boolean := false;
  v_acquisition record;
  v_balance integer;
  v_is_staff boolean;
begin
  select * into v_session from public.class_sessions where id=target_session_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','session_not_found'); end if;
  select * into v_student from public.students where id=target_student_id and studio_id=v_session.studio_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','student_not_found'); end if;

  v_is_staff := (private.has_capability(v_session.studio_id,'schedule.write') or private.has_capability(v_session.studio_id,'reservations.manage'));
  if not v_is_staff and not (v_student.user_id=(select auth.uid()) and private.has_capability(v_session.studio_id,'student.booking.self')) then
    raise exception 'forbidden';
  end if;

  if v_student.lifecycle_status<>'active' or not v_student.active then return jsonb_build_object('eligible',false,'reason_code','student_not_operable'); end if;
  if v_session.status<>'scheduled'
    or (
      v_session.starts_at<=now()
      and (
        not v_is_staff
        or v_session.ends_at is null
        or v_session.ends_at<=now()
      )
    )
  then
    return jsonb_build_object('eligible',false,'reason_code','session_not_bookable');
  end if;
  if exists(select 1 from public.reservations r where r.session_id=target_session_id and r.student_id=target_student_id and r.status in ('reserved','attended')) then
    return jsonb_build_object('eligible',false,'reason_code','already_reserved');
  end if;

  select count(*) into v_booked_count from public.reservations r where r.session_id=target_session_id and r.status in ('reserved','attended');
  if v_booked_count>=v_session.capacity then return jsonb_build_object('eligible',false,'reason_code','session_full'); end if;

  select ct.discipline_id,greatest(coalesce(ct.credit_cost,1),1) into v_discipline_id,v_credit_cost
  from public.class_templates ct where ct.id=v_session.template_id;
  select timezone into v_timezone from public.studios where id=v_session.studio_id;
  v_class_date := (v_session.starts_at at time zone coalesce(v_timezone,'America/Mexico_City'))::date;

  select * into v_policy from public.enrollment_policies where studio_id=v_session.studio_id;
  if found and v_policy.enabled and v_policy.required_for_booking then
    select exists(select 1 from public.student_enrollments se
      where se.studio_id=v_session.studio_id and se.student_id=target_student_id and se.status='active'
        and se.starts_on<=v_class_date and (se.expires_on is null or se.expires_on>=v_class_date)
    ) into v_has_required_enrollment;
    if not v_has_required_enrollment then return jsonb_build_object('eligible',false,'reason_code','enrollment_required'); end if;
  end if;

  select exists(select 1 from public.product_acquisitions pa
    where pa.studio_id=v_session.studio_id and pa.student_id=target_student_id and pa.status='active'
      and not pa.access_blocked
      and ((pa.activation_mode='first_usage' and pa.starts_on is null)
        or (pa.starts_on<=v_class_date and pa.expires_on>=v_class_date))
  ) into v_has_active_acquisition;

  if not v_has_active_acquisition then
    select exists(select 1 from public.product_acquisitions pa
      where pa.studio_id=v_session.studio_id and pa.student_id=target_student_id
        and pa.status='active' and pa.access_blocked
    ) into v_has_blocked_acquisition;
    if v_has_blocked_acquisition then return jsonb_build_object('eligible',false,'reason_code','payment_pending'); end if;
    return jsonb_build_object('eligible',false,'reason_code','no_active_product');
  end if;

  select exists(select 1 from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pa.product_template_id and ptd.studio_id=pa.studio_id
    where pa.studio_id=v_session.studio_id and pa.student_id=target_student_id and pa.status='active'
      and not pa.access_blocked
      and ((pa.activation_mode='first_usage' and pa.starts_on is null)
        or (pa.starts_on<=v_class_date and pa.expires_on>=v_class_date))
      and ptd.discipline_id=v_discipline_id
  ) into v_has_discipline_acquisition;
  if not v_has_discipline_acquisition then return jsonb_build_object('eligible',false,'reason_code','outside_product'); end if;

  for v_acquisition in
    select pa.id,pa.unlimited,pa.expires_on
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pa.product_template_id and ptd.studio_id=pa.studio_id
    where pa.studio_id=v_session.studio_id and pa.student_id=target_student_id and pa.status='active'
      and not pa.access_blocked
      and ((pa.activation_mode='first_usage' and pa.starts_on is null)
        or (pa.starts_on<=v_class_date and pa.expires_on>=v_class_date))
      and ptd.discipline_id=v_discipline_id
    order by pa.unlimited desc,coalesce(pa.expires_on,'infinity'::date) asc,pa.created_at asc
  loop
    if v_acquisition.unlimited then
      return jsonb_build_object('eligible',true,'reason_code',null,'acquisition_id',v_acquisition.id,'unlimited',true,'available_credits',null,'credit_cost',v_credit_cost);
    end if;
    select coalesce(sum(cl.quantity),0)::integer into v_balance from public.credit_ledger cl where cl.acquisition_id=v_acquisition.id;
    if v_balance>=v_credit_cost then
      return jsonb_build_object('eligible',true,'reason_code',null,'acquisition_id',v_acquisition.id,'unlimited',false,'available_credits',v_balance,'credit_cost',v_credit_cost);
    end if;
  end loop;

  return jsonb_build_object('eligible',false,'reason_code','no_credits','credit_cost',v_credit_cost);
end;
$function$
;
revoke all on function public.booking_eligibility(uuid,uuid) from public, anon;
grant execute on function public.booking_eligibility(uuid,uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_studio_business_profile_v1(p_studio_id uuid, p_contact_phone text, p_contact_email text, p_website_url text, p_location_name text, p_address text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_website text := nullif(btrim(coalesce(p_website_url, '')), '');
  v_location_name text := coalesce(nullif(btrim(coalesce(p_location_name, '')), ''), 'Principal');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_location_id uuid;
begin
  if not exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = p_studio_id
      and sm.user_id = (select auth.uid())
      and sm.active = true
      and sm.role::text = 'owner'
  ) then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if v_phone is not null and length(v_phone) > 40 then
    raise exception 'studio_contact_phone_invalid' using errcode='22023';
  end if;

  if v_email is not null and (
    length(v_email) > 160
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'studio_contact_email_invalid' using errcode='22023';
  end if;

  if v_website is not null and (
    length(v_website) > 300
    or v_website !~* '^https?://'
  ) then
    raise exception 'studio_website_url_invalid' using errcode='22023';
  end if;

  if length(v_location_name) > 100 then
    raise exception 'studio_location_name_invalid' using errcode='22023';
  end if;

  if v_address is not null and length(v_address) > 500 then
    raise exception 'studio_address_invalid' using errcode='22023';
  end if;

  update public.studios
  set contact_phone = v_phone,
      contact_email = v_email,
      website_url = v_website
  where id = p_studio_id;

  select id
    into v_location_id
  from public.studio_locations
  where studio_id = p_studio_id
    and is_primary = true
  order by created_at asc
  limit 1
  for update;

  if v_location_id is null then
    insert into public.studio_locations(
      studio_id,
      name,
      address,
      active,
      is_primary
    )
    values (
      p_studio_id,
      v_location_name,
      v_address,
      true,
      true
    )
    returning id into v_location_id;
  else
    update public.studio_locations
    set name = v_location_name,
        address = v_address,
        active = true
    where id = v_location_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'location_id', v_location_id
  );
end;
$function$
;
revoke all on function public.owner_update_studio_business_profile_v1(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.owner_update_studio_business_profile_v1(uuid,text,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION private.can_manage_attendance_session(target_studio_id uuid, target_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (private.has_capability(target_studio_id, 'attendance.write') and private.has_capability(target_studio_id, 'admin.portal'))
    or private.is_current_instructor_session(target_studio_id, target_session_id);
$function$
;
revoke all on function private.can_manage_attendance_session(uuid,uuid) from public, anon;
grant execute on function private.can_manage_attendance_session(uuid,uuid) to authenticated;

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

  v_is_staff := private.has_capability(v_reservation.studio_id, 'schedule.write') or private.has_capability(v_reservation.studio_id, 'reservations.manage');

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
revoke all on function public.cancel_reservation(uuid,text) from public, anon;
grant execute on function public.cancel_reservation(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.set_attendance_status(target_reservation_id uuid, target_status reservation_status, target_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_old_status public.reservation_status;
  v_is_admin boolean;
begin
  select cs.* into v_session from public.class_sessions cs
  join public.reservations r on r.session_id=cs.id where r.id=target_reservation_id for update of cs;
  if not found then raise exception 'reservation_not_found'; end if;
  select * into v_reservation from public.reservations
  where id=target_reservation_id and studio_id=v_session.studio_id for update;
  if not found then raise exception 'reservation_not_found'; end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write') then
    raise exception 'forbidden';
  end if;

  v_is_admin := private.has_studio_role(
    v_reservation.studio_id,
    array['owner'::public.studio_role, 'admin'::public.studio_role]
  );

  if v_session.status = 'cancelled' then
    raise exception 'session_cancelled';
  end if;

  if target_status not in ('reserved', 'attended', 'no_show') then
    raise exception 'invalid_attendance_status';
  end if;

  if target_status = 'attended' and v_reservation.commercial_status = 'payment_pending' then
    raise exception 'class_payment_required';
  end if;
  v_old_status := v_reservation.status;

  if v_old_status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio') then
    raise exception 'cancelled_reservation';
  end if;

  if v_session.status = 'completed' then
    if not private.can_manage_attendance_session(v_reservation.studio_id, v_session.id) then
      raise exception 'forbidden';
    end if;

    if nullif(trim(target_reason), '') is null then
      raise exception 'correction_reason_required';
    end if;

    if v_old_status not in ('reserved', 'attended', 'no_show') then
      raise exception 'invalid_completed_attendance_state';
    end if;

    if v_old_status = target_status then
      return jsonb_build_object(
        'ok', true,
        'status', target_status::text,
        'changed', false
      );
    end if;

    insert into public.attendance_corrections(
      studio_id,
      reservation_id,
      from_status,
      to_status,
      reason,
      corrected_by
    )
    values (
      v_reservation.studio_id,
      v_reservation.id,
      v_old_status,
      target_status,
      trim(target_reason),
      (select auth.uid())
    );
  else
    -- En sesión programada, Owner/Admin o el instructor asignado pueden operar,
    -- pero únicamente durante el intervalo real de la clase.
    if not private.can_manage_attendance_session(
      v_reservation.studio_id,
      v_session.id
    ) then
      raise exception 'forbidden';
    end if;

    if clock_timestamp() < v_session.starts_at - interval '20 minutes' then
      raise exception 'session_not_started';
    end if;



    if v_old_status not in ('reserved', 'attended', 'no_show') then
      raise exception 'invalid_attendance_state';
    end if;
  end if;

  update public.reservations
  set status = target_status,
      updated_at = clock_timestamp()
  where id = v_reservation.id;

  return jsonb_build_object(
    'ok', true,
    'status', target_status::text,
    'changed', v_old_status <> target_status
  );
end;
$function$
;
revoke all on function public.set_attendance_status(uuid,reservation_status,text) from public, anon;
grant execute on function public.set_attendance_status(uuid,reservation_status,text) to authenticated;

CREATE OR REPLACE FUNCTION private.record_class_payment_core(target_reservation_id uuid, payment_method text, payment_reference text DEFAULT NULL::text, payment_amount_minor integer DEFAULT NULL::integer, mark_attended boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_existing_payment public.payments%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_sale_line_id uuid;
  v_acquisition_id uuid;
  v_amount integer;
  v_method text := lower(trim(coalesce(payment_method, '')));
  v_reference text := nullif(trim(coalesce(payment_reference, '')), '');
  v_timezone text;
  v_currency text;
  v_class_date date;
  v_folio text;
  v_pending_event_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_reservation_id is null then
    raise exception 'reservation_required';
  end if;

  if v_method not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'payment_method_required';
  end if;

  select cs.* into v_session from public.class_sessions cs
  join public.reservations r on r.session_id=cs.id where r.id=target_reservation_id for update of cs;
  if not found then raise exception 'reservation_not_found'; end if;
  select * into v_reservation from public.reservations
  where id=target_reservation_id and studio_id=v_session.studio_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if not private.has_capability(v_reservation.studio_id, 'attendance.write') or not private.has_capability(v_reservation.studio_id, 'sales.write') then
    raise exception 'forbidden';
  end if;


  select *
    into v_existing_payment
  from public.payments p
  where p.reservation_id = v_reservation.id
    and p.kind = 'payment'
  order by p.created_at
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'reservation_id', v_reservation.id,
      'sale_id', v_existing_payment.sale_id,
      'payment_id', v_existing_payment.id,
      'status', v_reservation.status::text,
      'commercial_status', coalesce(v_reservation.commercial_status::text, 'paid')
    );
  end if;

  if coalesce(v_reservation.commercial_status::text, '') <> 'payment_pending' then
    raise exception 'payment_not_pending';
  end if;

  if v_reservation.status not in ('reserved', 'no_show') then
    raise exception 'invalid_attendance_state';
  end if;

  select *
    into v_session
  from public.class_sessions cs
  where cs.id = v_reservation.session_id
    and cs.studio_id = v_reservation.studio_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if v_session.status <> 'scheduled' then
    raise exception 'session_not_open';
  end if;

  if mark_attended and clock_timestamp() < v_session.starts_at - interval '20 minutes' then
    raise exception 'session_not_started';
  end if;



  if not private.can_manage_attendance_session(v_reservation.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  select *
    into v_template
  from public.class_templates ct
  where ct.id = v_session.template_id
    and ct.studio_id = v_reservation.studio_id;

  if not found then
    raise exception 'activity_not_found';
  end if;

  v_amount := coalesce(payment_amount_minor, v_template.drop_in_price_minor);

  if coalesce(v_amount, 0) <= 0 then
    raise exception 'class_price_required';
  end if;

  select coalesce(s.timezone, 'America/Mexico_City'),
         s.currency
    into v_timezone, v_currency
  from public.studios s
  where s.id = v_reservation.studio_id;

  v_class_date := (v_session.starts_at at time zone v_timezone)::date;
  v_folio := 'CL-' || to_char(v_class_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_sale_id::text, '-', ''), 1, 12));

  select *
    into v_product
  from public.product_templates pt
  where pt.studio_id = v_reservation.studio_id
    and pt.source_class_template_id = v_template.id
    and pt.product_type = 'single_class'::public.product_type
    and pt.price_minor = v_amount
  order by pt.created_at
  limit 1
  for update;

  if not found then
    insert into public.product_templates(
      studio_id,
      name,
      description,
      product_type,
      price_minor,
      currency,
      credit_limit,
      validity_days,
      unlimited,
      active,
      package_term,
      online_purchasable,
      source_class_template_id
    )
    values(
      v_reservation.studio_id,
      'Clase suelta · ' || v_template.name,
      'Producto interno para cobro de asistencia de clase individual',
      'single_class'::public.product_type,
      v_amount,
      upper(v_currency),
      1,
      1,
      false,
      false,
      null,
      false,
      v_template.id
    )
    returning * into v_product;
  end if;

  if v_template.discipline_id is not null then
    insert into public.product_template_disciplines(
      studio_id,
      product_template_id,
      discipline_id
    )
    values(
      v_reservation.studio_id,
      v_product.id,
      v_template.discipline_id
    )
    on conflict do nothing;
  end if;

  insert into public.sales(
    id,
    studio_id,
    student_id,
    folio,
    status,
    currency,
    total_minor,
    created_by
  )
  values(
    v_sale_id,
    v_reservation.studio_id,
    v_reservation.student_id,
    v_folio,
    'confirmed',
    upper(v_currency),
    v_amount,
    (select auth.uid())
  );

  insert into public.sale_lines(
    studio_id,
    sale_id,
    product_template_id,
    product_name,
    quantity,
    unit_price_minor,
    line_total_minor
  )
  values(
    v_reservation.studio_id,
    v_sale_id,
    v_product.id,
    'Clase suelta · ' || v_template.name,
    1,
    v_amount,
    v_amount
  )
  returning id into v_sale_line_id;

  insert into public.payments(
    studio_id,
    sale_id,
    sale_line_id,
    kind,
    amount_minor,
    method,
    reference,
    notes,
    created_by,
    effective_on,
    reservation_id
  )
  values(
    v_reservation.studio_id,
    v_sale_id,
    v_sale_line_id,
    'payment',
    v_amount,
    v_method,
    v_reference,
    'Cobro de clase pendiente desde Hoy',
    (select auth.uid()),
    v_class_date,
    v_reservation.id
  )
  returning id into v_existing_payment.id;

  insert into public.product_acquisitions(
    studio_id,
    student_id,
    product_template_id,
    status,
    starts_on,
    expires_on,
    credit_limit,
    unlimited,
    sale_line_id,
    activation_mode,
    access_blocked,
    validity_days_snapshot
  )
  values(
    v_reservation.studio_id,
    v_reservation.student_id,
    v_product.id,
    'active',
    v_class_date,
    v_class_date + 1,
    1,
    false,
    v_sale_line_id,
    'fixed_date',
    false,
    1
  )
  returning id into v_acquisition_id;

  insert into public.credit_ledger(
    studio_id,
    acquisition_id,
    movement_type,
    quantity,
    note,
    created_by
  )
  values(
    v_reservation.studio_id,
    v_acquisition_id,
    'grant',
    1,
    'Clase individual cobrada al registrar asistencia',
    (select auth.uid())
  );

  insert into public.credit_ledger(
    studio_id,
    acquisition_id,
    movement_type,
    quantity,
    reservation_id,
    note,
    created_by
  )
  values(
    v_reservation.studio_id,
    v_acquisition_id,
    'reserve',
    -1,
    v_reservation.id,
    'Crédito aplicado a la reserva cobrada al registrar asistencia',
    (select auth.uid())
  )
  on conflict (reservation_id, movement_type) do nothing;

  update public.reservations
  set acquisition_id = v_acquisition_id,
      credits_held = 1,
      commercial_status = 'paid'::public.reservation_commercial_status,
      status = case when mark_attended then 'attended'::public.reservation_status else 'reserved'::public.reservation_status end,
      updated_at = clock_timestamp()
  where id = v_reservation.id;

  select e.event_id
    into v_pending_event_id
  from public.domain_events e
  where e.studio_id = v_reservation.studio_id
    and e.event_type = 'walkin.commercial_pending'
    and e.source_entity_type = 'reservation'
    and e.source_entity_id = v_reservation.id
    and not exists (
      select 1
      from public.domain_events resolved
      where resolved.studio_id = e.studio_id
        and resolved.event_type = 'walkin.commercial_resolved'
        and resolved.source_entity_type = 'reservation'
        and resolved.source_entity_id = e.source_entity_id
    )
  order by e.recorded_at
  limit 1;

  if v_pending_event_id is not null then
    perform public.emit_domain_event(
      p_studio_id => v_reservation.studio_id,
      p_event_type => 'walkin.commercial_resolved',
      p_source_entity_type => 'reservation',
      p_source_entity_id => v_reservation.id,
      p_deduplication_key => 'walkin.commercial_resolved:' || v_reservation.id::text,
      p_actor_user_id => (select auth.uid()),
      p_payload => jsonb_build_object(
        'student_id', v_reservation.student_id,
        'session_id', v_session.id,
        'pending_event_id', v_pending_event_id,
        'resolution_source', 'class_payment',
        'sale_id', v_sale_id,
        'payment_id', v_existing_payment.id,
        'acquisition_id', v_acquisition_id,
        'amount_minor', v_amount,
        'payment_method', v_method
      ),
      p_causation_event_id => v_pending_event_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'reservation_id', v_reservation.id,
    'sale_id', v_sale_id,
    'sale_line_id', v_sale_line_id,
    'payment_id', v_existing_payment.id,
    'acquisition_id', v_acquisition_id,
    'amount_minor', v_amount,
    'status', case when mark_attended then 'attended' else 'reserved' end,
    'commercial_status', 'paid'
  );
end;
$function$
;
revoke all on function private.record_class_payment_core(uuid,text,text,integer,boolean) from public, anon, authenticated;

create or replace function public.record_class_payment_and_attendance(target_reservation_id uuid, payment_method text, payment_reference text default null, payment_amount_minor integer default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.record_class_payment_core(target_reservation_id,payment_method,payment_reference,payment_amount_minor,true);
$$;
-- The invoker wrapper needs EXECUTE on the private core; the core enforces studio capabilities.
grant execute on function private.record_class_payment_core(uuid,text,text,integer,boolean) to authenticated;
revoke all on function public.record_class_payment_and_attendance(uuid,text,text,integer) from public,anon;
grant execute on function public.record_class_payment_and_attendance(uuid,text,text,integer) to authenticated;

alter table public.reservations add column if not exists class_kind text check (class_kind in ('trial','drop_in'));
alter table public.reservations add column if not exists class_amount_minor integer check (class_amount_minor > 0);

create or replace function public.admin_book_drop_in(target_session_id uuid,target_student_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype; result jsonb; price integer;
begin
 select * into s from public.class_sessions where id=target_session_id for update;
 if not found then raise exception 'session_not_found'; end if;
 if not private.has_capability(s.studio_id,'reservations.manage') then raise exception 'forbidden'; end if;
 select drop_in_price_minor into price from public.class_templates where id=s.template_id and studio_id=s.studio_id;
 if coalesce(price,0)<=0 then raise exception 'drop_in_not_available'; end if;
 result := public.add_existing_walkin_student(target_session_id,target_student_id);
 if coalesce((result->>'commercial_pending')::boolean,false) then
   update public.reservations set commercial_status='payment_pending',class_kind='drop_in',class_amount_minor=price where id=(result->>'reservation_id')::uuid;
 end if;
 return result;
end;
$$;
revoke all on function public.admin_book_drop_in(uuid,uuid) from public,anon;
grant execute on function public.admin_book_drop_in(uuid,uuid) to authenticated;

create or replace function public.admin_create_walkin(target_session_id uuid,p_first_name text,p_last_name text,p_phone text,p_kind text,p_payment_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype; result jsonb; price integer; payment jsonb; student uuid;
begin
 select * into s from public.class_sessions where id=target_session_id for update;
 if not found then raise exception 'session_not_found'; end if;
 if not private.has_capability(s.studio_id,'reservations.manage') or not private.has_capability(s.studio_id,'students.write') or not private.has_capability(s.studio_id,'sales.write') then raise exception 'forbidden'; end if;
 if p_kind not in ('trial','drop_in') or p_payment_method not in ('efectivo','transferencia','tarjeta','pay_later') then raise exception 'walkin_invalid'; end if;
 if p_phone !~ '^\+52[0-9]{10}$' then raise exception 'phone_invalid'; end if;
 if p_kind='trial' then price:=15000; else
   select drop_in_price_minor into price from public.class_templates where id=s.template_id and studio_id=s.studio_id;
 end if;
 if coalesce(price,0)<=0 then raise exception 'drop_in_not_available'; end if;
 result:=public.create_walkin_student(target_session_id,p_first_name,p_last_name,p_phone);
 student:=(result->>'student_id')::uuid;
 update public.students set student_type=case when p_kind='trial' then 'trial'::public.student_type else student_type end,
   trial_status=case when p_kind='trial' then 'pending'::public.trial_status else trial_status end where id=student;
 update public.reservations set commercial_status='payment_pending',class_kind=p_kind,class_amount_minor=price where id=(result->>'reservation_id')::uuid;
 if p_payment_method<>'pay_later' then
   payment:=private.record_class_payment_core((result->>'reservation_id')::uuid,p_payment_method,null,price,false);
 end if;
 perform public.emit_domain_event(p_studio_id=>s.studio_id,p_event_type=>'person.walkin_created',p_source_entity_type=>'student',p_source_entity_id=>student,p_deduplication_key=>'walkin.created:'||student::text,p_actor_user_id=>(select auth.uid()),p_payload=>jsonb_build_object('source','Visita al estudio','class_kind',p_kind,'student_id',student));
 return result || jsonb_build_object('amount_minor',price,'commercial_pending',p_payment_method='pay_later','source','Visita al estudio');
end;
$$;
revoke all on function public.admin_create_walkin(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.admin_create_walkin(uuid,text,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.check_in_reservation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token_hash bytea;
  v_token_row public.reservation_checkin_tokens%rowtype;
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_session_id uuid;
  v_activity text;
  v_student_name text;
  v_existing_checkin public.attendance_checkins%rowtype;
  v_checked_in_at timestamptz;
  v_requested_studio uuid := private.requested_studio_id();
begin
  if nullif(trim(coalesce(p_token, '')), '') is null
     or length(trim(p_token)) > 200 then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  v_token_hash := extensions.digest(
    convert_to(trim(p_token), 'UTF8'),
    'sha256'
  );

  select * into v_token_row
  from public.reservation_checkin_tokens
  where token_hash = v_token_hash;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  -- Lee la referencia primero y después bloquea en el mismo orden que el cierre:
  -- sesión -> reserva. Esto evita carreras entre el último scan y finalize_attendance.
  select r.session_id into v_session_id
  from public.reservations r
  where r.id = v_token_row.reservation_id;

  if v_session_id is null then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  select * into v_session
  from public.class_sessions
  where id = v_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  select * into v_reservation
  from public.reservations
  where id = v_token_row.reservation_id
    and session_id = v_session.id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  if v_requested_studio is not null and v_reservation.studio_id <> v_requested_studio then
    raise exception 'forbidden';
  end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write') or not private.can_manage_attendance_session(v_reservation.studio_id,v_session.id) then
    raise exception 'forbidden';
  end if;

  select ct.name into v_activity
  from public.class_templates ct
  where ct.id = v_session.template_id
    and ct.studio_id = v_session.studio_id;

  select coalesce(
    (
      select s.full_name
      from public.students s
      where s.id = v_reservation.student_id
        and s.studio_id = v_reservation.studio_id
    ),
    (
      select trim(concat_ws(' ', p.first_name, p.last_name))
      from public.persons p
      where p.id = v_reservation.guest_person_id
        and p.studio_id = v_reservation.studio_id
    ),
    'Asistente'
  ) into v_student_name;

  if v_session.status = 'cancelled'
     or v_token_row.revoked_at is not null
     or v_reservation.status in ('cancelled_on_time','cancelled_late','cancelled_by_studio') then
    return jsonb_build_object(
      'ok', false,
      'status', 'reservation_invalid'
    );
  end if;

  v_checked_in_at := clock_timestamp();

  if v_checked_in_at < v_session.starts_at - interval '20 minutes' then
    return jsonb_build_object(
      'ok', false,
      'status', 'too_early',
      'available_at', v_session.starts_at - interval '20 minutes'
    );
  end if;

  if v_checked_in_at >= v_session.starts_at + interval '30 minutes'
     or v_session.status = 'completed'
     or v_reservation.status = 'no_show' then
    return jsonb_build_object(
      'ok', false,
      'status', 'session_finished'
    );
  end if;

  if v_reservation.status = 'attended' then
    select * into v_existing_checkin
    from public.attendance_checkins
    where reservation_id = v_reservation.id;

    return jsonb_build_object(
      'ok', true,
      'status', 'already_attended',
      'reservation_id', v_reservation.id,
      'session_id', v_session.id,
      'student_name', v_student_name,
      'activity', v_activity,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'checked_in_at', v_existing_checkin.checked_in_at
    );
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'status', 'reservation_invalid'
    );
  end if;

  if v_reservation.commercial_status='payment_pending' then
    return jsonb_build_object('ok',false,'status','payment_pending','student_name',v_student_name);
  end if;

  update public.reservations
  set status = 'attended',
      updated_at = v_checked_in_at
  where id = v_reservation.id;

  insert into public.attendance_checkins(
    studio_id,
    reservation_id,
    session_id,
    source,
    actor_user_id,
    checked_in_at
  )
  values (
    v_reservation.studio_id,
    v_reservation.id,
    v_session.id,
    'KIOSK',
    (select auth.uid()),
    v_checked_in_at
  )
  on conflict (reservation_id) do nothing;

  perform public.emit_domain_event(
    v_reservation.studio_id,
    'attendance.checked_in',
    'reservation',
    v_reservation.id,
    'attendance:checked_in:' || v_reservation.id::text,
    v_checked_in_at,
    (select auth.uid()),
    jsonb_build_object(
      'reservation_id', v_reservation.id,
      'session_id', v_session.id,
      'student_id', v_reservation.student_id,
      'guest_person_id', v_reservation.guest_person_id,
      'source', 'KIOSK',
      'checked_in_at', v_checked_in_at
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'credits_left', case when v_reservation.acquisition_id is null then null else public.acquisition_credit_balance(v_reservation.acquisition_id) end,
    'status', 'success',
    'reservation_id', v_reservation.id,
    'session_id', v_session.id,
    'student_name', v_student_name,
    'activity', v_activity,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'checked_in_at', v_checked_in_at
  );
end;
$function$
;
revoke all on function public.check_in_reservation(text) from public, anon;
grant execute on function public.check_in_reservation(text) to authenticated;
alter table public.class_sessions add column if not exists cancelled_at timestamptz;
alter table public.class_sessions add column if not exists cancelled_by uuid references auth.users(id);
alter table public.class_sessions add column if not exists cancellation_source text check(cancellation_source in ('manual','minimum','holiday'));
create or replace function private.audit_admin_session_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status then
   new.cancelled_at:=clock_timestamp(); new.cancelled_by:=(select auth.uid());
   new.cancellation_source:=coalesce(new.cancellation_source,case when new.minimum_review_status='cancelled' then 'minimum' when new.holiday_override_id is not null then 'holiday' else 'manual' end);
   new.cancellation_reason:=coalesce(nullif(btrim(new.cancellation_reason),''),case when new.minimum_review_status='cancelled' then 'No alcanzó el mínimo de reservas' else 'Clase cancelada por el estudio' end);
 elsif old.status='cancelled' and new.status<>'cancelled' then
   new.cancelled_at:=null; new.cancelled_by:=null; new.cancellation_source:=null; new.cancellation_reason:=null;
 end if;
 return new;
end;
$$;
revoke all on function private.audit_admin_session_cancellation() from public,anon,authenticated;
create trigger audit_admin_session_cancellation before update of status on public.class_sessions for each row execute function private.audit_admin_session_cancellation();

create or replace function public.admin_cancel_session(target_session_id uuid,reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype;
begin
 select * into s from public.class_sessions where id=target_session_id for update;
 if not found then raise exception 'session_not_found'; end if;
 if not private.has_capability(s.studio_id,'schedule.write') then raise exception 'forbidden'; end if;
 if nullif(btrim(reason),'') is null then raise exception 'cancellation_reason_required'; end if;
 if s.status='cancelled' then return jsonb_build_object('ok',true,'already_cancelled',true); end if;
 if s.status<>'scheduled' then raise exception 'session_not_open'; end if;
 update public.class_sessions set status='cancelled',cancellation_reason=btrim(reason),cancellation_source='manual',is_schedule_exception=(recurring_schedule_id is not null) where id=s.id;
 -- Existing cancellation trigger releases package holds and emits cancellation events.
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.admin_cancel_session(uuid,text) from public,anon;
grant execute on function public.admin_cancel_session(uuid,text) to authenticated;

create or replace function public.admin_search_people(target_studio_id uuid,q text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare normalized text:=lower(regexp_replace(coalesce(q,''),'\s','','g')); today date;
begin
 if not private.has_capability(target_studio_id,'students.read') or not private.has_capability(target_studio_id,'admin.portal') then raise exception 'forbidden'; end if;
 if length(normalized)<2 then return '[]'::jsonb; end if;
 select (now() at time zone timezone)::date into today from public.studios where id=target_studio_id;
 return (select coalesce(jsonb_agg(to_jsonb(matches)),'[]'::jsonb) from (
   select s.id,s.full_name,s.phone,(not s.active or s.lifecycle_status<>'active') as inactive,
   case when exists(select 1 from public.student_enrollments e where e.student_id=s.id and e.studio_id=target_studio_id and e.status='active' and e.starts_on<=today and (e.expires_on is null or e.expires_on>=today)) then 'Alumna'
     when exists(select 1 from public.student_enrollments e where e.student_id=s.id and e.studio_id=target_studio_id and e.expires_on<today) then 'Exalumna'
     when s.student_type='trial' and s.trial_status<>'converted' then 'Prueba' else 'Prospecto' end as stage,
   '/admin/alumnas/'||s.id::text as href
   from public.students s where s.studio_id=target_studio_id and s.lifecycle_status<>'archived'
     and (position(normalized in lower(regexp_replace(s.full_name,'\s','','g')))>0 or position(normalized in regexp_replace(coalesce(s.phone,''),'\s','','g'))>0)
   union all
   select c.id,btrim(concat_ws(' ',p.first_name,p.last_name)),pc.value,false,'Prospecto','/admin/alumnas/contactos/'||c.id::text
   from public.crm_contacts c join public.persons p on p.id=c.person_id and p.studio_id=c.studio_id
   left join lateral (select value from public.person_contacts where person_id=p.id and studio_id=target_studio_id and kind='phone' order by is_primary desc limit 1) pc on true
   where c.studio_id=target_studio_id and c.lifecycle_status='prospect' and c.converted_student_id is null
     and not exists(select 1 from public.students s where s.person_id=c.person_id and s.studio_id=target_studio_id)
     and (position(normalized in lower(regexp_replace(concat_ws(' ',p.first_name,p.last_name),'\s','','g')))>0 or position(normalized in regexp_replace(coalesce(pc.value,''),'\s','','g'))>0)
   order by full_name limit 10
 ) matches);
end;
$$;
revoke all on function public.admin_search_people(uuid,text) from public,anon;
grant execute on function public.admin_search_people(uuid,text) to authenticated;

create or replace function public.admin_today_calendar(target_studio_id uuid,target_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tz text; week_start date:=date_trunc('week',target_date)::date; result jsonb;
begin
 if not private.has_capability(target_studio_id,'admin.portal') then raise exception 'forbidden'; end if;
 select timezone into tz from public.studios where id=target_studio_id;
 select jsonb_build_object(
   'min_date',min((starts_at at time zone tz)::date), 'max_date',max((starts_at at time zone tz)::date),
   'week',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from (
     select (s.starts_at at time zone tz)::date as date, s.id,
       coalesce((select count(*) from public.reservations r where r.session_id=s.id and r.status in ('reserved','attended')),0)::numeric/nullif(s.capacity,0)>=.7 as busy
     from public.class_sessions s where s.studio_id=target_studio_id and s.status<>'cancelled'
       and s.starts_at>=week_start::timestamp at time zone tz and s.starts_at<(week_start+7)::timestamp at time zone tz order by s.starts_at
   ) d)) into result from public.class_sessions where studio_id=target_studio_id;
 return result;
end;
$$;
revoke all on function public.admin_today_calendar(uuid,date) from public,anon;
grant execute on function public.admin_today_calendar(uuid,date) to authenticated;

create table private.admin_attendance_batches (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), session_id uuid not null references public.class_sessions(id), actor_id uuid not null references auth.users(id), reservation_ids uuid[] not null, created_at timestamptz not null default now(), undone_at timestamptz
);
alter table private.admin_attendance_batches enable row level security;
revoke all on private.admin_attendance_batches from public,anon,authenticated;
create or replace function public.bulk_mark_attended(target_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype; ids uuid[]:='{}'; r record; batch uuid;
begin
 select * into s from public.class_sessions where id=target_session_id for update;
 if not found then raise exception 'session_not_found'; end if;
 if not private.has_capability(s.studio_id,'attendance.write') or not private.can_manage_attendance_session(s.studio_id,s.id) then raise exception 'forbidden'; end if;
 if s.status<>'scheduled' or clock_timestamp()<s.starts_at-interval '20 minutes' then raise exception 'attendance_not_open'; end if;
 for r in select id from public.reservations where session_id=s.id and status='reserved' and commercial_status is distinct from 'payment_pending' for update loop
   perform public.set_attendance_status(r.id,'attended'); ids:=array_append(ids,r.id);
 end loop;
 insert into private.admin_attendance_batches(studio_id,session_id,actor_id,reservation_ids) values(s.studio_id,s.id,(select auth.uid()),ids) returning id into batch;
 return jsonb_build_object('ok',true,'count',cardinality(ids),'batch_id',batch);
end;
$$;
revoke all on function public.bulk_mark_attended(uuid) from public,anon;
grant execute on function public.bulk_mark_attended(uuid) to authenticated;
create or replace function public.undo_bulk_mark_attended(target_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.admin_attendance_batches%rowtype; s public.class_sessions%rowtype; changed integer;
begin
 select * into b from private.admin_attendance_batches where id=target_batch_id;
 if not found or b.actor_id<>(select auth.uid()) or b.undone_at is not null or clock_timestamp()>b.created_at+interval '5 seconds' then raise exception 'undo_expired'; end if;
 select * into s from public.class_sessions where id=b.session_id for update;
 if s.status<>'scheduled' or not private.has_capability(s.studio_id,'attendance.write') or not private.can_manage_attendance_session(s.studio_id,s.id) then raise exception 'undo_unavailable'; end if;
 update public.reservations set status='reserved',updated_at=clock_timestamp() where id=any(b.reservation_ids) and status='attended' and updated_at>=b.created_at and not exists(select 1 from public.attendance_checkins c where c.reservation_id=reservations.id);
 get diagnostics changed=row_count;
 update private.admin_attendance_batches set undone_at=clock_timestamp() where id=b.id;
 return jsonb_build_object('ok',true,'count',changed);
end;
$$;
revoke all on function public.undo_bulk_mark_attended(uuid) from public,anon;
grant execute on function public.undo_bulk_mark_attended(uuid) to authenticated;
create table private.admin_kiosk_settings (
 studio_id uuid primary key references public.studios(id) on delete cascade,
 pin_hash text not null,
 message text not null default '' check(length(message)<=120),
 updated_at timestamptz not null default now()
);
alter table private.admin_kiosk_settings enable row level security;
revoke all on private.admin_kiosk_settings from public,anon,authenticated;
create table private.admin_kiosk_pin_attempts (
 studio_id uuid not null references public.studios(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 failures integer not null default 0, blocked_until timestamptz,
 primary key(studio_id,user_id)
);
alter table private.admin_kiosk_pin_attempts enable row level security;
revoke all on private.admin_kiosk_pin_attempts from public,anon,authenticated;
create or replace function public.admin_kiosk_configuration(target_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_capability(target_studio_id,'attendance.write') then raise exception 'forbidden'; end if;
 return coalesce((select jsonb_build_object('configured',true,'message',message) from private.admin_kiosk_settings where studio_id=target_studio_id),jsonb_build_object('configured',false,'message',''));
end;
$$;
revoke all on function public.admin_kiosk_configuration(uuid) from public,anon;
grant execute on function public.admin_kiosk_configuration(uuid) to authenticated;
create or replace function public.admin_save_kiosk_configuration(target_studio_id uuid,p_pin text,p_message text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_capability(target_studio_id,'settings.write') then raise exception 'forbidden'; end if;
 if length(coalesce(p_message,''))>120 then raise exception 'message_too_long'; end if;
 if coalesce(p_pin,'')<>'' and p_pin !~ '^[0-9]{4}$' then raise exception 'pin_invalid'; end if;
 if not exists(select 1 from private.admin_kiosk_settings where studio_id=target_studio_id) and coalesce(p_pin,'')='' then raise exception 'pin_required'; end if;
 if coalesce(p_pin,'')<>'' then
 insert into private.admin_kiosk_settings(studio_id,pin_hash,message) values(target_studio_id,extensions.crypt(p_pin,extensions.gen_salt('bf',10)),coalesce(p_message,''))
 on conflict(studio_id) do update set pin_hash=excluded.pin_hash,message=excluded.message,updated_at=now();
 else update private.admin_kiosk_settings set message=coalesce(p_message,''),updated_at=now() where studio_id=target_studio_id;
 end if;
end;
$$;
revoke all on function public.admin_save_kiosk_configuration(uuid,text,text) from public,anon;
grant execute on function public.admin_save_kiosk_configuration(uuid,text,text) to authenticated;
create or replace function public.verify_kiosk_pin(target_studio_id uuid,pin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.admin_kiosk_pin_attempts%rowtype; h text; valid boolean;
begin
 if not private.has_capability(target_studio_id,'attendance.write') then raise exception 'forbidden'; end if;
 insert into private.admin_kiosk_pin_attempts(studio_id,user_id) values(target_studio_id,(select auth.uid())) on conflict do nothing;
 select * into a from private.admin_kiosk_pin_attempts where studio_id=target_studio_id and user_id=(select auth.uid()) for update;
 if a.blocked_until>clock_timestamp() then return jsonb_build_object('ok',false,'blocked',true); end if;
 select pin_hash into h from private.admin_kiosk_settings where studio_id=target_studio_id;
 valid:=coalesce(pin ~ '^[0-9]{4}$' and h=extensions.crypt(pin,h),false);
 update private.admin_kiosk_pin_attempts set failures=case when valid or a.blocked_until is not null then 0 else failures+1 end,
 blocked_until=case when not valid and a.failures>=4 and a.blocked_until is null then clock_timestamp()+interval '1 minute' else null end where studio_id=target_studio_id and user_id=(select auth.uid());
 return jsonb_build_object('ok',valid);
end;
$$;
revoke all on function public.verify_kiosk_pin(uuid,text) from public,anon;
grant execute on function public.verify_kiosk_pin(uuid,text) to authenticated;
commit;
