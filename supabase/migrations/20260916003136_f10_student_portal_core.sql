create or replace function private.is_current_student(target_student_id uuid, target_studio_id uuid)
returns boolean
language sql
stable security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.students s
    join public.studio_memberships sm
      on sm.studio_id=s.studio_id
     and sm.user_id=(select auth.uid())
     and sm.role='student'
     and sm.active=true
    where s.id=target_student_id
      and s.studio_id=target_studio_id
      and s.user_id=(select auth.uid())
      and s.active=true
      and s.lifecycle_status='active'
      and private.has_capability(s.studio_id,'student.portal')
  );
$$;

create policy product_acquisitions_student_self_read
on public.product_acquisitions for select to authenticated
using (private.is_current_student(student_id,studio_id));

create policy credit_ledger_student_self_read
on public.credit_ledger for select to authenticated
using (
  exists(
    select 1 from public.product_acquisitions pa
    where pa.id=credit_ledger.acquisition_id
      and pa.studio_id=credit_ledger.studio_id
      and private.is_current_student(pa.student_id,pa.studio_id)
  )
);

create policy sales_student_self_read
on public.sales for select to authenticated
using (private.is_current_student(student_id,studio_id));

create policy sale_lines_student_self_read
on public.sale_lines for select to authenticated
using (
  exists(
    select 1 from public.sales s
    where s.id=sale_lines.sale_id
      and s.studio_id=sale_lines.studio_id
      and private.is_current_student(s.student_id,s.studio_id)
  )
);

create policy payments_student_self_read
on public.payments for select to authenticated
using (
  exists(
    select 1 from public.sales s
    where s.id=payments.sale_id
      and s.studio_id=payments.studio_id
      and private.is_current_student(s.student_id,s.studio_id)
  )
);

create policy product_templates_student_portal_read
on public.product_templates for select to authenticated
using (private.has_capability(studio_id,'student.portal'));

create policy product_template_disciplines_student_portal_read
on public.product_template_disciplines for select to authenticated
using (private.has_capability(studio_id,'student.portal'));

create policy reservations_student_linked_self_read
on public.reservations for select to authenticated
using (student_id is not null and private.is_current_student(student_id,studio_id));

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

create or replace function public.student_schedule_feed(target_start date, target_end date, target_discipline_id uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_studio public.studios%rowtype;
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_start is null or target_end is null or target_end<target_start or target_end-target_start>31 then raise exception 'date_range_invalid'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid()) and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc limit 1;
  if not found then raise exception 'student_context_not_found'; end if;

  select * into v_studio from public.studios where id=v_student.studio_id;
  v_timezone:=coalesce(v_studio.timezone,'America/Mexico_City');
  v_from:=target_start::timestamp at time zone v_timezone;
  v_to:=(target_end+1)::timestamp at time zone v_timezone;

  select coalesce(jsonb_agg(item order by starts_at),'[]'::jsonb) into v_result
  from (
    select cs.starts_at,
      jsonb_build_object(
        'session_id',cs.id,
        'starts_at',cs.starts_at,
        'ends_at',cs.ends_at,
        'capacity',cs.capacity,
        'spots_available',greatest(cs.capacity-(select count(*) from public.reservations r where r.session_id=cs.id and r.status in ('reserved','attended')),0),
        'activity',ct.name,
        'discipline_id',d.id,
        'discipline',d.name,
        'credit_cost',greatest(coalesce(ct.credit_cost,1),1),
        'space',sp.name,
        'location',sl.name,
        'coach',nullif(trim(concat_ws(' ',ip.first_name,ip.last_name)),''),
        'description',cs.notes,
        'eligibility',public.booking_eligibility(cs.id,v_student.id),
        'is_reserved',exists(select 1 from public.reservations rr where rr.session_id=cs.id and rr.student_id=v_student.id and rr.status in ('reserved','attended'))
      ) as item
    from public.class_sessions cs
    join public.class_templates ct on ct.id=cs.template_id
    join public.disciplines d on d.id=ct.discipline_id
    left join public.spaces sp on sp.id=cs.space_id
    left join public.studio_locations sl on sl.id=cs.location_id
    left join public.instructors i on i.id=cs.instructor_id
    left join public.persons ip on ip.id=i.person_id
    where cs.studio_id=v_student.studio_id
      and cs.status='scheduled'
      and cs.starts_at>=greatest(v_from,now())
      and cs.starts_at<v_to
      and (target_discipline_id is null or d.id=target_discipline_id)
    order by cs.starts_at
  ) q;

  return v_result;
