create or replace function public.student_portal_snapshot()
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_person public.persons%rowtype;
  v_studio public.studios%rowtype;
  v_timezone text;
  v_profile jsonb;
  v_acquisitions jsonb;
  v_upcoming jsonb;
  v_enrollment jsonb;
  v_movements jsonb;
  v_payments jsonb;
  v_attended_total integer := 0;
  v_attended_month integer := 0;
  v_favorite text;
  v_streak integer := 0;
  v_expected date;
  v_date date;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;
  if not found then raise exception 'student_context_not_found'; end if;

  if not private.has_capability(v_student.studio_id,'student.portal') then raise exception 'forbidden'; end if;

  select * into v_person from public.persons where id=v_student.person_id and studio_id=v_student.studio_id;
  select * into v_studio from public.studios where id=v_student.studio_id;
  v_timezone := coalesce(v_studio.timezone,'America/Mexico_City');

  v_profile := jsonb_build_object(
    'student_id',v_student.id,
    'studio_id',v_student.studio_id,
    'studio_name',v_studio.name,
    'first_name',coalesce(v_person.first_name,split_part(v_student.full_name,' ',1)),
    'last_name',v_person.last_name,
    'full_name',v_student.full_name,
    'phone',v_student.phone,
    'email',v_student.email,
    'profile_status',v_student.profile_status::text,
    'lifecycle_status',v_student.lifecycle_status::text
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',pa.id,
      'product_id',pt.id,
      'name',pt.name,
      'product_type',pt.product_type::text,
      'package_term',pt.package_term,
      'status',pa.status::text,
      'starts_on',pa.starts_on,
      'expires_on',pa.expires_on,
      'unlimited',pa.unlimited,
      'credit_limit',pa.credit_limit,
      'available_credits',case when pa.unlimited then null else public.acquisition_credit_balance(pa.id) end,
      'reserved_credits',coalesce((select sum(r.credits_held)::integer from public.reservations r where r.acquisition_id=pa.id and r.status='reserved'),0),
      'used_credits',coalesce((select -sum(cl.quantity)::integer from public.credit_ledger cl where cl.acquisition_id=pa.id and cl.movement_type='consume'),0),
      'active_now',(pa.status='active' and pa.starts_on<=((now() at time zone v_timezone)::date) and pa.expires_on>=((now() at time zone v_timezone)::date))
    ) order by
      case when pa.status='active' and pa.starts_on<=((now() at time zone v_timezone)::date) and pa.expires_on>=((now() at time zone v_timezone)::date) then 0 else 1 end,
      pa.expires_on asc,
      pa.created_at desc
  ),'[]'::jsonb)
  into v_acquisitions
  from public.product_acquisitions pa
  join public.product_templates pt on pt.id=pa.product_template_id
  where pa.student_id=v_student.id and pa.studio_id=v_student.studio_id;

  select jsonb_build_object(
    'id',se.id,
    'status',se.status::text,
    'starts_on',se.starts_on,
    'expires_on',se.expires_on,
    'active_now',(se.status='active' and se.starts_on<=((now() at time zone v_timezone)::date) and (se.expires_on is null or se.expires_on>=((now() at time zone v_timezone)::date)))
  ) into v_enrollment
  from public.student_enrollments se
  where se.student_id=v_student.id and se.studio_id=v_student.studio_id
  order by
    case when se.status='active' and se.starts_on<=((now() at time zone v_timezone)::date) and (se.expires_on is null or se.expires_on>=((now() at time zone v_timezone)::date)) then 0 else 1 end,
    se.created_at desc
  limit 1;

  select coalesce(jsonb_agg(item order by starts_at),'[]'::jsonb) into v_upcoming
  from (
    select
      cs.starts_at,
      jsonb_build_object(
        'reservation_id',r.id,
        'session_id',cs.id,
        'status',r.status::text,
        'starts_at',cs.starts_at,
        'ends_at',cs.ends_at,
        'activity',ct.name,
        'discipline',d.name,
        'space',sp.name,
        'coach',nullif(trim(concat_ws(' ',ip.first_name,ip.last_name)),'')
      ) as item
    from public.reservations r
    join public.class_sessions cs on cs.id=r.session_id
    join public.class_templates ct on ct.id=cs.template_id
    join public.disciplines d on d.id=ct.discipline_id
    left join public.spaces sp on sp.id=cs.space_id
    left join public.instructors i on i.id=cs.instructor_id
    left join public.persons ip on ip.id=i.person_id
    where r.student_id=v_student.id
      and r.studio_id=v_student.studio_id
      and r.status='reserved'
      and cs.starts_at>=now()
    order by cs.starts_at
    limit 5
  ) q;

  select count(*)::integer into v_attended_total
  from public.reservations r
  where r.student_id=v_student.id and r.studio_id=v_student.studio_id and r.status='attended';

  select count(*)::integer into v_attended_month
  from public.reservations r
  join public.class_sessions cs on cs.id=r.session_id
  where r.student_id=v_student.id
    and r.studio_id=v_student.studio_id
    and r.status='attended'
    and date_trunc('month',cs.starts_at at time zone v_timezone)=date_trunc('month',now() at time zone v_timezone);

  select ct.name into v_favorite
  from public.reservations r
  join public.class_sessions cs on cs.id=r.session_id
  join public.class_templates ct on ct.id=cs.template_id
  where r.student_id=v_student.id and r.studio_id=v_student.studio_id and r.status='attended'
  group by ct.id,ct.name
  order by count(*) desc,ct.name asc
  limit 1;

  for v_date in
    select distinct (cs.starts_at at time zone v_timezone)::date as attendance_date
    from public.reservations r
    join public.class_sessions cs on cs.id=r.session_id
    where r.student_id=v_student.id and r.studio_id=v_student.studio_id and r.status='attended'
    order by attendance_date desc
  loop
    if v_expected is null then
      v_streak := 1;
      v_expected := v_date-1;
    elsif v_date=v_expected then
      v_streak := v_streak+1;
      v_expected := v_date-1;
    else
      exit;
    end if;
  end loop;

  select coalesce(jsonb_agg(item order by created_at desc),'[]'::jsonb) into v_movements
  from (
    select
      cl.created_at,
      jsonb_build_object(
        'id',cl.id,
        'movement_type',cl.movement_type::text,
        'quantity',cl.quantity,
        'note',cl.note,
        'created_at',cl.created_at,
        'product',pt.name,
        'reservation_id',cl.reservation_id,
        'activity',ct.name,
        'starts_at',cs.starts_at
      ) as item
    from public.credit_ledger cl
    join public.product_acquisitions pa on pa.id=cl.acquisition_id
    join public.product_templates pt on pt.id=pa.product_template_id
    left join public.reservations r on r.id=cl.reservation_id
    left join public.class_sessions cs on cs.id=r.session_id
    left join public.class_templates ct on ct.id=cs.template_id
    where pa.student_id=v_student.id and pa.studio_id=v_student.studio_id
    order by cl.created_at desc
    limit 50
  ) q;

  select coalesce(jsonb_agg(item order by created_at desc),'[]'::jsonb) into v_payments
  from (
    select
      p.created_at,
      jsonb_build_object(
        'id',p.id,
        'sale_id',s.id,
        'folio',s.folio,
        'sale_status',s.status::text,
        'kind',p.kind::text,
        'amount_minor',p.amount_minor,
        'method',p.method,
        'reference',p.reference,
        'created_at',p.created_at,
        'currency',s.currency
      ) as item
    from public.payments p
    join public.sales s on s.id=p.sale_id
    where s.student_id=v_student.id and s.studio_id=v_student.studio_id
    order by p.created_at desc
    limit 50
  ) q;

  return jsonb_build_object(
    'profile',v_profile,
    'acquisitions',v_acquisitions,
    'enrollment',v_enrollment,
    'upcoming',v_upcoming,
    'stats',jsonb_build_object(
      'attended_total',v_attended_total,
      'attended_this_month',v_attended_month,
      'favorite_activity',v_favorite,
      'streak_days',v_streak
    ),
    'movements',v_movements,
    'payments',v_payments
  );
end;
$$;

revoke all on function public.student_portal_snapshot() from public, anon;
grant execute on function public.student_portal_snapshot() to authenticated, service_role;
