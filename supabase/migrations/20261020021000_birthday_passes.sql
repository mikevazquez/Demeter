create table if not exists public.birthday_passes (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  birthday_year integer not null check (birthday_year between 2000 and 2200),
  period_start date not null,
  expires_on date not null,
  status text not null default 'available' check (status in ('available','used')),
  recipient_kind text null check (recipient_kind in ('self','friend')),
  recipient_student_id uuid null references public.students(id) on delete restrict,
  recipient_person_id uuid null references public.persons(id) on delete restrict,
  used_session_id uuid null references public.class_sessions(id) on delete restrict,
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, student_id, birthday_year),
  check (expires_on >= period_start),
  check (
    (status = 'available' and recipient_kind is null and recipient_student_id is null and recipient_person_id is null and used_session_id is null and used_at is null)
    or
    (status = 'used' and recipient_kind is not null and used_session_id is not null and used_at is not null)
  )
);

create index if not exists birthday_passes_student_lookup_idx
  on public.birthday_passes(studio_id, student_id, birthday_year);

alter table public.birthday_passes enable row level security;
revoke all on table public.birthday_passes from anon;
revoke insert, update, delete on table public.birthday_passes from authenticated;
grant select on table public.birthday_passes to authenticated;

drop policy if exists birthday_passes_student_read_own on public.birthday_passes;
create policy birthday_passes_student_read_own
on public.birthday_passes
for select
to authenticated
using (
  exists (
    select 1
    from public.students s
    where s.id = birthday_passes.student_id
      and s.studio_id = birthday_passes.studio_id
      and s.user_id = (select auth.uid())
  )
  or private.has_capability(birthday_passes.studio_id, 'students.read')
);

alter table public.reservations
  add column if not exists birthday_pass_id uuid null references public.birthday_passes(id) on delete restrict;

create unique index if not exists reservations_birthday_pass_unique_idx
  on public.reservations(birthday_pass_id)
  where birthday_pass_id is not null;

alter table public.reservations drop constraint if exists reservations_guest_identity_exclusive_check;
alter table public.reservations
  add constraint reservations_guest_identity_exclusive_check check (
    guest_person_id is null
    or (
      student_id is null
      and student_user_id is null
      and acquisition_id is null
      and (
        host_reservation_id is not null
        or birthday_pass_id is not null
      )
    )
  );

