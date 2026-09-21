-- SF-255A · waitlist priority and automatic seat reassignment

create table public.class_waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active','promoted','cancelled','expired')),
  joined_at timestamptz not null default now(),
  resolved_at timestamptz,
  promoted_reservation_id uuid references public.reservations(id) on delete set null,
  resolution_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.class_waitlist_entries is
  'SF-255 waitlist. Active ordering is current level priority (Diamond > Gold > Silver > Bronze), then joined_at FIFO. No public ranking.';

create unique index class_waitlist_active_student_session_unique
  on public.class_waitlist_entries(session_id, student_id)
  where status = 'active';

create index class_waitlist_session_order_idx
  on public.class_waitlist_entries(studio_id, session_id, status, joined_at, id);

create index class_waitlist_student_idx
  on public.class_waitlist_entries(studio_id, student_id, status, joined_at desc);

alter table public.class_waitlist_entries enable row level security;

create policy class_waitlist_entries_read
on public.class_waitlist_entries
for select
to authenticated
using (
  private.has_capability(studio_id, 'schedule.write')
  or private.is_reward_student_self(studio_id, student_id)
);

grant select on public.class_waitlist_entries to authenticated;

create or replace function private.waitlist_eligibility_core(
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_class_date date;
  v_timezone text;
  v_has_active_acquisition boolean := false;
  v_has_discipline_acquisition boolean := false;
  v_has_required_enrollment boolean := false;
  v_has_blocked_acquisition boolean := false;
  v_acquisition record;
  v_balance integer;
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

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_bookable');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id = target_session_id
      and r.student_id = target_student_id
      and r.status in ('reserved','attended')
  ) then
    return jsonb_build_object('eligible', false, 'reason_code', 'already_reserved');
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

  select * into v_policy
  from public.enrollment_policies
  where studio_id = v_session.studio_id;

  if found and v_policy.enabled and v_policy.required_for_booking then
    select exists (
      select 1
      from public.student_enrollments se
      where se.studio_id = v_session.studio_id
        and se.student_id = target_student_id
        and se.status = 'active'
        and se.starts_on <= v_class_date
        and (se.expires_on is null or se.expires_on >= v_class_date)
    ) into v_has_required_enrollment;

    if not v_has_required_enrollment then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'enrollment_required',
        'credit_cost', v_credit_cost
      );
    end if;
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

  if not v_has_discipline_acquisition then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'outside_product',
      'credit_cost', v_credit_cost
    );
  end if;

  for v_acquisition in
    select pa.id, pa.unlimited, pa.expires_on
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
    order by pa.unlimited desc, coalesce(pa.expires_on, 'infinity'::date) asc, pa.created_at asc
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
$$;

revoke all on function private.waitlist_eligibility_core(uuid,uuid)
from public, anon, authenticated, service_role;

create or replace function public.student_join_waitlist(target_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_timezone text;
  v_today date;
  v_booked integer;
  v_eligibility jsonb;
  v_entry public.class_waitlist_entries%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  select s.* into v_student
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'forbidden';
  end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  if exists (
    select 1 from public.reservations r
    where r.session_id = v_session.id
      and r.student_id = v_student.id
      and r.status in ('reserved','attended')
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'already_reserved');
  end if;

  select * into v_entry
  from public.class_waitlist_entries w
  where w.session_id = v_session.id
    and w.student_id = v_student.id
    and w.status = 'active'
  order by w.joined_at asc
  limit 1;

  if found then
    select d.* into v_level
    from public.reward_status_memberships m
    join public.reward_status_level_definitions d
      on d.studio_id=m.studio_id and d.level_key=m.current_level_key
    where m.studio_id=v_student.studio_id and m.student_id=v_student.id;

    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'waitlist_entry_id', v_entry.id,
      'status', 'active',
      'level_key', v_level.level_key,
      'level_title', v_level.title,
      'waitlist_priority', v_level.waitlist_priority
    );
  end if;

  select count(*)::integer into v_booked
  from public.reservations r
  where r.session_id = v_session.id
    and r.status in ('reserved','attended');

  if v_booked < v_session.capacity then
    return jsonb_build_object('ok', false, 'reason_code', 'seat_available');
  end if;

  v_eligibility := private.waitlist_eligibility_core(v_session.id, v_student.id);
  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'reason_code', coalesce(v_eligibility->>'reason_code','waitlist_not_eligible')
    );
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  perform private.reward_status_sync_student(v_student.id, v_today);

  select d.* into v_level
  from public.reward_status_memberships m
  join public.reward_status_level_definitions d
    on d.studio_id=m.studio_id and d.level_key=m.current_level_key
  where m.studio_id=v_student.studio_id and m.student_id=v_student.id;

  insert into public.class_waitlist_entries (
    studio_id, session_id, student_id, status
  )
  values (
    v_student.studio_id, v_session.id, v_student.id, 'active'
  )
  returning * into v_entry;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'waitlist_entry_id', v_entry.id,
    'status', 'active',
    'level_key', v_level.level_key,
    'level_title', v_level.title,
    'waitlist_priority', v_level.waitlist_priority
  );
