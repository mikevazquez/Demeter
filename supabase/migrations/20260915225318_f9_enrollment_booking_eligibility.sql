create or replace function public.booking_eligibility(target_session_id uuid, target_student_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
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
  v_acquisition record;
  v_balance integer;
  v_is_staff boolean;
begin
  select * into v_session from public.class_sessions where id=target_session_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','session_not_found'); end if;

  select * into v_student from public.students where id=target_student_id and studio_id=v_session.studio_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','student_not_found'); end if;

  v_is_staff := private.has_capability(v_session.studio_id,'schedule.write');
  if not v_is_staff and not (
    v_student.user_id=(select auth.uid())
    and private.has_capability(v_session.studio_id,'student.booking.self')
  ) then raise exception 'forbidden'; end if;

  if v_student.lifecycle_status<>'active' or not v_student.active then
    return jsonb_build_object('eligible',false,'reason_code','student_not_operable');
  end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=now() then
    return jsonb_build_object('eligible',false,'reason_code','session_not_bookable');
  end if;
  if exists(
    select 1 from public.reservations r
    where r.session_id=target_session_id and r.student_id=target_student_id
      and r.status in ('reserved','attended')
  ) then return jsonb_build_object('eligible',false,'reason_code','already_reserved'); end if;

  select count(*) into v_booked_count
  from public.reservations r
  where r.session_id=target_session_id and r.status in ('reserved','attended');
  if v_booked_count>=v_session.capacity then
    return jsonb_build_object('eligible',false,'reason_code','session_full');
  end if;

  select ct.discipline_id,greatest(coalesce(ct.credit_cost,1),1)
  into v_discipline_id,v_credit_cost
  from public.class_templates ct where ct.id=v_session.template_id;

  select timezone into v_timezone from public.studios where id=v_session.studio_id;
  v_class_date := (v_session.starts_at at time zone coalesce(v_timezone,'America/Mexico_City'))::date;

  select * into v_policy from public.enrollment_policies where studio_id=v_session.studio_id;
  if found and v_policy.enabled and v_policy.required_for_booking then
    select exists(
      select 1
      from public.student_enrollments se
      where se.studio_id=v_session.studio_id
        and se.student_id=target_student_id
        and se.status='active'
        and se.starts_on<=v_class_date
        and (se.expires_on is null or se.expires_on>=v_class_date)
    ) into v_has_required_enrollment;
    if not v_has_required_enrollment then
      return jsonb_build_object('eligible',false,'reason_code','enrollment_required');
    end if;
  end if;

  select exists(
    select 1 from public.product_acquisitions pa
    where pa.studio_id=v_session.studio_id
      and pa.student_id=target_student_id
      and pa.status='active'
      and pa.starts_on<=v_class_date
      and pa.expires_on>=v_class_date
  ) into v_has_active_acquisition;
  if not v_has_active_acquisition then
    return jsonb_build_object('eligible',false,'reason_code','no_active_product');
  end if;

  select exists(
    select 1
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pa.product_template_id and ptd.studio_id=pa.studio_id
    where pa.studio_id=v_session.studio_id
      and pa.student_id=target_student_id
      and pa.status='active'
      and pa.starts_on<=v_class_date
      and pa.expires_on>=v_class_date
      and ptd.discipline_id=v_discipline_id
  ) into v_has_discipline_acquisition;
  if not v_has_discipline_acquisition then
    return jsonb_build_object('eligible',false,'reason_code','outside_product');
  end if;

  for v_acquisition in
    select pa.id,pa.unlimited,pa.expires_on
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pa.product_template_id and ptd.studio_id=pa.studio_id
    where pa.studio_id=v_session.studio_id
      and pa.student_id=target_student_id
      and pa.status='active'
      and pa.starts_on<=v_class_date
      and pa.expires_on>=v_class_date
      and ptd.discipline_id=v_discipline_id
    order by pa.unlimited desc,pa.expires_on asc,pa.created_at asc
  loop
    if v_acquisition.unlimited then
      return jsonb_build_object('eligible',true,'reason_code',null,'acquisition_id',v_acquisition.id,'unlimited',true,'available_credits',null,'credit_cost',v_credit_cost);
    end if;
    select coalesce(sum(cl.quantity),0)::integer into v_balance
    from public.credit_ledger cl where cl.acquisition_id=v_acquisition.id;
    if v_balance>=v_credit_cost then
      return jsonb_build_object('eligible',true,'reason_code',null,'acquisition_id',v_acquisition.id,'unlimited',false,'available_credits',v_balance,'credit_cost',v_credit_cost);
    end if;
  end loop;

  return jsonb_build_object('eligible',false,'reason_code','no_credits','credit_cost',v_credit_cost);
end;
$$;