create or replace function private.student_birth_date(p_student_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $function$
  select nullif(trim(both '"' from pfv.value::text), '')::date
  from public.students s
  join public.profile_field_definitions pfd
    on pfd.studio_id = s.studio_id
   and pfd.entity_type = 'student'
   and pfd.key = 'birth_date'
   and pfd.active = true
  join public.profile_field_values pfv
    on pfv.studio_id = s.studio_id
   and pfv.person_id = s.person_id
   and pfv.definition_id = pfd.id
  where s.id = p_student_id
  limit 1
$function$;

revoke all on function private.student_birth_date(uuid) from public, anon, authenticated;

create or replace function private.ensure_birthday_pass(p_student_id uuid, p_as_of date)
returns public.birthday_passes
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_birth date;
  v_start date;
  v_end date;
  v_pass public.birthday_passes%rowtype;
begin
  select * into v_student
  from public.students
  where id = p_student_id
    and private.is_current_student(id, studio_id);

  if not found then
    raise exception 'student_not_eligible';
  end if;

  v_birth := private.student_birth_date(v_student.id);
  if v_birth is null then
    raise exception 'birth_date_required';
  end if;

  if extract(month from v_birth)::integer <> extract(month from p_as_of)::integer then
    raise exception 'birthday_pass_not_in_month';
  end if;

  v_start := make_date(extract(year from p_as_of)::integer, extract(month from p_as_of)::integer, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;

  insert into public.birthday_passes(
    studio_id, student_id, birthday_year, period_start, expires_on
  )
  values(
    v_student.studio_id, v_student.id, extract(year from p_as_of)::integer, v_start, v_end
  )
  on conflict (studio_id, student_id, birthday_year) do nothing;

  select * into v_pass
  from public.birthday_passes
  where studio_id = v_student.studio_id
    and student_id = v_student.id
    and birthday_year = extract(year from p_as_of)::integer
  for update;

  return v_pass;
end;
$function$;

revoke all on function private.ensure_birthday_pass(uuid,date) from public, anon, authenticated;

create or replace function public.student_birthday_pass_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_timezone text;
  v_today date;
  v_birth date;
  v_pass public.birthday_passes%rowtype;
  v_state text;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id = v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_birth := private.student_birth_date(v_student.id);

  if v_birth is null then
    return jsonb_build_object('eligible',false,'reason_code','birth_date_required');
  end if;

  if extract(month from v_birth)::integer <> extract(month from v_today)::integer then
    return jsonb_build_object(
      'eligible',false,
      'reason_code','outside_birthday_month',
      'birthday_month',extract(month from v_birth)::integer
    );
  end if;

  v_pass := private.ensure_birthday_pass(v_student.id, v_today);
  v_state := case
    when v_pass.status = 'used' then 'used'
    when v_today > v_pass.expires_on then 'expired'
    else 'available'
  end;

  return jsonb_build_object(
    'eligible',true,
    'pass_id',v_pass.id,
    'state',v_state,
    'period_start',v_pass.period_start,
    'expires_on',v_pass.expires_on,
    'recipient_kind',v_pass.recipient_kind,
    'used_session_id',v_pass.used_session_id,
    'used_at',v_pass.used_at
  );
end;
$function$;

revoke all on function public.student_birthday_pass_snapshot() from public, anon;
grant execute on function public.student_birthday_pass_snapshot() to authenticated;

create or replace function public.student_book_with_birthday_pass(
  target_session_id uuid,
  target_for text default 'self',
  target_friend_name text default null,
  target_friend_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_timezone text;
  v_today date;
  v_session_date date;
  v_pass public.birthday_passes%rowtype;
  v_reserved integer;
  v_reservation_id uuid;
  v_target_student public.students%rowtype;
  v_person public.persons%rowtype;
  v_first_name text;
  v_last_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_for not in ('self','friend') then
    return jsonb_build_object('ok',false,'reason_code','recipient_invalid');
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
    and studio_id = v_student.studio_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id = v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_session_date := (v_session.starts_at at time zone v_timezone)::date;

  begin
    v_pass := private.ensure_birthday_pass(v_student.id, v_today);
  exception
    when others then
      return jsonb_build_object('ok',false,'reason_code',sqlerrm);
  end;

  select * into v_pass
  from public.birthday_passes
  where id = v_pass.id
  for update;

  if v_pass.status <> 'available' then
    return jsonb_build_object('ok',false,'reason_code','birthday_pass_already_used');
  end if;

  if v_session_date < v_pass.period_start or v_session_date > v_pass.expires_on then
    return jsonb_build_object('ok',false,'reason_code','birthday_pass_outside_validity');
  end if;

  select count(*)::integer into v_reserved
  from public.reservations r
  where r.session_id = v_session.id
    and r.status in ('reserved','attended');

  if v_reserved >= v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  if target_for = 'self' then
    if exists(
      select 1 from public.reservations r
      where r.session_id=v_session.id
        and r.student_id=v_student.id
        and r.status in ('reserved','attended')
    ) then
      return jsonb_build_object('ok',false,'reason_code','already_reserved');
    end if;

    insert into public.reservations(
      studio_id, session_id, student_id, student_user_id,
      status, credits_held, birthday_pass_id
    )
    values(
      v_student.studio_id, v_session.id, v_student.id, v_student.user_id,
      'reserved', 0, v_pass.id
    )
    returning id into v_reservation_id;

    update public.birthday_passes
    set status='used',
        recipient_kind='self',
        recipient_student_id=v_student.id,
        recipient_person_id=v_student.person_id,
        used_session_id=v_session.id,
        used_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_pass.id;

  else
    if nullif(trim(coalesce(target_friend_name,'')),'') is null then
      return jsonb_build_object('ok',false,'reason_code','friend_name_required');
    end if;
    if coalesce(target_friend_phone,'') !~ '^\\+[1-9][0-9]{7,14}$' then
      return jsonb_build_object('ok',false,'reason_code','friend_phone_invalid');
    end if;

    perform pg_advisory_xact_lock(hashtext(v_student.studio_id::text||':birthday:'||target_friend_phone));

    select p.* into v_person
    from public.person_contacts pc
    join public.persons p on p.id=pc.person_id and p.studio_id=pc.studio_id
    where pc.studio_id=v_student.studio_id
      and pc.kind='phone'
      and lower(pc.value)=lower(target_friend_phone)
    limit 1;

    if not found then
      v_first_name:=split_part(trim(target_friend_name),' ',1);
      v_last_name:=nullif(trim(substr(trim(target_friend_name),length(v_first_name)+1)),'');
      insert into public.persons(studio_id,first_name,last_name)
      values(v_student.studio_id,v_first_name,v_last_name)
      returning * into v_person;

      insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
      values(v_person.id,v_student.studio_id,'phone',target_friend_phone,true);

      insert into public.crm_contacts(studio_id,person_id,lifecycle_status,source)
      values(v_student.studio_id,v_person.id,'trial','birthday_pass')
      on conflict do nothing;
    end if;

    select s.* into v_target_student
    from public.students s
    where s.studio_id=v_student.studio_id
      and s.person_id=v_person.id
      and private.is_current_student(s.id,s.studio_id)
    order by s.created_at asc
    limit 1;

    if v_target_student.id is not null then
      if exists(
        select 1 from public.reservations r
        where r.session_id=v_session.id
          and r.student_id=v_target_student.id
          and r.status in ('reserved','attended')
      ) then
        return jsonb_build_object('ok',false,'reason_code','friend_already_reserved');
      end if;

      insert into public.reservations(
        studio_id, session_id, student_id, student_user_id,
        status, credits_held, birthday_pass_id
      )
      values(
        v_student.studio_id, v_session.id, v_target_student.id, v_target_student.user_id,
        'reserved', 0, v_pass.id
      )
      returning id into v_reservation_id;
    else
      if exists(
        select 1 from public.reservations r
        where r.session_id=v_session.id
          and r.guest_person_id=v_person.id
          and r.status in ('reserved','attended')
      ) then
        return jsonb_build_object('ok',false,'reason_code','friend_already_reserved');
      end if;

      insert into public.reservations(
        studio_id, session_id, guest_person_id,
        status, credits_held, birthday_pass_id
      )
      values(
        v_student.studio_id, v_session.id, v_person.id,
        'reserved', 0, v_pass.id
      )
      returning id into v_reservation_id;
    end if;

    update public.birthday_passes
    set status='used',
        recipient_kind='friend',
        recipient_student_id=v_target_student.id,
        recipient_person_id=v_person.id,
        used_session_id=v_session.id,
        used_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_pass.id;
  end if;

  perform public.emit_domain_event(
    v_student.studio_id,
    'booking.created',
    'reservation',
    v_reservation_id,
    'booking.created:' || v_reservation_id::text,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'reservation_id',v_reservation_id,
      'session_id',v_session.id,
      'birthday_pass_id',v_pass.id,
      'birthday_student_id',v_student.id,
      'recipient_kind',target_for,
      'source','birthday_pass'
    ),
    null,null,null
  );

  return jsonb_build_object(
    'ok',true,
    'reservation_id',v_reservation_id,
    'pass_id',v_pass.id,
    'recipient_kind',target_for
  );
end;
$function$;

revoke all on function public.student_book_with_birthday_pass(uuid,text,text,text) from public, anon;
grant execute on function public.student_book_with_birthday_pass(uuid,text,text,text) to authenticated;