end;
$$;

revoke all on function public.student_join_waitlist(uuid)
from public, anon;
grant execute on function public.student_join_waitlist(uuid)
to authenticated;

create or replace function public.student_waitlist_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_result jsonb;
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

  select coalesce(jsonb_agg(item order by starts_at), '[]'::jsonb)
    into v_result
  from (
    select
      cs.starts_at,
      jsonb_build_object(
        'waitlist_entry_id', w.id,
        'session_id', cs.id,
        'status', w.status,
        'joined_at', w.joined_at,
        'starts_at', cs.starts_at,
        'ends_at', cs.ends_at,
        'activity', ct.name,
        'discipline', d.name,
        'space', sp.name,
        'coach', nullif(trim(concat_ws(' ',ip.first_name,ip.last_name)),'')
      ) as item
    from public.class_waitlist_entries w
    join public.class_sessions cs on cs.id=w.session_id
    join public.class_templates ct on ct.id=cs.template_id
    join public.disciplines d on d.id=ct.discipline_id
    left join public.spaces sp on sp.id=cs.space_id
    left join public.instructors i on i.id=cs.instructor_id
    left join public.persons ip on ip.id=i.person_id
    where w.studio_id=v_student.studio_id
      and w.student_id=v_student.id
      and w.status='active'
      and cs.status='scheduled'
      and cs.starts_at>=now()
  ) q;

  return v_result;
end;
$$;

revoke all on function public.student_waitlist_feed()
from public, anon;
grant execute on function public.student_waitlist_feed()
to authenticated;

