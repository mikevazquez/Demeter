-- Per-session settings and atomic edits. Existing reservations retain their
-- held credits; all booking entry points share booking_eligibility.
alter table public.class_sessions
  add column credit_cost integer check (credit_cost between 1 and 4),
  add column drop_in_price_minor integer check (drop_in_price_minor >= 0),
  add column cancellation_note text;

create or replace function public.admin_update_session(
  p_session_id uuid, p_starts_at timestamptz, p_duration_minutes integer,
  p_capacity integer, p_instructor_id uuid, p_space_id uuid,
  p_notes text, p_credit_cost integer, p_drop_in_price_minor integer,
  p_scope text default 'single'
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.class_sessions%rowtype;
  item public.class_sessions%rowtype;
  target_ids uuid[];
  shift interval;
  occupied integer;
  tz text;
begin
  select * into s from public.class_sessions where id=p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if (select auth.uid()) is null or not private.has_capability(s.studio_id,'schedule.write') then raise exception 'forbidden'; end if;
  if s.status <> 'scheduled' or s.starts_at <= now() then raise exception 'session_not_editable'; end if;
  if p_starts_at is null or p_starts_at <= now() or p_duration_minutes is null or p_duration_minutes not between 15 and 360 then raise exception 'invalid_duration'; end if;
  if p_capacity is null or p_capacity < 1 then raise exception 'invalid_capacity'; end if;
  if p_credit_cost is not null and p_credit_cost not between 1 and 4 then raise exception 'invalid_credits'; end if;
  if p_drop_in_price_minor is not null and p_drop_in_price_minor < 0 then raise exception 'invalid_price'; end if;
  if p_scope not in ('single','future') or p_scope is null then raise exception 'invalid_scope'; end if;
  if p_space_id is not null and not exists(select 1 from public.spaces where id=p_space_id and studio_id=s.studio_id and active and (capacity is null or capacity>=p_capacity)) then raise exception 'space'; end if;
  if p_instructor_id is not null and not exists(select 1 from public.instructors where id=p_instructor_id and studio_id=s.studio_id and status='active') then raise exception 'instructor'; end if;
  select coalesce(array_agg(id order by id), array[]::uuid[]) into target_ids from public.class_sessions
    where studio_id=s.studio_id and status='scheduled' and starts_at>=s.starts_at and
      (id=s.id or (p_scope='future' and s.recurring_schedule_id is not null and recurring_schedule_id=s.recurring_schedule_id));
  perform 1 from public.class_sessions where id=any(target_ids) order by id for update;
  shift:=p_starts_at-s.starts_at;
  for item in select * from public.class_sessions where id=any(target_ids) order by id loop
    select count(*) into occupied from public.reservations where session_id=item.id and status in ('reserved','attended','no_show');
    if occupied>p_capacity then raise exception 'capacity_below_reservations:%',occupied; end if;
    if item.requires_resource and item.space_id is distinct from p_space_id and exists(select 1 from public.reservation_resource_assignments where session_id=item.id and released_at is null) then raise exception 'resource_space_assigned'; end if;
    if exists(select 1 from public.class_sessions other where other.studio_id=s.studio_id and other.status='scheduled' and not(other.id=any(target_ids)) and
      other.starts_at<item.starts_at+shift+make_interval(mins=>p_duration_minutes) and other.ends_at>item.starts_at+shift and
      ((p_space_id is not null and other.space_id=p_space_id) or (p_instructor_id is not null and other.instructor_id=p_instructor_id))) then raise exception 'conflict'; end if;
  end loop;
  -- Future sessions can also conflict with one another after a duration edit.
  if exists(select 1 from public.class_sessions a join public.class_sessions b on a.id<b.id where a.id=any(target_ids) and b.id=any(target_ids)
    and a.starts_at+make_interval(mins=>p_duration_minutes)>b.starts_at
    and b.starts_at+make_interval(mins=>p_duration_minutes)>a.starts_at
    and (p_space_id is not null or p_instructor_id is not null)) then raise exception 'conflict'; end if;
  update public.class_sessions set starts_at=starts_at+shift,ends_at=starts_at+shift+make_interval(mins=>p_duration_minutes),
    capacity=p_capacity,instructor_id=p_instructor_id,space_id=p_space_id,notes=nullif(btrim(p_notes),''),
    credit_cost=p_credit_cost,drop_in_price_minor=p_drop_in_price_minor,is_schedule_exception=true where id=any(target_ids);
  if p_scope='future' and s.recurring_schedule_id is not null then
    select timezone into tz from public.studios where id=s.studio_id;
    update public.recurring_schedules set instructor_id=p_instructor_id,space_id=p_space_id,capacity=p_capacity,notes=nullif(btrim(p_notes),''),
      weekday=extract(dow from p_starts_at at time zone tz),local_time=(p_starts_at at time zone tz)::time,updated_at=now()
      where id=s.recurring_schedule_id and studio_id=s.studio_id;
  end if;
  return cardinality(target_ids);
end;
$$;
revoke all on function public.admin_update_session(uuid,timestamptz,integer,integer,uuid,uuid,text,integer,integer,text) from public,anon;
grant execute on function public.admin_update_session(uuid,timestamptz,integer,integer,uuid,uuid,text,integer,integer,text) to authenticated;

create or replace function public.admin_reopen_session(p_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype;
begin
  select * into s from public.class_sessions where id=p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if (select auth.uid()) is null or not private.has_capability(s.studio_id,'schedule.write') then raise exception 'forbidden'; end if;
  if s.status<>'cancelled' or s.starts_at<=now() then raise exception 'session_not_reopenable'; end if;
  if public.admin_session_has_conflict(s.studio_id,s.starts_at,s.ends_at,s.instructor_id,s.space_id,s.id) then raise exception 'conflict'; end if;
  update public.class_sessions set status='scheduled',is_schedule_exception=true,minimum_override=true,
    cancellation_note=null where id=s.id;
  -- Cancellation metadata is cleared by the existing audit trigger. No
  -- cancelled reservation or refunded credit is restored.
end;
$$;
revoke all on function public.admin_reopen_session(uuid) from public,anon;
grant execute on function public.admin_reopen_session(uuid) to authenticated;

create or replace function public.admin_release_reservation_resource(p_assignment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.reservation_resource_assignments%rowtype;
begin
  select * into a from public.reservation_resource_assignments where id=p_assignment_id and released_at is null;
  if not found then raise exception 'assignment_not_found'; end if;
  if (select auth.uid()) is null or not private.has_capability(a.studio_id,'resources.manage') or not private.has_capability(a.studio_id,'schedule.write') then raise exception 'forbidden'; end if;
  perform 1 from public.class_sessions where id=a.session_id for update;
  update public.reservation_resource_assignments set released_at=now(),release_reason='admin_released' where id=a.id and released_at is null;
end;
$$;
revoke all on function public.admin_release_reservation_resource(uuid) from public,anon;
grant execute on function public.admin_release_reservation_resource(uuid) to authenticated;

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

  select ct.discipline_id,greatest(coalesce(v_session.credit_cost,ct.credit_cost,1),1) into v_discipline_id,v_credit_cost
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
CREATE OR REPLACE FUNCTION public.assistant_record_trial_payment_preference(target_studio_id uuid, target_assistant_conversation_id uuid, target_payment_preference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_link public.assistant_reservation_links%rowtype;
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_preference text;
begin
  v_preference := lower(trim(coalesce(target_payment_preference,'')));

  if v_preference not in ('cash','bank_transfer') then
    return jsonb_build_object('ok',false,'reason_code','payment_method_not_supported');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into v_link
  from public.assistant_reservation_links
  where studio_id=target_studio_id
    and assistant_conversation_id=target_assistant_conversation_id
    and source='assistant_trial'
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','trial_reservation_not_found');
  end if;

  select * into v_reservation
  from public.reservations
  where id=v_link.reservation_id
    and studio_id=target_studio_id;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','reservation_not_found');
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_reservation.session_id
    and studio_id=target_studio_id;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id
    and studio_id=target_studio_id;

  update public.assistant_reservation_links
  set payment_preference=v_preference,
      payment_preference_selected_at=now()
  where id=v_link.id;

  return jsonb_build_object(
    'ok',true,
    'reservation_id',v_reservation.id,
    'payment_preference',v_preference,
    'amount_minor',coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor),
    'currency',upper(coalesce((select currency from public.studios where id=target_studio_id),'MXN')),
    'first_class_no_enrollment',true,
    'enrollment_required_after_first_attendance',true,
    'marks_payment_received',false,
    'transfer_details_configured',false
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assistant_create_post_trial_reservation(target_studio_id uuid, target_conversation_id uuid, target_student_id uuid, target_session_id uuid, target_payment_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target_session_id uuid := $4;
  v_method text := lower(trim(coalesce(target_payment_method,'')));
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_product public.product_templates%rowtype;
  v_attended integer := 0;
  v_occupied integer := 0;
  v_reservation_id uuid;
  v_intent_id uuid;
  v_existing public.assistant_enrollment_intents%rowtype;
  v_tz text;
  v_today date;
begin
  if v_method not in ('cash','bank_transfer') then
    return jsonb_build_object('ok',false,'reason_code','payment_method_not_supported');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into v_student
  from public.students s
  where s.id=target_student_id
    and s.studio_id=target_studio_id
  for update;

  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_found'); end if;
  if not v_student.active or v_student.lifecycle_status<>'active' then
    return jsonb_build_object('ok',false,'reason_code','student_not_operable');
  end if;

  select count(*)::integer into v_attended
  from public.reservations r
  where r.studio_id=target_studio_id
    and r.student_id=target_student_id
    and r.status='attended';

  if v_attended<1 then
    return jsonb_build_object('ok',false,'reason_code','post_trial_not_reached');
  end if;

  select coalesce(s.timezone,'America/Mexico_City') into v_tz
  from public.studios s
  where s.id=target_studio_id;

  v_today := (clock_timestamp() at time zone v_tz)::date;

  if private.student_has_active_enrollment(target_studio_id,target_student_id,v_today) then
    return jsonb_build_object('ok',false,'reason_code','enrollment_already_active');
  end if;

  select * into v_policy
  from public.enrollment_policies ep
  where ep.studio_id=target_studio_id;

  if not found or not v_policy.enabled or v_policy.enrollment_product_template_id is null then
    return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured');
  end if;

  select * into v_product
  from public.product_templates pt
  where pt.id=v_policy.enrollment_product_template_id
    and pt.studio_id=target_studio_id
    and pt.active=true
    and pt.product_type='enrollment'::public.product_type;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured');
  end if;

  select * into v_session
  from public.class_sessions cs
  where cs.id=v_target_session_id
    and cs.studio_id=target_studio_id
  for update;

  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=now() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;
  if coalesce(v_session.requires_resource,false) then
    return jsonb_build_object('ok',false,'reason_code','resource_selection_required');
  end if;

  select * into v_template
  from public.class_templates ct
  where ct.id=v_session.template_id
    and ct.studio_id=target_studio_id;

  select count(*)::integer into v_occupied
  from public.reservations r
  where r.session_id=v_target_session_id
    and r.status in ('reserved','attended');

  if v_occupied>=v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  if exists(
    select 1
    from public.reservations r
    where r.studio_id=target_studio_id
      and r.session_id=v_target_session_id
      and r.student_id=target_student_id
      and r.status in ('reserved','attended')
  ) then
    return jsonb_build_object('ok',false,'reason_code','already_reserved');
  end if;

  select aei.* into v_existing
  from public.assistant_enrollment_intents aei
  where aei.studio_id=target_studio_id
    and aei.student_id=target_student_id
    and aei.target_session_id=v_target_session_id
    and aei.status in ('cash_due','receipt_required','human_review','online_pending')
  order by aei.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok',true,
      'reused',true,
      'intent_id',v_existing.id,
      'reservation_id',v_existing.reservation_id,
      'payment_method',v_existing.payment_method,
      'status',v_existing.status,
      'enrollment_amount_minor',v_existing.amount_minor,
      'currency',v_existing.currency
    );
  end if;

  insert into public.reservations(
    studio_id,session_id,student_id,student_user_id,acquisition_id,
    status,credits_held,commercial_status
  )
  values(
    target_studio_id,v_target_session_id,target_student_id,v_student.user_id,null,
    'reserved',greatest(coalesce(v_template.credit_cost,1),1),'payment_pending'
  )
  returning id into v_reservation_id;

  insert into public.assistant_reservation_links(
    studio_id,reservation_id,assistant_conversation_id,source
  )
  values(
    target_studio_id,v_reservation_id,target_conversation_id,'assistant_post_trial'
  )
  on conflict(studio_id,reservation_id) do nothing;

  insert into public.assistant_enrollment_intents(
    studio_id,conversation_id,student_id,enrollment_product_template_id,
    target_session_id,reservation_id,payment_method,status,amount_minor,currency
  )
  values(
    target_studio_id,target_conversation_id,target_student_id,v_product.id,
    v_target_session_id,v_reservation_id,v_method,
    case when v_method='cash' then 'cash_due' else 'receipt_required' end,
    v_product.price_minor,upper(v_product.currency)
  )
  returning id into v_intent_id;

  perform public.emit_domain_event(
    p_studio_id=>target_studio_id,
    p_event_type=>'booking.created',
    p_source_entity_type=>'reservation',
    p_source_entity_id=>v_reservation_id,
    p_deduplication_key=>'booking.created:assistant-post-trial:'||v_reservation_id::text,
    p_actor_user_id=>(select auth.uid()),
    p_payload=>jsonb_build_object(
      'reservation_id',v_reservation_id,
      'session_id',v_target_session_id,
      'student_id',target_student_id,
      'source','assistant_post_trial',
      'commercial_status','payment_pending',
      'enrollment_payment_method',v_method
    )
  );

  return jsonb_build_object(
    'ok',true,
    'reused',false,
    'intent_id',v_intent_id,
    'reservation_id',v_reservation_id,
    'payment_method',v_method,
    'status',case when v_method='cash' then 'cash_due' else 'receipt_required' end,
    'enrollment_amount_minor',v_product.price_minor,
    'currency',upper(v_product.currency),
    'class_amount_minor',coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor),
    'review_required',v_method='bank_transfer'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_create_walkin(target_session_id uuid, p_first_name text, p_last_name text, p_phone text, p_kind text, p_payment_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.class_sessions%rowtype; result jsonb; price integer; payment jsonb; student uuid;
begin
 select * into s from public.class_sessions where id=target_session_id for update;
 if not found then raise exception 'session_not_found'; end if;
 if not private.has_capability(s.studio_id,'reservations.manage') or not private.has_capability(s.studio_id,'students.write') or not private.has_capability(s.studio_id,'sales.write') then raise exception 'forbidden'; end if;
 if p_kind not in ('trial','drop_in') or p_payment_method not in ('efectivo','transferencia','tarjeta','pay_later') then raise exception 'walkin_invalid'; end if;
 if p_phone !~ '^\+52[0-9]{10}$' then raise exception 'phone_invalid'; end if;
 if p_kind='trial' then price:=15000; else
   select coalesce(s.drop_in_price_minor,drop_in_price_minor) into price from public.class_templates where id=s.template_id and studio_id=s.studio_id;
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
$function$
;

CREATE OR REPLACE FUNCTION public.service_reselect_demi_paid_group(p_studio uuid, p_conversation uuid, p_group uuid, p_session uuid, p_resource uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare g public.demi_group_bookings%rowtype; c public.class_sessions%rowtype; price integer; curr text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if g.status not in ('awaiting_participants','partial') or (g.receipt_event_id is null and not exists(select 1 from public.demi_payment_requests where studio_id=p_studio and conversation_id=p_conversation and group_id=g.id and status='approved' and verified_at is not null)) then
  return jsonb_build_object('ok',false,'reason_code','verified_payment_required'); end if;
 if exists(select 1 from public.demi_group_participants where group_id=g.id and (reservation_id is not null or transfer_intent_id is not null or allocated_minor>0)) then
  return jsonb_build_object('ok',false,'reason_code','group_already_allocated'); end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.capacity-(select count(*) from public.reservations where studio_id=p_studio and session_id=c.id and status in ('reserved','attended'))<g.participant_count then return jsonb_build_object('ok',false,'reason_code','session_full'); end if;
 if c.requires_resource then
  if p_resource is null then return jsonb_build_object('ok',false,'reason_code','resource_selection_required'); end if;
  if not exists(select 1 from public.session_resources sr join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id where sr.studio_id=p_studio and sr.session_id=p_session and sr.resource_id=p_resource and sr.enabled and r.active and coalesce(sr.capacity_override,c.resource_uses_per_item,1)>(select count(*) from public.reservation_resource_assignments ra where ra.studio_id=p_studio and ra.session_id=p_session and ra.resource_id=p_resource and ra.released_at is null)) then return jsonb_build_object('ok',false,'reason_code','resource_not_available'); end if;
 elsif p_resource is not null then return jsonb_build_object('ok',false,'reason_code','resource_not_required'); end if;
 select coalesce(c.drop_in_price_minor,drop_in_price_minor) into price from public.class_templates where id=c.template_id and studio_id=p_studio;
 select currency into curr from public.studios where id=p_studio;
 if coalesce(price,0)<=0 or price*g.transfer_count<>g.amount_minor or curr<>g.currency then
  return jsonb_build_object('ok',false,'reason_code','paid_amount_does_not_match_alternative'); end if;
 update public.demi_group_bookings set session_id=p_session,resource_id=p_resource,status='awaiting_participants' where id=g.id;
 return jsonb_build_object('ok',true,'group_id',g.id,'status','awaiting_participants','amount_minor',g.amount_minor,'currency',g.currency,'participant_count',g.participant_count,'payment_preserved',true,'reservation_confirmed',false);
end; $function$
;

CREATE OR REPLACE FUNCTION public.student_create_evaluation_checkout_attempt(target_invitation_id uuid, target_session_id uuid, target_product_template_id uuid, target_client_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_invitation public.evaluation_invitations%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_enrollment_product public.product_templates%rowtype;
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_timezone text;
  v_today date;
  v_class_date date;
  v_price jsonb;
  v_extra jsonb := null;
  v_extra_price integer := 0;
  v_has_enrollment boolean := false;
  v_is_single boolean := target_product_template_id is null;
  v_booked_count integer;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_invitation_id is null then raise exception 'evaluation_invitation_required'; end if;
  if target_session_id is null then raise exception 'session_required'; end if;
  if target_client_request_key is null then raise exception 'request_key_required'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;
  if not found then raise exception 'student_context_not_found'; end if;

  select ei.* into v_invitation
  from public.evaluation_invitations ei
  where ei.id=target_invitation_id
    and ei.student_id=v_student.id
    and ei.studio_id=v_student.studio_id
    and ei.status='pending_schedule';
  if not found then raise exception 'evaluation_invitation_not_schedulable'; end if;

  select cs.* into v_session
  from public.class_sessions cs
  where cs.id=target_session_id
    and cs.studio_id=v_student.studio_id
    and cs.status='scheduled'
    and cs.starts_at>now();
  if not found then raise exception 'session_not_bookable'; end if;

  select ct.* into v_template
  from public.class_templates ct
  where ct.id=v_session.template_id
    and ct.studio_id=v_student.studio_id
    and ct.active=true;
  if not found then raise exception 'activity_not_available'; end if;

  if v_template.discipline_id is distinct from v_invitation.discipline_id then
    raise exception 'evaluation_session_wrong_discipline';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_class_date := (v_session.starts_at at time zone v_timezone)::date;

  if v_class_date < v_invitation.window_start or v_class_date > v_invitation.window_end then
    raise exception 'evaluation_session_outside_window';
  end if;

  select count(*)::integer into v_booked_count
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  if v_booked_count>=v_session.capacity then raise exception 'session_full'; end if;

  select * into v_policy
  from public.enrollment_policies
  where studio_id=v_student.studio_id;

  select exists(
    select 1
    from public.student_enrollments se
    where se.studio_id=v_student.studio_id
      and se.student_id=v_student.id
      and se.status='active'
      and se.starts_on<=v_class_date
      and (se.expires_on is null or se.expires_on>=v_class_date)
  ) into v_has_enrollment;

  if v_is_single then
    if coalesce(coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor),0)<=0 then
      raise exception 'single_class_price_missing';
    end if;

    select pt.* into v_product
    from public.product_templates pt
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pt.id
     and ptd.studio_id=pt.studio_id
    where pt.studio_id=v_student.studio_id
      and pt.product_type='single_class'::public.product_type
      and pt.active=true
      and pt.online_purchasable=true
      and pt.price_minor=coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor)
      and coalesce(pt.credit_limit,0)=1
      and coalesce(pt.validity_days,0)>0
      and ptd.discipline_id=v_template.discipline_id
    order by pt.created_at asc
    limit 1;

    if not found then raise exception 'single_class_product_not_available'; end if;
  else
    select pt.* into v_product
    from public.product_templates pt
    where pt.id=target_product_template_id
      and pt.studio_id=v_student.studio_id
      and pt.active=true
      and pt.product_type::text in ('package','membership','enrollment')
      and (
        pt.product_type='enrollment'::public.product_type
        or pt.online_purchasable=true
      );

    if not found then raise exception 'product_not_available_online'; end if;

    if v_product.product_type::text in ('package','membership') then
      if not exists (
        select 1
        from public.product_template_disciplines ptd
        where ptd.studio_id=v_student.studio_id
          and ptd.product_template_id=v_product.id
          and ptd.discipline_id=v_template.discipline_id
      ) then
        raise exception 'product_not_available_online';
      end if;
    elsif v_product.product_type::text='enrollment' then
      if v_policy.enrollment_product_template_id is distinct from v_product.id then
        raise exception 'enrollment_product_not_configured';
      end if;
      if not v_policy.enabled or not v_policy.required_for_booking then
        raise exception 'enrollment_not_required';
      end if;
      if v_has_enrollment then
        raise exception 'enrollment_not_required';
      end if;
    end if;
  end if;

  if v_product.price_minor<=0 then raise exception 'online_price_invalid'; end if;
  if v_product.validity_days is null or v_product.validity_days<=0 then
    raise exception 'product_validity_missing';
  end if;

  if v_product.product_type::text='enrollment' then
    v_price := jsonb_build_object(
      'regular_amount_minor',v_product.price_minor,
      'final_amount_minor',v_product.price_minor,
      'discount_minor',0,
      'discount_pct',0,
      'level_key',null,
      'level_title',null,
      'discount_family',null
    );
  else
    v_price := private.reward_checkout_price(v_student.id,v_product.id,v_today);
  end if;

  if v_product.product_type::text <> 'enrollment'
     and v_policy.enabled
     and v_policy.required_for_booking
     and not v_has_enrollment then
    select * into v_enrollment_product
    from public.product_templates pt
    where pt.id=v_policy.enrollment_product_template_id
      and pt.studio_id=v_student.studio_id
      and pt.active=true
      and pt.product_type='enrollment'::public.product_type;

    if not found then raise exception 'enrollment_product_not_configured'; end if;
    if coalesce(v_enrollment_product.price_minor,0)<=0 then
      raise exception 'online_price_invalid';
    end if;

    v_extra_price := v_enrollment_product.price_minor;
    v_extra := jsonb_build_object(
      'type','enrollment',
      'product_template_id',v_enrollment_product.id,
      'name',v_enrollment_product.name,
      'price_minor',v_enrollment_product.price_minor,
      'currency',upper(v_enrollment_product.currency),
      'validity_days',v_enrollment_product.validity_days
    );
  end if;

  insert into public.online_checkout_attempts(
    id,studio_id,student_id,product_template_id,session_id,provider,
    client_request_key,external_reference,amount_minor,currency,
    product_name_snapshot,validity_days_snapshot,credit_limit_snapshot,
    unlimited_snapshot,package_term_snapshot,regular_amount_minor,
    reward_discount_minor,reward_discount_pct,reward_level_key_snapshot,
    reward_level_title_snapshot,reward_discount_family_snapshot,
    extra_fulfillment_snapshot
  ) values (
    v_attempt_id,v_student.studio_id,v_student.id,v_product.id,v_session.id,
    'mercado_pago',target_client_request_key,'STFLOW-MP-'||v_attempt_id::text,
    (v_price->>'final_amount_minor')::integer + v_extra_price,
    upper(v_product.currency),v_product.name,v_product.validity_days,
    v_product.credit_limit,v_product.unlimited,v_product.package_term,
    (v_price->>'regular_amount_minor')::integer + v_extra_price,
    (v_price->>'discount_minor')::integer,
    (v_price->>'discount_pct')::integer,
    v_price->>'level_key',v_price->>'level_title',
    v_price->>'discount_family',v_extra
  )
  on conflict(student_id,client_request_key) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then
    select * into v_attempt
    from public.online_checkout_attempts
    where student_id=v_student.id
      and client_request_key=target_client_request_key;

    if v_attempt.product_template_id<>v_product.id
       or v_attempt.session_id is distinct from v_session.id then
      raise exception 'request_key_reused_for_different_purchase';
    end if;
  end if;

  return jsonb_build_object(
    'id',v_attempt.id,
    'external_reference',v_attempt.external_reference,
    'product_template_id',v_attempt.product_template_id,
    'session_id',v_attempt.session_id,
    'amount_minor',v_attempt.amount_minor,
    'regular_amount_minor',v_attempt.regular_amount_minor,
    'reward_discount_minor',v_attempt.reward_discount_minor,
    'reward_discount_pct',v_attempt.reward_discount_pct,
    'reward_level_key',v_attempt.reward_level_key_snapshot,
    'reward_level_title',v_attempt.reward_level_title_snapshot,
    'reward_discount_family',v_attempt.reward_discount_family_snapshot,
    'currency',v_attempt.currency,
    'status',v_attempt.status::text,
    'provider_order_id',v_attempt.provider_order_id,
    'checkout_url',v_attempt.checkout_url,
    'extra_fulfillment_snapshot',v_attempt.extra_fulfillment_snapshot,
    'created_at',v_attempt.created_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.service_prepare_demi_prospect_payment(p_studio uuid, p_conversation uuid, p_contact uuid, p_session uuid, p_resource uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare identity_check jsonb; c public.class_sessions%rowtype; g public.demi_group_bookings%rowtype; preview jsonb; amount integer; curr text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 identity_check:=public.service_check_demi_minimal_identity(p_studio,p_conversation);
 if not coalesce((identity_check->>'ok')::boolean,false) then return identity_check; end if;
 if not exists(select 1 from public.assistant_conversations ac join public.crm_contacts cc on cc.id=p_contact and cc.studio_id=ac.studio_id where ac.id=p_conversation and ac.studio_id=p_studio and ac.student_id is null and ac.context->>'crm_contact_id'=p_contact::text) then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status in ('awaiting_receipt','awaiting_participants','partial') for update;
 if found then
  if g.prospect_contact_id is distinct from p_contact then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
  if g.session_id<>p_session or g.resource_id is distinct from p_resource then
   return public.service_reselect_demi_paid_group(p_studio,p_conversation,g.id,p_session,p_resource);
  end if;
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',1,'idempotent',true);
 end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.requires_resource then
  if p_resource is null then return jsonb_build_object('ok',false,'reason_code','resource_selection_required'); end if;
  if not exists(select 1 from public.session_resources sr join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id where sr.studio_id=p_studio and sr.session_id=p_session and sr.resource_id=p_resource and sr.enabled and r.active and coalesce(sr.capacity_override,c.resource_uses_per_item,1)>(select count(*) from public.reservation_resource_assignments ra where ra.studio_id=p_studio and ra.session_id=p_session and ra.resource_id=p_resource and ra.released_at is null)) then return jsonb_build_object('ok',false,'reason_code','resource_not_available'); end if;
 elsif p_resource is not null then return jsonb_build_object('ok',false,'reason_code','resource_not_required'); end if;
 preview:=public.assistant_trial_booking_preview(p_studio,p_session,null,p_contact);
 if not coalesce((preview->>'eligible')::boolean,false) then return preview||jsonb_build_object('ok',false); end if;
 amount:=coalesce((preview->>'amount_minor')::integer,(select coalesce(c.drop_in_price_minor,drop_in_price_minor) from public.class_templates where id=c.template_id and studio_id=p_studio));
 select currency into curr from public.studios where id=p_studio;
 if coalesce(amount,0)<=0 then return jsonb_build_object('ok',false,'reason_code','price_not_configured'); end if;
 insert into public.demi_group_bookings(studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency,prospect_contact_id,resource_id) values(p_studio,p_conversation,p_session,1,1,amount,curr,p_contact,p_resource) returning * into g;
 return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',1,'reservation_confirmed',false);
end; $function$
;

CREATE OR REPLACE FUNCTION public.student_create_single_class_checkout_attempt(target_session_id uuid, target_client_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_enrollment_product public.product_templates%rowtype;
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_timezone text;
  v_today date;
  v_price jsonb;
  v_blockers jsonb;
  v_enrollment_requirement jsonb;
  v_extra jsonb := null;
  v_extra_price integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_session_id is null then raise exception 'session_required'; end if;
  if target_client_request_key is null then raise exception 'request_key_required'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select cs.* into v_session
  from public.class_sessions cs
  where cs.id=target_session_id
    and cs.studio_id=v_student.studio_id
    and cs.status='scheduled'
    and cs.starts_at>now();

  if not found then raise exception 'session_not_bookable'; end if;

  v_blockers := private.student_booking_blockers(v_student.id, v_session.id);
  if jsonb_array_length(coalesce(v_blockers,'[]'::jsonb)) > 0 then
    raise exception '%', coalesce(v_blockers->0->>'code','account_restricted');
  end if;

  if (
    select count(*)
    from public.reservations r
    where r.session_id=v_session.id
      and r.status in ('reserved','attended')
  ) >= v_session.capacity then
    raise exception 'session_full';
  end if;

  select ct.* into v_template
  from public.class_templates ct
  where ct.id=v_session.template_id
    and ct.studio_id=v_student.studio_id
    and ct.active=true;

  if not found then raise exception 'activity_not_available'; end if;
  if coalesce(coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor),0)<=0 then
    raise exception 'single_class_price_missing';
  end if;

  select pt.* into v_product
  from public.product_templates pt
  join public.product_template_disciplines ptd
    on ptd.product_template_id=pt.id
   and ptd.studio_id=pt.studio_id
  where pt.studio_id=v_student.studio_id
    and pt.product_type='single_class'::public.product_type
    and pt.active=true
    and pt.online_purchasable=true
    and pt.price_minor=coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor)
    and coalesce(pt.credit_limit,0)=1
    and coalesce(pt.validity_days,0)>0
    and ptd.discipline_id=v_template.discipline_id
  order by pt.created_at asc
  limit 1;

  if not found then raise exception 'single_class_product_not_available'; end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  v_price := private.reward_checkout_price(v_student.id,v_product.id,v_today);

  v_enrollment_requirement :=
    public.student_enrollment_checkout_requirement(target_session_id);

  if coalesce((v_enrollment_requirement->>'missing')::boolean,false) then
    select pt.* into v_enrollment_product
    from public.product_templates pt
    where pt.id=(v_enrollment_requirement->>'product_template_id')::uuid
      and pt.studio_id=v_student.studio_id
      and pt.active=true
      and pt.product_type='enrollment'::public.product_type;

    if not found then raise exception 'enrollment_product_not_configured'; end if;
    if coalesce(v_enrollment_product.price_minor,0)<=0 then
      raise exception 'online_price_invalid';
    end if;
    if upper(v_enrollment_product.currency)<>upper(v_product.currency) then
      raise exception 'enrollment_currency_mismatch';
    end if;

    v_extra_price := v_enrollment_product.price_minor;
    v_extra := jsonb_build_object(
      'type','enrollment',
      'product_template_id',v_enrollment_product.id,
      'name',v_enrollment_product.name,
      'price_minor',v_enrollment_product.price_minor,
      'currency',upper(v_enrollment_product.currency),
      'validity_days',v_enrollment_product.validity_days
    );
  end if;

  insert into public.online_checkout_attempts(
    id,studio_id,student_id,product_template_id,session_id,provider,
    client_request_key,external_reference,amount_minor,currency,
    product_name_snapshot,validity_days_snapshot,credit_limit_snapshot,
    unlimited_snapshot,package_term_snapshot,regular_amount_minor,
    reward_discount_minor,reward_discount_pct,reward_level_key_snapshot,
    reward_level_title_snapshot,reward_discount_family_snapshot,
    extra_fulfillment_snapshot
  ) values (
    v_attempt_id,v_student.studio_id,v_student.id,v_product.id,v_session.id,
    'mercado_pago',target_client_request_key,'STFLOW-MP-'||v_attempt_id::text,
    (v_price->>'final_amount_minor')::integer + v_extra_price,
    upper(v_product.currency),v_product.name,v_product.validity_days,
    v_product.credit_limit,v_product.unlimited,v_product.package_term,
    (v_price->>'regular_amount_minor')::integer + v_extra_price,
    (v_price->>'discount_minor')::integer,
    (v_price->>'discount_pct')::integer,
    v_price->>'level_key',
    v_price->>'level_title',
    v_price->>'discount_family',
    v_extra
  )
  on conflict(student_id,client_request_key) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then
    select * into v_attempt
    from public.online_checkout_attempts
    where student_id=v_student.id
      and client_request_key=target_client_request_key;

    if v_attempt.product_template_id<>v_product.id
       or v_attempt.session_id is distinct from v_session.id then
      raise exception 'request_key_reused_for_different_purchase';
    end if;
  end if;

  return jsonb_build_object(
    'id',v_attempt.id,
    'external_reference',v_attempt.external_reference,
    'product_template_id',v_attempt.product_template_id,
    'session_id',v_attempt.session_id,
    'amount_minor',v_attempt.amount_minor,
    'regular_amount_minor',v_attempt.regular_amount_minor,
    'reward_discount_minor',v_attempt.reward_discount_minor,
    'reward_discount_pct',v_attempt.reward_discount_pct,
    'reward_level_key',v_attempt.reward_level_key_snapshot,
    'reward_level_title',v_attempt.reward_level_title_snapshot,
    'reward_discount_family',v_attempt.reward_discount_family_snapshot,
    'currency',v_attempt.currency,
    'status',v_attempt.status::text,
    'provider_order_id',v_attempt.provider_order_id,
    'checkout_url',v_attempt.checkout_url,
    'extra_fulfillment_snapshot',v_attempt.extra_fulfillment_snapshot,
    'created_at',v_attempt.created_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.service_get_demi_first_class_payment_options(p_studio uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare link public.demi_first_class_payment_links%rowtype; price integer; curr text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select coalesce(cs.drop_in_price_minor,ct.drop_in_price_minor),st.currency into price,curr from public.class_sessions cs join public.class_templates ct on ct.id=cs.template_id and ct.studio_id=cs.studio_id join public.studios st on st.id=cs.studio_id where cs.id=p_session and cs.studio_id=p_studio and cs.status='scheduled';
 if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
 select l.* into link from public.demi_first_class_payment_links l join public.class_sessions cs on cs.template_id=l.class_template_id and cs.studio_id=l.studio_id where cs.id=p_session and cs.studio_id=p_studio and l.enabled and l.amount_minor=price and l.currency=upper(curr);
 return jsonb_build_object('ok',true,'external_checkout',case when found then jsonb_build_object('provider','mercado_pago','url',link.checkout_url,'amount_minor',link.amount_minor,'currency',link.currency,'receipt_required',true,'test_only',exists(select 1 from public.demi_uat_runs where studio_id=p_studio)) else null end);
end; $function$
;

CREATE OR REPLACE FUNCTION public.service_prepare_demi_group(p_studio uuid, p_conversation uuid, p_session uuid, p_count integer, p_transfer_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare identity_check jsonb; c public.class_sessions%rowtype; g public.demi_group_bookings%rowtype; price integer; curr text; n integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 identity_check:=public.service_check_demi_minimal_identity(p_studio,p_conversation);
 if not coalesce((identity_check->>'ok')::boolean,false) then return identity_check; end if;
 if p_count not between 1 and 10 or p_transfer_count not between 1 and p_count then return jsonb_build_object('ok',false,'reason_code','invalid_count'); end if;
 if not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio) then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status in ('awaiting_receipt','awaiting_participants','partial') for update;
 if found then
  if g.participant_count<>p_count or g.transfer_count<>p_transfer_count then return jsonb_build_object('ok',false,'reason_code','group_already_pending'); end if;
  if g.session_id<>p_session then return public.service_reselect_demi_paid_group(p_studio,p_conversation,g.id,p_session,null); end if;
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'idempotent',true);
 end if;
 -- A retry of a completed group recovers the existing receipt and current reservations, never a new charge.
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and session_id=p_session and participant_count=p_count and transfer_count=p_transfer_count and status in ('provisional','validated') order by created_at desc limit 1 for update;
 if found then
  select count(*) into n from public.demi_group_participants gp join public.reservations r on r.id=gp.reservation_id and r.studio_id=p_studio where gp.group_id=g.id and r.status='reserved';
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',g.participant_count,'reserved_count',n,'reservation_confirmed',n=g.participant_count,'receipt_received',true,'payment_required',false,'payment_validation_required',g.status='provisional','existing_group_requires_review',n<>g.participant_count,'idempotent',true);
 end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.requires_resource then return jsonb_build_object('ok',false,'reason_code','group_resource_selection_required'); end if;
 if c.capacity-(select count(*) from public.reservations where session_id=c.id and status in ('reserved','attended'))<p_count then return jsonb_build_object('ok',false,'reason_code','session_full'); end if;
 select coalesce(c.drop_in_price_minor,drop_in_price_minor) into price from public.class_templates where id=c.template_id and studio_id=p_studio;
 select currency into curr from public.studios where id=p_studio;
 if coalesce(price,0)<=0 then return jsonb_build_object('ok',false,'reason_code','price_not_configured'); end if;
 insert into public.demi_group_bookings(studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency)
 values(p_studio,p_conversation,p_session,p_count,p_transfer_count,price*p_transfer_count,curr) returning * into g;
 return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'reservation_confirmed',false);
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_asistian_class_payment_and_attendance(target_reservation_id uuid, payment_method text, payment_reference text DEFAULT NULL::text, payment_amount_minor integer DEFAULT NULL::integer)
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

  select *
    into v_reservation
  from public.reservations
  where id = target_reservation_id
  for update;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write') then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from public.asistian_booking_links abl
    where abl.reservation_id = v_reservation.id
      and abl.studio_id = v_reservation.studio_id
  ) then
    raise exception 'reservation_not_asistian';
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

  if now() < v_session.starts_at then
    raise exception 'session_not_started';
  end if;

  if now() >= v_session.ends_at then
    raise exception 'session_ended';
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

  if coalesce(coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor), 0) > 0 then
    v_amount := coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor);
  else
    if not private.has_capability(v_reservation.studio_id, 'sales.write') then
      raise exception 'class_price_required';
    end if;
    v_amount := payment_amount_minor;
  end if;

  if coalesce(v_amount, 0) <= 0 then
    raise exception 'class_price_required';
  end if;

  select coalesce(s.timezone, 'America/Mexico_City'),
         s.currency
    into v_timezone, v_currency
  from public.studios s
  where s.id = v_reservation.studio_id;

  v_class_date := (v_session.starts_at at time zone v_timezone)::date;
  v_folio := 'AS-' || to_char(v_class_date, 'YYYYMMDD') || '-' ||
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
    'Cobro de clase pendiente proveniente de Asistian',
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
      status = 'attended',
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
        'resolution_source', 'asistian_attendance_payment',
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
    'status', 'attended',
    'commercial_status', 'paid'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_reward_single_class_price(target_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_timezone text;
  v_today date;
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

  select * into v_session
  from public.class_sessions
  where id=target_session_id
    and studio_id=v_student.studio_id
    and status='scheduled'
    and starts_at>now();

  if not found then
    raise exception 'session_not_bookable';
  end if;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id
    and studio_id=v_student.studio_id
    and active=true;

  if not found or coalesce(coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor),0)<=0 then
    raise exception 'single_class_price_missing';
  end if;

  select pt.* into v_product
  from public.product_templates pt
  join public.product_template_disciplines ptd
    on ptd.product_template_id=pt.id
   and ptd.studio_id=pt.studio_id
  where pt.studio_id=v_student.studio_id
    and pt.product_type='single_class'::public.product_type
    and pt.active=true
    and pt.online_purchasable=true
    and pt.price_minor=coalesce(v_session.drop_in_price_minor,v_template.drop_in_price_minor)
    and coalesce(pt.credit_limit,0)=1
    and coalesce(pt.validity_days,0)>0
    and ptd.discipline_id=v_template.discipline_id
  order by pt.created_at asc
  limit 1;

  if not found then
    raise exception 'single_class_product_not_available';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;

  return private.reward_checkout_price(
    v_student.id,
    v_product.id,
    v_today
  ) || jsonb_build_object('session_id',v_session.id);
end;
$function$
;

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

  v_amount := coalesce(payment_amount_minor,v_reservation.class_amount_minor,v_session.drop_in_price_minor,v_template.drop_in_price_minor);

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

CREATE OR REPLACE FUNCTION public.admin_book_drop_in(target_session_id uuid, target_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.class_sessions%rowtype; result jsonb; price integer;
begin
 select * into s from public.class_sessions where id=target_session_id for update;
 if not found then raise exception 'session_not_found'; end if;
 if not private.has_capability(s.studio_id,'reservations.manage') then raise exception 'forbidden'; end if;
 select coalesce(s.drop_in_price_minor,drop_in_price_minor) into price from public.class_templates where id=s.template_id and studio_id=s.studio_id;
 if coalesce(price,0)<=0 then raise exception 'drop_in_not_available'; end if;
 result := public.add_existing_walkin_student(target_session_id,target_student_id);
 if coalesce((result->>'commercial_pending')::boolean,false) then
   update public.reservations set commercial_status='payment_pending',class_kind='drop_in',class_amount_minor=price where id=(result->>'reservation_id')::uuid;
 end if;
 return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_session_detail(target_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_result jsonb;
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

  select s.*
    into v_student
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if not found then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'session_id', cs.id,
    'starts_at', cs.starts_at,
    'ends_at', cs.ends_at,
    'capacity', cs.capacity,
    'spots_available', greatest(
      cs.capacity - (
        select count(*)
        from public.reservations r
        where r.session_id = cs.id
          and r.status in ('reserved', 'attended')
      ),
      0
    ),
    'activity', ct.name,
    'discipline_id', d.id,
    'discipline', d.name,
    'credit_cost', greatest(coalesce(ct.credit_cost, 1), 1),
    'drop_in_price_minor', coalesce(v_session.drop_in_price_minor,ct.drop_in_price_minor),
    'space', sp.name,
    'location', sl.name,
    'coach', nullif(trim(concat_ws(' ', ip.first_name, ip.last_name)), ''),
    'description', cs.notes,
    'requires_resource', cs.requires_resource,
    'resource_uses_per_item', cs.resource_uses_per_item,
    'eligibility', public.booking_eligibility(cs.id, v_student.id),
    'reservation_id', (
      select r.id
      from public.reservations r
      where r.session_id = cs.id
        and r.student_id = v_student.id
        and r.status in ('reserved', 'attended')
      order by r.booked_at desc
      limit 1
    )
  )
    into v_result
  from public.class_sessions cs
  join public.class_templates ct on ct.id = cs.template_id
  join public.disciplines d on d.id = ct.discipline_id
  left join public.spaces sp on sp.id = cs.space_id
  left join public.studio_locations sl on sl.id = cs.location_id
  left join public.instructors i on i.id = cs.instructor_id
  left join public.persons ip on ip.id = i.person_id
  where cs.id = target_session_id;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_save_session_resources(p_session_id uuid, p_default_uses integer, p_resource_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_item jsonb;
  v_resource_id uuid;
  v_enabled boolean;
  v_capacity_override integer;
  v_saved integer := 0;
  v_released integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if p_default_uses is null or p_default_uses < 1 or p_default_uses > 20 then
    raise exception 'invalid_resource_uses';
  end if;

  if p_resource_settings is null or jsonb_typeof(p_resource_settings) <> 'array' then
    raise exception 'invalid_resource_settings';
  end if;

  if jsonb_array_length(p_resource_settings) > 250 then
    raise exception 'too_many_resource_settings';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_session.studio_id, 'schedule.write')
     or not private.has_capability(v_session.studio_id, 'resources.manage') then
    raise exception 'forbidden';
  end if;

  if not v_session.requires_resource then
    raise exception 'session_does_not_require_resource';
  end if;

  if v_session.space_id is null then
    raise exception 'resource_session_requires_space';
  end if;

  update public.class_sessions
  set
    resource_uses_per_item = p_default_uses
  where id = v_session.id;

  update public.session_resources sr
  set enabled = false,
      capacity_override = null,
      updated_at = now()
  where sr.session_id = v_session.id
    and not exists (
      select 1
      from jsonb_array_elements(p_resource_settings) item
      where nullif(item->>'resource_id', '')::uuid = sr.resource_id
    );

  for v_item in
    select value
    from jsonb_array_elements(p_resource_settings)
  loop
    v_resource_id := nullif(v_item->>'resource_id', '')::uuid;
    v_enabled := coalesce((v_item->>'enabled')::boolean, false);
    v_capacity_override := case
      when nullif(v_item->>'capacity_override', '') is null then null
      else (v_item->>'capacity_override')::integer
    end;

    if v_resource_id is null then
      raise exception 'invalid_resource_id';
    end if;

    if v_capacity_override is not null
      and (v_capacity_override < 1 or v_capacity_override > 20) then
      raise exception 'invalid_resource_capacity';
    end if;

    if not exists (
      select 1
      from public.resources r
      where r.id = v_resource_id
        and r.studio_id = v_session.studio_id
        and r.space_id = v_session.space_id
    ) then
      raise exception 'resource_not_in_session_space';
    end if;

    insert into public.session_resources (
      studio_id,
      session_id,
      resource_id,
      enabled,
      capacity_override
    )
    values (
      v_session.studio_id,
      v_session.id,
      v_resource_id,
      v_enabled,
      v_capacity_override
    )
    on conflict (session_id, resource_id)
    do update set
      enabled = excluded.enabled,
      capacity_override = excluded.capacity_override,
      updated_at = now();

    v_saved := v_saved + 1;
  end loop;

  with ranked as (
    select a.id,row_number() over(partition by a.resource_id order by a.created_at,a.id) as rn,
      case when coalesce(sr.enabled,false) then coalesce(sr.capacity_override,p_default_uses) else 0 end as available
    from public.reservation_resource_assignments a
    left join public.session_resources sr on sr.session_id=a.session_id and sr.resource_id=a.resource_id
    where a.session_id=v_session.id and a.released_at is null
  ) update public.reservation_resource_assignments set released_at=now(),release_reason='session_resource_disabled'
    where id in (select id from ranked where rn>available);
  get diagnostics v_released = row_count;
  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'default_uses', p_default_uses,
    'resource_count', v_saved,
    'released_assignments',v_released,
    'customized', true
  );
end;
$function$
;
