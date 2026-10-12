-- TALLERES-01: fixed-date programs use the existing sales, ledger and reservation engine.
create table public.activity_programs (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 kind text not null check(kind in ('workshop','event')),
 name text not null check(length(name) between 1 and 80),
 description text not null default '',
 full_product_id uuid references public.product_templates(id),
 allow_single boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.class_templates add column program_id uuid references public.activity_programs(id);
create table public.activity_program_sessions (
 program_id uuid not null references public.activity_programs(id),
 studio_id uuid not null references public.studios(id),
 session_id uuid primary key references public.class_sessions(id),
 single_product_id uuid references public.product_templates(id),
 position integer not null check(position>0),
 unique(program_id,position)
);
create index activity_programs_studio_idx on public.activity_programs(studio_id);
create index activity_program_sessions_program_idx on public.activity_program_sessions(program_id);
alter table public.activity_programs enable row level security;
alter table public.activity_program_sessions enable row level security;
grant select on public.activity_programs, public.activity_program_sessions to authenticated;
create policy programs_read on public.activity_programs for select to authenticated using(
 private.has_capability(studio_id,'schedule.read') or private.has_capability(studio_id,'student.portal'));
create policy program_sessions_read on public.activity_program_sessions for select to authenticated using(
 private.has_capability(studio_id,'schedule.read') or private.has_capability(studio_id,'student.portal'));

create function public.admin_create_activity_program(p_studio_id uuid,p_program jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_program uuid; v_product uuid; v_single uuid; v_template uuid; v_session uuid;
 v_item jsonb; v_first date; v_last date; v_timezone text; v_currency text;
 v_start timestamptz; v_end timestamptz; v_discipline uuid; v_instructor uuid; v_space uuid;
 v_duration integer; v_capacity integer; v_position integer:=0; v_count integer;
 v_full_price integer; v_single_price integer; v_allow_single boolean; v_name text;
begin
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 if not private.has_capability(p_studio_id,'schedule.write') or
    not private.has_capability(p_studio_id,'products.write') then raise exception 'forbidden'; end if;
 v_name:=btrim(p_program->>'name');
 v_full_price:=(p_program->>'fullPriceMinor')::integer;
 if v_name is null or length(v_name) not between 1 and 80 or
    coalesce(p_program->>'kind','') not in ('workshop','event') or
    coalesce(length(p_program->>'description'),0)>500 or v_full_price is null or v_full_price<=0 or
    jsonb_typeof(p_program->'dates') is distinct from 'array' then raise exception 'invalid_program'; end if;
 v_count:=jsonb_array_length(p_program->'dates');
 if v_count not between 1 and 100 then raise exception 'invalid_program_dates'; end if;
 v_allow_single:=coalesce((p_program->>'allowSingle')::boolean,false) and v_count>1;
 select timezone,currency into v_timezone,v_currency from public.studios where id=p_studio_id;
 select min((value->>'date')::date),max((value->>'date')::date) into v_first,v_last
 from jsonb_array_elements(p_program->'dates');
 if v_first<(now() at time zone v_timezone)::date then raise exception 'past_program_date'; end if;
 if exists(select 1 from jsonb_array_elements(p_program->'dates') group by value->>'date',value->>'time' having count(*)>1)
 then raise exception 'duplicate_program_date'; end if;
 insert into public.activity_programs(studio_id,kind,name,description,allow_single)
 values(p_studio_id,p_program->>'kind',v_name,coalesce(p_program->>'description',''),v_allow_single) returning id into v_program;
 insert into public.product_templates(studio_id,name,description,product_type,package_term,price_minor,currency,credit_limit,validity_days,unlimited,active,assistant_visible)
 values(p_studio_id,v_name||' · completo',coalesce(p_program->>'description',''),'package','custom',v_full_price,v_currency,v_count,v_last-v_first+1,false,true,false) returning id into v_product;
 update public.activity_programs set full_product_id=v_product where id=v_program;
 for v_item in select value from jsonb_array_elements(p_program->'dates') order by (value->>'date')::date,value->>'time' loop
  v_position:=v_position+1;
  v_discipline:=nullif(v_item->>'disciplineId','')::uuid;
  v_instructor:=nullif(v_item->>'instructorId','')::uuid;
  v_space:=nullif(v_item->>'spaceId','')::uuid;
  v_duration:=(v_item->>'durationMinutes')::integer; v_capacity:=(v_item->>'capacity')::integer;
  v_single_price:=nullif(v_item->>'priceMinor','')::integer;
  if not exists(select 1 from public.disciplines where id=v_discipline and studio_id=p_studio_id and active)
  then raise exception 'invalid_discipline'; end if;
  if v_duration is null or v_duration not between 15 and 360 or v_capacity is null or v_capacity<1 or
     coalesce(v_item->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
     (v_allow_single and (v_single_price is null or v_single_price<=0)) then raise exception 'invalid_program_date'; end if;
  if v_instructor is not null and not exists(select 1 from public.instructors where id=v_instructor and studio_id=p_studio_id and status='active')
  then raise exception 'invalid_instructor'; end if;
  if v_space is not null and not exists(select 1 from public.spaces where id=v_space and studio_id=p_studio_id and active and (capacity is null or capacity>=v_capacity))
  then raise exception 'invalid_space'; end if;
  v_start:=((v_item->>'date')||' '||(v_item->>'time'))::timestamp at time zone v_timezone;
  v_end:=v_start+make_interval(mins=>v_duration);
  if v_start<=now() then raise exception 'past_program_date'; end if;
  if public.admin_session_has_conflict(p_studio_id,v_start,v_end,v_instructor,v_space,null)
  then raise exception 'session_conflict'; end if;
  insert into public.class_templates(studio_id,program_id,discipline_id,name,description,duration_minutes,capacity,credit_cost,drop_in_price_minor)
  select p_studio_id,v_program,v_discipline,left(v_name||' · '||name,80),coalesce(p_program->>'description',''),v_duration,v_capacity,1,case when v_allow_single then v_single_price else null end
  from public.disciplines where id=v_discipline returning id into v_template;
  insert into public.product_template_activities(studio_id,product_template_id,class_template_id) values(p_studio_id,v_product,v_template);
  insert into public.class_sessions(studio_id,template_id,instructor_id,space_id,starts_at,ends_at,capacity,notes)
  values(p_studio_id,v_template,v_instructor,v_space,v_start,v_end,v_capacity,'Programa: '||v_name) returning id into v_session;
  v_single:=null;
  if v_allow_single then
   insert into public.product_templates(studio_id,name,product_type,package_term,price_minor,currency,credit_limit,validity_days,unlimited,active,assistant_visible)
   values(p_studio_id,left(v_name||' · '||(v_item->>'date'),100),'package','custom',v_single_price,v_currency,1,1,false,true,false) returning id into v_single;
   insert into public.product_template_activities(studio_id,product_template_id,class_template_id) values(p_studio_id,v_single,v_template);
  end if;
  insert into public.activity_program_sessions(program_id,studio_id,session_id,single_product_id,position)
  values(v_program,p_studio_id,v_session,v_single,v_position);
 end loop;
 return v_program;
end;
$$;
revoke all on function public.admin_create_activity_program(uuid,jsonb) from public,anon;
grant execute on function public.admin_create_activity_program(uuid,jsonb) to authenticated;

-- Sale and every reservation commit together; a full date rolls everything back.
create function public.admin_enroll_activity_program(p_program_id uuid,p_student_id uuid,p_session_id uuid,p_payment_method text,p_reference text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_program public.activity_programs%rowtype; v_product uuid; v_price integer;
 v_first date; v_session record; v_sale jsonb; v_booking jsonb; v_existing uuid;
begin
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 select * into v_program from public.activity_programs where id=p_program_id and active for update;
 if not found then raise exception 'program_not_found'; end if;
 if not private.has_capability(v_program.studio_id,'sales.write') or not private.has_capability(v_program.studio_id,'schedule.write') then raise exception 'forbidden'; end if;
 if p_request_id is null then raise exception 'request_id_required'; end if;
 select id into v_existing from public.sales where studio_id=v_program.studio_id and student_id=p_student_id and idempotency_key='program:'||p_program_id||':'||p_request_id;
 if found then return jsonb_build_object('ok',true,'sale_id',v_existing,'replayed',true); end if;
 if not exists(select 1 from public.students where id=p_student_id and studio_id=v_program.studio_id) then raise exception 'student_not_found'; end if;
 if p_payment_method not in ('cash','transfer') or p_payment_method is null then raise exception 'invalid_payment_method'; end if;
 if p_session_id is null then v_product:=v_program.full_product_id;
 else
  if not v_program.allow_single then raise exception 'single_purchase_disabled'; end if;
  select single_product_id into v_product from public.activity_program_sessions where program_id=p_program_id and session_id=p_session_id;
  if v_product is null then raise exception 'invalid_program_session'; end if;
 end if;
 select price_minor into v_price from public.product_templates where id=v_product and active;
 if not found then raise exception 'product_not_available'; end if;
 select min((cs.starts_at at time zone s.timezone)::date) into v_first
 from public.activity_program_sessions ps join public.class_sessions cs on cs.id=ps.session_id join public.studios s on s.id=ps.studio_id
 where ps.program_id=p_program_id and (p_session_id is null or ps.session_id=p_session_id);
 -- Serialize the same seat locks used by book_student; stable order prevents deadlocks.
 perform cs.id from public.class_sessions cs join public.activity_program_sessions ps on ps.session_id=cs.id
 where ps.program_id=p_program_id and (p_session_id is null or ps.session_id=p_session_id) order by cs.id for update of cs;
 if exists(select 1 from public.activity_program_sessions ps join public.class_sessions cs on cs.id=ps.session_id
 where ps.program_id=p_program_id and (p_session_id is null or ps.session_id=p_session_id) and
 (cs.status<>'scheduled' or cs.starts_at<=now() or
  (select count(*) from public.reservations r where r.session_id=cs.id and r.status in ('reserved','attended'))>=cs.capacity))
 then raise exception 'program_session_unavailable'; end if;
 perform set_config('app.program_enrollment',p_program_id::text,true);
 v_sale:=public.create_manual_sale(p_student_id,array[v_product],v_price,p_payment_method,p_reference,'Inscripción a '||v_program.name,v_first);
 perform set_config('app.program_enrollment','',true);
 update public.sales set idempotency_key='program:'||p_program_id||':'||p_request_id where id=(v_sale->>'sale_id')::uuid;
 for v_session in select ps.session_id from public.activity_program_sessions ps where ps.program_id=p_program_id and (p_session_id is null or ps.session_id=p_session_id) order by ps.session_id loop
  v_booking:=public.book_student(v_session.session_id,p_student_id);
  if not coalesce((v_booking->>'ok')::boolean,false) and not coalesce((v_booking->>'eligible')::boolean,false)
  then raise exception 'program_booking_failed:%',coalesce(v_booking->>'reason_code','unknown'); end if;
 end loop;
 return v_sale;
end;
$$;
revoke all on function public.admin_enroll_activity_program(uuid,uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.admin_enroll_activity_program(uuid,uuid,uuid,text,text,uuid) to authenticated;

create function private.program_product_allows_session(p_product_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select ct.program_id is null or exists (
  select 1 from public.activity_programs p join public.activity_program_sessions ps on ps.program_id=p.id
  where p.id=ct.program_id and p.studio_id=ct.studio_id and ps.session_id=cs.id
   and (p.full_product_id=p_product_id or ps.single_product_id=p_product_id)
 ) from public.class_sessions cs join public.class_templates ct on ct.id=cs.template_id where cs.id=p_session_id;
$$;
revoke all on function private.program_product_allows_session(uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.booking_eligibility_core_demi2_base(target_session_id uuid, target_student_id uuid, p_allow_started_session boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_class_date date;
  v_timezone text;
  v_booked_count integer;
  v_has_active_acquisition boolean := false;
  v_has_scope_acquisition boolean := false;
  v_has_schedule_acquisition boolean := false;
  v_has_blocked_acquisition boolean := false;
  v_acquisition record;
  v_balance integer;
  v_blockers jsonb;
  v_enrollment_requirement jsonb;
begin
  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  select *
    into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'student_not_found');
  end if;

  if v_student.lifecycle_status <> 'active' or not v_student.active then
    return jsonb_build_object('eligible', false, 'reason_code', 'student_not_operable');
  end if;

  if v_session.status <> 'scheduled'
     or (not p_allow_started_session and v_session.starts_at <= now()) then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_bookable');
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

  v_blockers := private.student_booking_blockers(target_student_id, target_session_id);

  if jsonb_array_length(coalesce(v_blockers, '[]'::jsonb)) > 0 then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', coalesce(v_blockers->0->>'code', 'account_restricted'),
      'restrictions', v_blockers
    );
  end if;

  select count(*)
    into v_booked_count
  from public.reservations r
  where r.session_id = target_session_id
    and r.status in ('reserved', 'attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_full');
  end if;

  select ct.discipline_id, greatest(coalesce(ct.credit_cost, 1), 1)
    into v_discipline_id, v_credit_cost
  from public.class_templates ct
  where ct.id = v_session.template_id;

  select timezone
    into v_timezone
  from public.studios
  where id = v_session.studio_id;

  v_class_date := (
    v_session.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
  )::date;

  v_enrollment_requirement := private.student_enrollment_requirement_for_booking(
    target_student_id,
    target_session_id
  );

  if coalesce((v_enrollment_requirement->>'missing')::boolean,false) then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'enrollment_required',
      'credit_cost', v_credit_cost,
      'enrollment_requirement', v_enrollment_requirement
    );
  end if;

  select exists (
    select 1
    from public.product_acquisitions pa
    where pa.studio_id = v_session.studio_id
      and private.program_product_allows_session(pa.product_template_id, target_session_id)
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
  )
    into v_has_active_acquisition;

  if not v_has_active_acquisition then
    select exists (
      select 1
      from public.product_acquisitions pa
      where pa.studio_id = v_session.studio_id
      and private.program_product_allows_session(pa.product_template_id, target_session_id)
        and pa.student_id = target_student_id
        and pa.status = 'active'
        and pa.access_blocked
    )
      into v_has_blocked_acquisition;

    if v_has_blocked_acquisition then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'payment_pending',
        'credit_cost', v_credit_cost
      );
    end if;

    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'no_active_product',
      'credit_cost', v_credit_cost
    );
  end if;

  select exists (
    select 1
    from public.product_acquisitions pa
    where pa.studio_id = v_session.studio_id
      and private.program_product_allows_session(pa.product_template_id, target_session_id)
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
      and (
        exists (
          select 1
          from public.product_template_activities pta
          where pta.studio_id = pa.studio_id
            and pta.product_template_id = pa.product_template_id
            and pta.class_template_id = v_session.template_id
        )
        or (
          not exists (
            select 1
            from public.product_template_activities pta_any
            where pta_any.studio_id = pa.studio_id
              and pta_any.product_template_id = pa.product_template_id
          )
          and exists (
            select 1
            from public.product_template_disciplines ptd
            where ptd.studio_id = pa.studio_id
              and ptd.product_template_id = pa.product_template_id
              and ptd.discipline_id = v_discipline_id
          )
        )
      )
  )
    into v_has_scope_acquisition;

  if not v_has_scope_acquisition then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'outside_product',
      'credit_cost', v_credit_cost
    );
  end if;

  select exists (
    select 1
    from public.product_acquisitions pa
    where pa.studio_id = v_session.studio_id
      and private.program_product_allows_session(pa.product_template_id, target_session_id)
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
      and (
        exists (
          select 1
          from public.product_template_activities pta
          where pta.studio_id = pa.studio_id
            and pta.product_template_id = pa.product_template_id
            and pta.class_template_id = v_session.template_id
        )
        or (
          not exists (
            select 1
            from public.product_template_activities pta_any
            where pta_any.studio_id = pa.studio_id
              and pta_any.product_template_id = pa.product_template_id
          )
          and exists (
            select 1
            from public.product_template_disciplines ptd
            where ptd.studio_id = pa.studio_id
              and ptd.product_template_id = pa.product_template_id
              and ptd.discipline_id = v_discipline_id
          )
        )
      )
      and (
        not exists (
          select 1
          from public.product_template_schedules pts_any
          where pts_any.studio_id = pa.studio_id
            and pts_any.product_template_id = pa.product_template_id
        )
        or exists (
          select 1
          from public.product_template_schedules pts
          where pts.studio_id = pa.studio_id
            and pts.product_template_id = pa.product_template_id
            and pts.recurring_schedule_id = v_session.recurring_schedule_id
        )
      )
  )
    into v_has_schedule_acquisition;

  if not v_has_schedule_acquisition then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'outside_product_schedule',
      'credit_cost', v_credit_cost
    );
  end if;

  for v_acquisition in
    select pa.id, pa.unlimited, pa.expires_on
    from public.product_acquisitions pa
    where pa.studio_id = v_session.studio_id
      and private.program_product_allows_session(pa.product_template_id, target_session_id)
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
      and (
        exists (
          select 1
          from public.product_template_activities pta
          where pta.studio_id = pa.studio_id
            and pta.product_template_id = pa.product_template_id
            and pta.class_template_id = v_session.template_id
        )
        or (
          not exists (
            select 1
            from public.product_template_activities pta_any
            where pta_any.studio_id = pa.studio_id
              and pta_any.product_template_id = pa.product_template_id
          )
          and exists (
            select 1
            from public.product_template_disciplines ptd
            where ptd.studio_id = pa.studio_id
              and ptd.product_template_id = pa.product_template_id
              and ptd.discipline_id = v_discipline_id
          )
        )
      )
      and (
        not exists (
          select 1
          from public.product_template_schedules pts_any
          where pts_any.studio_id = pa.studio_id
            and pts_any.product_template_id = pa.product_template_id
        )
        or exists (
          select 1
          from public.product_template_schedules pts
          where pts.studio_id = pa.studio_id
            and pts.product_template_id = pa.product_template_id
            and pts.recurring_schedule_id = v_session.recurring_schedule_id
        )
      )
    order by
      pa.unlimited desc,
      coalesce(pa.expires_on, 'infinity'::date) asc,
      pa.created_at asc
  loop
    if v_acquisition.unlimited then
      return jsonb_build_object(
        'eligible', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', true,
        'available_credits', null,
        'credit_cost', v_credit_cost
      );
    end if;

    select coalesce(sum(cl.quantity), 0)::integer
      into v_balance
    from public.credit_ledger cl
    where cl.acquisition_id = v_acquisition.id;

    if v_balance >= v_credit_cost then
      return jsonb_build_object(
        'eligible', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', false,
        'available_credits', v_balance,
        'credit_cost', v_credit_cost
      );
    end if;
  end loop;

  return jsonb_build_object(
    'eligible', false,
    'reason_code', 'no_credits',
    'credit_cost', v_credit_cost
  );
end;
$function$
;


-- A generic package sale must not promise a program seat without reservations.
create function private.guard_program_sale_path() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_program uuid;
begin
 select id into v_program from public.activity_programs where studio_id=new.studio_id and full_product_id=new.product_template_id;
 if v_program is null then
  select program_id into v_program from public.activity_program_sessions where studio_id=new.studio_id and single_product_id=new.product_template_id;
 end if;
 if v_program is not null and current_setting('app.program_enrollment',true) is distinct from v_program::text
 then raise exception 'use_program_enrollment'; end if;
 return new;
end;
$$;
revoke all on function private.guard_program_sale_path() from public,anon,authenticated;
create trigger guard_program_sale_path before insert on public.sale_lines for each row execute function private.guard_program_sale_path();
revoke all on public.activity_programs,public.activity_program_sessions from anon;
revoke insert,update,delete on public.activity_programs,public.activity_program_sessions from authenticated;