create or replace function private.waitlist_book_student(
  p_waitlist_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.class_waitlist_entries%rowtype;
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_eligibility jsonb;
  v_acquisition_id uuid;
  v_unlimited boolean;
  v_credit_cost integer;
  v_reservation_id uuid;
  v_booked_count integer;
begin
  select * into v_entry
  from public.class_waitlist_entries
  where id=p_waitlist_entry_id
  for update;

  if not found or v_entry.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason_code', 'waitlist_not_active');
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_entry.session_id
  for update;

  if not found or v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    update public.class_waitlist_entries
    set status='expired', resolved_at=now(), resolution_reason='session_not_bookable', updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  select * into v_student
  from public.students
  where id=v_entry.student_id and studio_id=v_entry.studio_id;

  if not found then
    update public.class_waitlist_entries
    set status='expired', resolved_at=now(), resolution_reason='student_not_found', updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object('ok', false, 'reason_code', 'student_not_found');
  end if;

  select count(*)::integer into v_booked_count
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('ok', false, 'reason_code', 'session_full');
  end if;

  v_eligibility := private.waitlist_eligibility_core(v_session.id, v_student.id);
  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    update public.class_waitlist_entries
    set status='expired',
        resolved_at=now(),
        resolution_reason=coalesce(v_eligibility->>'reason_code','not_eligible'),
        updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object(
      'ok', false,
      'reason_code', coalesce(v_eligibility->>'reason_code','not_eligible')
    );
  end if;

  v_acquisition_id := (v_eligibility->>'acquisition_id')::uuid;
  v_unlimited := coalesce((v_eligibility->>'unlimited')::boolean, false);
  v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer,1),1);

  perform 1
  from public.product_acquisitions
  where id=v_acquisition_id
  for update;

  select count(*)::integer into v_booked_count
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('ok', false, 'reason_code', 'session_full');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id=v_session.id
      and r.student_id=v_student.id
      and r.status in ('reserved','attended')
  ) then
    update public.class_waitlist_entries
    set status='expired', resolved_at=now(), resolution_reason='already_reserved', updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object('ok', false, 'reason_code', 'already_reserved');
  end if;

  if not v_unlimited
     and public.acquisition_credit_balance(v_acquisition_id) < v_credit_cost then
    update public.class_waitlist_entries
    set status='expired', resolved_at=now(), resolution_reason='no_credits', updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object('ok', false, 'reason_code', 'no_credits');
  end if;

  insert into public.reservations (
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
    v_session.id,
    v_student.id,
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
    )
    values (
      v_session.studio_id,
      v_acquisition_id,
      'reserve',
      -v_credit_cost,
      v_reservation_id,
      format('%s crédito(s) reservados al obtener un lugar desde lista de espera', v_credit_cost),
      null
    );
  end if;

  update public.class_waitlist_entries
  set status='promoted',
      resolved_at=now(),
      promoted_reservation_id=v_reservation_id,
      resolution_reason='seat_reassigned',
      updated_at=now()
  where id=v_entry.id;

  perform public.emit_domain_event(
    v_session.studio_id,
    'booking.created',
    'reservation',
    v_reservation_id,
    'booking.created:' || v_reservation_id::text,
    clock_timestamp(),
    null,
    jsonb_build_object(
      'reservation_id', v_reservation_id,
      'session_id', v_session.id,
      'student_id', v_student.id,
      'acquisition_id', v_acquisition_id,
      'credit_cost', v_credit_cost,
      'unlimited', v_unlimited,
      'source', 'waitlist',
      'waitlist_entry_id', v_entry.id
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'waitlist_entry_id', v_entry.id
  );
end;
$$;

revoke all on function private.waitlist_book_student(uuid)
from public, anon, authenticated, service_role;

create or replace function private.promote_waitlist_for_session(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_timezone text;
  v_today date;
  v_candidate record;
  v_result jsonb;
begin
  select * into v_session
  from public.class_sessions
  where id=p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_found');
  end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    update public.class_waitlist_entries
    set status='expired',
        resolved_at=now(),
        resolution_reason='session_not_bookable',
        updated_at=now()
    where session_id=v_session.id and status='active';

    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id=v_session.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  for v_candidate in
    select w.student_id
    from public.class_waitlist_entries w
    where w.session_id=v_session.id and w.status='active'
    order by w.joined_at asc, w.id asc
  loop
    perform private.reward_status_sync_student(v_candidate.student_id, v_today);
  end loop;

  for v_candidate in
    select
      w.id,
      w.student_id,
      d.level_order,
      w.joined_at
    from public.class_waitlist_entries w
    join public.reward_status_memberships m
      on m.studio_id=w.studio_id and m.student_id=w.student_id
    join public.reward_status_level_definitions d
      on d.studio_id=m.studio_id and d.level_key=m.current_level_key
    where w.session_id=v_session.id and w.status='active'
    order by d.level_order desc, w.joined_at asc, w.id asc
  loop
    v_result := private.waitlist_book_student(v_candidate.id);

    if coalesce((v_result->>'ok')::boolean, false) then
      return v_result;
    end if;

    if v_result->>'reason_code' = 'session_full' then
      return jsonb_build_object('ok', false, 'reason_code', 'session_full');
    end if;
  end loop;

  return jsonb_build_object('ok', false, 'reason_code', 'no_eligible_waitlist_entry');
end;
$$;

revoke all on function private.promote_waitlist_for_session(uuid)
from public, anon, authenticated, service_role;

create or replace function private.reward_status_waitlist_after_reservation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'reserved'
     and new.status not in ('reserved','attended') then
    perform private.promote_waitlist_for_session(new.session_id);
  end if;
  return new;
end;
$$;

revoke all on function private.reward_status_waitlist_after_reservation_update()
from public, anon, authenticated, service_role;

drop trigger if exists sf255_waitlist_promote_after_reservation_update on public.reservations;
create trigger sf255_waitlist_promote_after_reservation_update
after update of status on public.reservations
for each row
when (old.status = 'reserved' and new.status not in ('reserved','attended'))
execute function private.reward_status_waitlist_after_reservation_update();
