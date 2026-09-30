create table if not exists public.product_template_activities (
  studio_id uuid not null references public.studios(id) on delete cascade,
  product_template_id uuid not null references public.product_templates(id) on delete cascade,
  class_template_id uuid not null references public.class_templates(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_template_id, class_template_id)
);

create index if not exists product_template_activities_activity_idx
  on public.product_template_activities (class_template_id, product_template_id);

alter table public.product_template_activities enable row level security;

grant select, insert, update, delete on public.product_template_activities to authenticated;

create policy "product_template_activities_read"
on public.product_template_activities
for select
to authenticated
using ((select private.has_capability(product_template_activities.studio_id, 'products.read')));

create policy "product_template_activities_student_portal_read"
on public.product_template_activities
for select
to authenticated
using ((select private.has_capability(product_template_activities.studio_id, 'student.portal')));

create policy "product_template_activities_write_insert"
on public.product_template_activities
for insert
to authenticated
with check ((select private.has_capability(product_template_activities.studio_id, 'products.write')));

create policy "product_template_activities_write_update"
on public.product_template_activities
for update
to authenticated
using ((select private.has_capability(product_template_activities.studio_id, 'products.write')))
with check ((select private.has_capability(product_template_activities.studio_id, 'products.write')));

create policy "product_template_activities_write_delete"
on public.product_template_activities
for delete
to authenticated
using ((select private.has_capability(product_template_activities.studio_id, 'products.write')));

comment on table public.product_template_activities is
  'Optional activity restrictions for product templates. If rows exist, the product is scoped to those class templates.';

create or replace function private.booking_eligibility_core(
  target_session_id uuid,
  target_student_id uuid,
  p_allow_started_session boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
  select * into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  select * into v_student
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

  select count(*) into v_booked_count
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

  select timezone into v_timezone
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
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
  ) into v_has_active_acquisition;

  if not v_has_active_acquisition then
    select exists (
      select 1
      from public.product_acquisitions pa
      where pa.studio_id = v_session.studio_id
        and pa.student_id = target_student_id
        and pa.status = 'active'
        and pa.access_blocked
    ) into v_has_blocked_acquisition;

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
  ) into v_has_scope_acquisition;

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
  ) into v_has_schedule_acquisition;

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
$function$;