end;
$$;

create or replace function public.student_session_detail(target_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_session from public.class_sessions where id=target_session_id;
  if not found then raise exception 'session_not_found'; end if;
  select s.* into v_student from public.students s
  where s.studio_id=v_session.studio_id and s.user_id=(select auth.uid()) and private.is_current_student(s.id,s.studio_id)
  limit 1;
  if not found then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    'session_id',cs.id,
    'starts_at',cs.starts_at,
    'ends_at',cs.ends_at,
    'capacity',cs.capacity,
    'spots_available',greatest(cs.capacity-(select count(*) from public.reservations r where r.session_id=cs.id and r.status in ('reserved','attended')),0),
    'activity',ct.name,
    'discipline_id',d.id,
    'discipline',d.name,
    'credit_cost',greatest(coalesce(ct.credit_cost,1),1),
    'space',sp.name,
    'location',sl.name,
    'coach',nullif(trim(concat_ws(' ',ip.first_name,ip.last_name)),''),
    'description',cs.notes,
    'eligibility',public.booking_eligibility(cs.id,v_student.id),
    'reservation_id',(select r.id from public.reservations r where r.session_id=cs.id and r.student_id=v_student.id and r.status in ('reserved','attended') order by r.booked_at desc limit 1)
  ) into v_result
  from public.class_sessions cs
  join public.class_templates ct on ct.id=cs.template_id
  join public.disciplines d on d.id=ct.discipline_id
  left join public.spaces sp on sp.id=cs.space_id
  left join public.studio_locations sl on sl.id=cs.location_id
  left join public.instructors i on i.id=cs.instructor_id
  left join public.persons ip on ip.id=i.person_id
  where cs.id=target_session_id;
  return v_result;
end;
$$;

create or replace function public.student_classes_feed()
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_upcoming jsonb;
  v_history jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select s.* into v_student from public.students s
  where s.user_id=(select auth.uid()) and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc limit 1;
  if not found then raise exception 'student_context_not_found'; end if;

  select coalesce(jsonb_agg(item order by starts_at),'[]'::jsonb) into v_upcoming
  from (
    select cs.starts_at,jsonb_build_object(
      'reservation_id',r.id,'session_id',cs.id,'status',r.status::text,
      'starts_at',cs.starts_at,'ends_at',cs.ends_at,'activity',ct.name,'discipline',d.name,
      'space',sp.name,'coach',nullif(trim(concat_ws(' ',ip.first_name,ip.last_name)),''),
      'credits_held',r.credits_held
    ) item
    from public.reservations r
    join public.class_sessions cs on cs.id=r.session_id
    join public.class_templates ct on ct.id=cs.template_id
    join public.disciplines d on d.id=ct.discipline_id
    left join public.spaces sp on sp.id=cs.space_id
    left join public.instructors i on i.id=cs.instructor_id
    left join public.persons ip on ip.id=i.person_id
    where r.student_id=v_student.id and r.studio_id=v_student.studio_id
      and r.status='reserved' and cs.starts_at>=now()
    order by cs.starts_at
  ) q;

  select coalesce(jsonb_agg(item order by starts_at desc),'[]'::jsonb) into v_history
  from (
    select cs.starts_at,jsonb_build_object(
      'reservation_id',r.id,'session_id',cs.id,'status',r.status::text,
      'starts_at',cs.starts_at,'ends_at',cs.ends_at,'activity',ct.name,'discipline',d.name,
      'space',sp.name,'coach',nullif(trim(concat_ws(' ',ip.first_name,ip.last_name)),''),
      'credits_held',r.credits_held,'cancelled_at',r.cancelled_at,'cancellation_reason',r.cancellation_reason
    ) item
    from public.reservations r
    join public.class_sessions cs on cs.id=r.session_id
    join public.class_templates ct on ct.id=cs.template_id
    join public.disciplines d on d.id=ct.discipline_id
    left join public.spaces sp on sp.id=cs.space_id
    left join public.instructors i on i.id=cs.instructor_id
    left join public.persons ip on ip.id=i.person_id
    where r.student_id=v_student.id and r.studio_id=v_student.studio_id
      and not (r.status='reserved' and cs.starts_at>=now())
    order by cs.starts_at desc
    limit 100
  ) q;

  return jsonb_build_object('upcoming',v_upcoming,'history',v_history);
end;
$$;

create or replace function public.student_book_session(target_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_session from public.class_sessions where id=target_session_id;
  if not found then raise exception 'session_not_found'; end if;
  select s.id into v_student_id from public.students s
  where s.studio_id=v_session.studio_id and s.user_id=(select auth.uid()) and private.is_current_student(s.id,s.studio_id)
  limit 1;
  if v_student_id is null then raise exception 'forbidden'; end if;
  return public.book_student(target_session_id,v_student_id);
end;
$$;

create or replace function public.student_cancel_own_reservation(target_reservation_id uuid, target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reservation public.reservations%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_reservation from public.reservations where id=target_reservation_id;
  if not found then raise exception 'reservation_not_found'; end if;
  if v_reservation.student_id is null or not private.is_current_student(v_reservation.student_id,v_reservation.studio_id) then raise exception 'forbidden'; end if;
  return public.cancel_reservation(target_reservation_id,target_reason);
end;
$$;

create or replace function public.student_update_own_profile(target_first_name text, target_last_name text default null, target_email text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_first text:=trim(coalesce(target_first_name,''));
  v_last text:=nullif(trim(coalesce(target_last_name,'')),'');
  v_email text:=nullif(lower(trim(coalesce(target_email,''))),'');
  v_contact_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if v_first='' then raise exception 'first_name_required'; end if;
  if v_email is not null and v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'email_invalid'; end if;

  select s.* into v_student from public.students s
  where s.user_id=(select auth.uid()) and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc limit 1;
  if not found or v_student.person_id is null then raise exception 'student_context_not_found'; end if;
  if not private.has_capability(v_student.studio_id,'student.profile.self') then raise exception 'forbidden'; end if;

  update public.persons set first_name=v_first,last_name=v_last,updated_at=now()
  where id=v_student.person_id and studio_id=v_student.studio_id;

  select pc.id into v_contact_id
  from public.person_contacts pc
  where pc.person_id=v_student.person_id and pc.studio_id=v_student.studio_id and pc.kind='email'
  order by pc.is_primary desc,pc.created_at asc
  limit 1;

  if v_email is null then
    if v_contact_id is not null then delete from public.person_contacts where id=v_contact_id; end if;
  elsif v_contact_id is null then
    insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
    values(v_student.person_id,v_student.studio_id,'email',v_email,true);
  else
    update public.person_contacts set value=v_email,is_primary=true,updated_at=now() where id=v_contact_id;
  end if;

  update public.students
  set full_name=trim(concat_ws(' ',v_first,v_last)),email=v_email,updated_at=now()
  where id=v_student.id;

  return jsonb_build_object('ok',true,'full_name',trim(concat_ws(' ',v_first,v_last)),'email',v_email,'phone',v_student.phone);
end;
$$;

revoke all on function public.student_portal_snapshot() from public,anon;
revoke all on function public.student_schedule_feed(date,date,uuid) from public,anon;
revoke all on function public.student_session_detail(uuid) from public,anon;
revoke all on function public.student_classes_feed() from public,anon;
revoke all on function public.student_book_session(uuid) from public,anon;
revoke all on function public.student_cancel_own_reservation(uuid,text) from public,anon;
revoke all on function public.student_update_own_profile(text,text,text) from public,anon;
grant execute on function public.student_portal_snapshot() to authenticated;
grant execute on function public.student_schedule_feed(date,date,uuid) to authenticated;
grant execute on function public.student_session_detail(uuid) to authenticated;
grant execute on function public.student_classes_feed() to authenticated;
grant execute on function public.student_book_session(uuid) to authenticated;
grant execute on function public.student_cancel_own_reservation(uuid,text) to authenticated;
grant execute on function public.student_update_own_profile(text,text,text) to authenticated;