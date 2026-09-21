-- SF-255B1 · Guest invitations without creating fake students

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  lifecycle_status text not null default 'trial'
    check (lifecycle_status in ('trial','prospect','student')),
  source text,
  converted_student_id uuid references public.students(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(studio_id,person_id)
);

comment on table public.crm_contacts is
  'CRM identity lifecycle for non-student contacts and conversions: trial -> prospect -> student.';

alter table public.crm_contacts enable row level security;

drop policy if exists crm_contacts_read on public.crm_contacts;
create policy crm_contacts_read
on public.crm_contacts
for select
to authenticated
using (
  private.has_capability(studio_id,'students.read')
  or private.has_capability(studio_id,'rewards.read')
);

grant select on public.crm_contacts to authenticated;

insert into public.crm_contacts(
  studio_id,person_id,lifecycle_status,source,converted_student_id
)
select distinct
  s.studio_id,
  s.person_id,
  'student',
  'active_enrollment',
  s.id
from public.students s
join public.student_enrollments se
  on se.studio_id=s.studio_id
 and se.student_id=s.id
where s.person_id is not null
  and se.status='active'
  and se.refunded_at is null
  and se.starts_on<=current_date
  and (se.expires_on is null or se.expires_on>=current_date)
on conflict(studio_id,person_id)
do update set
  lifecycle_status='student',
  converted_student_id=excluded.converted_student_id,
  updated_at=now();

create or replace function private.crm_contact_mark_student_from_enrollment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
begin
  if new.status<>'active' or new.refunded_at is not null then
    return new;
  end if;

  select * into v_student
  from public.students
  where id=new.student_id
    and studio_id=new.studio_id;

  if not found or v_student.person_id is null then
    return new;
  end if;

  insert into public.crm_contacts(
    studio_id,person_id,lifecycle_status,source,converted_student_id
  )
  values(
    new.studio_id,v_student.person_id,'student','active_enrollment',v_student.id
  )
  on conflict(studio_id,person_id)
  do update set
    lifecycle_status='student',
    source='active_enrollment',
    converted_student_id=v_student.id,
    updated_at=now();

  return new;
end;
$$;

revoke all on function private.crm_contact_mark_student_from_enrollment()
from public,anon,authenticated,service_role;

drop trigger if exists sf255_crm_contact_enrollment on public.student_enrollments;
create trigger sf255_crm_contact_enrollment
after insert or update of status,refunded_at
on public.student_enrollments
for each row
execute function private.crm_contact_mark_student_from_enrollment();

alter table public.reservations
  add column if not exists guest_person_id uuid references public.persons(id) on delete restrict,
  add column if not exists host_reservation_id uuid references public.reservations(id) on delete cascade;

alter table public.reservations
  drop constraint if exists reservations_identity_check;
alter table public.reservations
  add constraint reservations_identity_check
  check (
    student_id is not null
    or student_user_id is not null
    or guest_person_id is not null
  );

alter table public.reservations
  drop constraint if exists reservations_credits_held_check;
alter table public.reservations
  add constraint reservations_credits_held_check
  check (credits_held>=0);

alter table public.reservations
  drop constraint if exists reservations_guest_identity_exclusive_check;
alter table public.reservations
  add constraint reservations_guest_identity_exclusive_check
  check (
    guest_person_id is null
    or (
      student_id is null
      and student_user_id is null
      and acquisition_id is null
      and host_reservation_id is not null
    )
  );

create unique index if not exists reservations_active_session_guest_unique
  on public.reservations(session_id,guest_person_id)
  where guest_person_id is not null
    and status in ('reserved','attended');

create index if not exists reservations_host_reservation_idx
  on public.reservations(host_reservation_id)
  where host_reservation_id is not null;

create table if not exists public.reward_guest_invitations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  period_start date not null,
  host_student_id uuid not null references public.students(id) on delete cascade,
  host_reservation_id uuid not null references public.reservations(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  guest_person_id uuid not null references public.persons(id) on delete restrict,
  guest_reservation_id uuid not null references public.reservations(id) on delete cascade,
  level_key_snapshot text not null
    check(level_key_snapshot in ('bronze','silver','gold','diamond')),
  status text not null default 'active'
    check(status in (
      'active','attended','no_show',
      'cancelled_on_time','cancelled_late','cancelled_by_studio'
    )),
  used_at timestamptz not null default now(),
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(guest_reservation_id)
);

comment on table public.reward_guest_invitations is
  'SF-255 monthly guest invitation usage linked to a real host reservation and guest capacity slot.';

create index if not exists reward_guest_invitations_balance_idx
  on public.reward_guest_invitations(studio_id,host_student_id,period_start,status);

create index if not exists reward_guest_invitations_host_idx
  on public.reward_guest_invitations(host_reservation_id,status);

alter table public.reward_guest_invitations enable row level security;

drop policy if exists reward_guest_invitations_read on public.reward_guest_invitations;
create policy reward_guest_invitations_read
on public.reward_guest_invitations
for select
to authenticated
using (
  private.has_capability(studio_id,'rewards.read')
  or private.is_reward_student_self(studio_id,host_student_id)
);

grant select on public.reward_guest_invitations to authenticated;

create or replace function private.reward_invitation_balance(
  p_student_id uuid,
  p_as_of date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_membership public.reward_status_memberships%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
  v_period_start date;
  v_total integer:=0;
  v_used integer:=0;
begin
  select * into v_student
  from public.students
  where id=p_student_id;

  if not found then
    raise exception 'student_not_found';
  end if;

  perform private.reward_status_sync_student(v_student.id,p_as_of);

  select * into v_membership
  from public.reward_status_memberships
  where studio_id=v_student.studio_id
    and student_id=v_student.id;

  if not found then
    raise exception 'reward_status_not_found';
  end if;

  select * into v_level
  from public.reward_status_level_definitions
  where studio_id=v_student.studio_id
    and level_key=v_membership.current_level_key;

  if not found then
    raise exception 'reward_level_not_found';
  end if;

  v_period_start:=date_trunc('month',p_as_of)::date;
  v_total:=coalesce(v_level.monthly_guest_invites,0);

  select count(*)::integer into v_used
  from public.reward_guest_invitations i
  where i.studio_id=v_student.studio_id
    and i.host_student_id=v_student.id
    and i.period_start=v_period_start
    and i.status in ('active','attended','no_show','cancelled_late');

  return jsonb_build_object(
    'period_start',v_period_start,
    'level_key',v_level.level_key,
    'level_title',v_level.title,
    'total',v_total,
    'used',v_used,
    'remaining',greatest(v_total-v_used,0)
  );
end;
$$;

revoke all on function private.reward_invitation_balance(uuid,date)
from public,anon,authenticated,service_role;

create or replace function public.student_reward_invitation_balance()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
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

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_today:=(clock_timestamp() at time zone v_timezone)::date;

  return private.reward_invitation_balance(v_student.id,v_today);
end;
$$;

revoke all on function public.student_reward_invitation_balance()
from public,anon;
grant execute on function public.student_reward_invitation_balance()
to authenticated;

create or replace function public.student_reward_invitation_context(
  target_host_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_host public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_timezone text;
  v_today date;
  v_balance jsonb;
  v_reserved integer;
  v_guests jsonb;
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

  select * into v_host
  from public.reservations
  where id=target_host_reservation_id
    and studio_id=v_student.studio_id
    and student_id=v_student.id;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_host.session_id
    and studio_id=v_host.studio_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;
  v_today:=(clock_timestamp() at time zone v_timezone)::date;

  v_balance:=private.reward_invitation_balance(v_student.id,v_today);

  select count(*)::integer into v_reserved
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'invitation_id',i.id,
      'guest_reservation_id',i.guest_reservation_id,
      'guest_name',trim(concat_ws(' ',p.first_name,p.last_name)),
      'phone',pc.value,
      'status',i.status
    )
    order by i.created_at
  ),'[]'::jsonb)
  into v_guests
  from public.reward_guest_invitations i
  join public.persons p on p.id=i.guest_person_id
  left join public.person_contacts pc
    on pc.person_id=p.id
   and pc.studio_id=i.studio_id
   and pc.kind='phone'
   and pc.is_primary=true
  where i.host_reservation_id=v_host.id
    and i.status in ('active','attended','no_show','cancelled_late');

  return v_balance || jsonb_build_object(
    'host_reservation_id',v_host.id,
    'session_id',v_session.id,
    'host_reservation_status',v_host.status::text,
    'session_status',v_session.status::text,
    'spots_available',greatest(v_session.capacity-v_reserved,0),
    'can_invite',
      v_host.status='reserved'
      and v_session.status='scheduled'
      and v_session.starts_at>now()
      and coalesce((v_balance->>'remaining')::integer,0)>0
      and v_reserved<v_session.capacity,
    'active_guests',v_guests
  );
end;
$$;

revoke all on function public.student_reward_invitation_context(uuid)
from public,anon;
grant execute on function public.student_reward_invitation_context(uuid)
to authenticated;

create or replace function public.student_create_guest_invitation(
  target_host_reservation_id uuid,
  target_guest_full_name text,
  target_guest_phone text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_host public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_timezone text;
  v_today date;
  v_balance jsonb;
  v_reserved integer;
  v_person public.persons%rowtype;
  v_crm public.crm_contacts%rowtype;
  v_first_name text;
  v_last_name text;
  v_guest_reservation_id uuid;
  v_invitation_id uuid;
  v_period_start date;
  v_level_key text;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if nullif(trim(coalesce(target_guest_full_name,'')),'') is null then
    return jsonb_build_object('ok',false,'reason_code','guest_name_required');
  end if;

  if target_guest_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok',false,'reason_code','guest_phone_invalid');
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

  select * into v_host
  from public.reservations
  where id=target_host_reservation_id
    and studio_id=v_student.studio_id
    and student_id=v_student.id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','reservation_not_found');
  end if;

  if v_host.status<>'reserved' then
    return jsonb_build_object('ok',false,'reason_code','host_reservation_not_active');
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_host.session_id
    and studio_id=v_host.studio_id
  for update;

  if not found or v_session.status<>'scheduled' or v_session.starts_at<=now() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;
  v_today:=(clock_timestamp() at time zone v_timezone)::date;

  v_balance:=private.reward_invitation_balance(v_student.id,v_today);
  if coalesce((v_balance->>'remaining')::integer,0)<=0 then
    return jsonb_build_object('ok',false,'reason_code','no_invites_remaining');
  end if;

  select count(*)::integer into v_reserved
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  if v_reserved>=v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_student.studio_id::text||':'||target_guest_phone)
  );

  select p.* into v_person
  from public.person_contacts pc
  join public.persons p
    on p.id=pc.person_id
   and p.studio_id=pc.studio_id
  where pc.studio_id=v_student.studio_id
    and pc.kind='phone'
    and lower(pc.value)=lower(target_guest_phone)
  limit 1;

  if not found then
    v_first_name:=split_part(trim(target_guest_full_name),' ',1);
    v_last_name:=nullif(
      trim(substr(trim(target_guest_full_name),length(v_first_name)+1)),
      ''
    );

    insert into public.persons(studio_id,first_name,last_name)
    values(v_student.studio_id,v_first_name,v_last_name)
    returning * into v_person;

    insert into public.person_contacts(
      person_id,studio_id,kind,value,is_primary
    )
    values(
      v_person.id,v_student.studio_id,'phone',target_guest_phone,true
    );

    insert into public.crm_contacts(
      studio_id,person_id,lifecycle_status,source
    )
    values(
      v_student.studio_id,v_person.id,'trial','reward_invitation'
    )
    returning * into v_crm;
  else
    select * into v_crm
    from public.crm_contacts
    where studio_id=v_student.studio_id
      and person_id=v_person.id;

    if not found then
      if exists(
        select 1
        from public.students s
        join public.student_enrollments se
          on se.studio_id=s.studio_id
         and se.student_id=s.id
        where s.studio_id=v_student.studio_id
          and s.person_id=v_person.id
          and se.status='active'
          and se.refunded_at is null
          and se.starts_on<=v_today
          and (se.expires_on is null or se.expires_on>=v_today)
      ) then
        insert into public.crm_contacts(
          studio_id,person_id,lifecycle_status,source,converted_student_id
        )
        select
          s.studio_id,s.person_id,'student','active_enrollment',s.id
        from public.students s
        where s.studio_id=v_student.studio_id
          and s.person_id=v_person.id
        order by s.created_at asc
        limit 1
        returning * into v_crm;
      else
        insert into public.crm_contacts(
          studio_id,person_id,lifecycle_status,source
        )
        values(
          v_student.studio_id,v_person.id,'trial','reward_invitation'
        )
        returning * into v_crm;
      end if;
    end if;
  end if;

  if v_crm.lifecycle_status='student' then
    return jsonb_build_object(
      'ok',false,
      'reason_code','guest_already_student'
    );
  end if;

  if exists(
    select 1
    from public.reservations r
    left join public.students s
      on s.id=r.student_id
     and s.studio_id=r.studio_id
    where r.session_id=v_session.id
      and r.status in ('reserved','attended')
      and (
        r.guest_person_id=v_person.id
        or s.person_id=v_person.id
      )
  ) then
    return jsonb_build_object(
      'ok',false,
      'reason_code','guest_already_reserved'
    );
  end if;

  -- Revalidate capacity after contact resolution.
  select count(*)::integer into v_reserved
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  if v_reserved>=v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  insert into public.reservations(
    studio_id,session_id,guest_person_id,host_reservation_id,
    status,credits_held
  )
  values(
    v_student.studio_id,v_session.id,v_person.id,v_host.id,
    'reserved',0
  )
  returning id into v_guest_reservation_id;

  v_period_start:=(v_balance->>'period_start')::date;
  v_level_key:=v_balance->>'level_key';

  insert into public.reward_guest_invitations(
    studio_id,period_start,host_student_id,host_reservation_id,
    session_id,guest_person_id,guest_reservation_id,
    level_key_snapshot,status
  )
  values(
    v_student.studio_id,v_period_start,v_student.id,v_host.id,
    v_session.id,v_person.id,v_guest_reservation_id,
    v_level_key,'active'
  )
  returning id into v_invitation_id;

  v_balance:=private.reward_invitation_balance(v_student.id,v_today);

  return jsonb_build_object(
    'ok',true,
    'invitation_id',v_invitation_id,
    'guest_reservation_id',v_guest_reservation_id,
    'guest_person_id',v_person.id,
    'guest_name',trim(concat_ws(' ',v_person.first_name,v_person.last_name)),
    'contact_status',v_crm.lifecycle_status,
    'remaining',(v_balance->>'remaining')::integer
  );
end;
$$;

revoke all on function public.student_create_guest_invitation(uuid,text,text)
from public,anon;
grant execute on function public.student_create_guest_invitation(uuid,text,text)
to authenticated;

create or replace function public.student_cancel_guest_invitation(
  target_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_invite public.reward_guest_invitations%rowtype;
  v_guest public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_new_status public.reservation_status;
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

  select * into v_invite
  from public.reward_guest_invitations
  where id=target_invitation_id
    and studio_id=v_student.studio_id
    and host_student_id=v_student.id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','invitation_not_found');
  end if;

  select * into v_guest
  from public.reservations
  where id=v_invite.guest_reservation_id
  for update;

  if not found or v_guest.status<>'reserved' then
    return jsonb_build_object('ok',false,'reason_code','invitation_not_cancellable');
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_guest.session_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  v_new_status:=private.reservation_cancellation_outcome(v_session.starts_at);

  update public.reservations
  set status=v_new_status,
      cancelled_at=now(),
      cancellation_reason='Invitación cancelada por anfitriona',
      cancelled_by=(select auth.uid()),
      updated_at=now()
  where id=v_guest.id;

  return jsonb_build_object(
    'ok',true,
    'status',v_new_status::text,
    'returned',v_new_status='cancelled_on_time'
  );
end;
$$;

revoke all on function public.student_cancel_guest_invitation(uuid)
from public,anon;
grant execute on function public.student_cancel_guest_invitation(uuid)
to authenticated;

create or replace function private.sync_reward_invitation_from_guest_reservation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.host_reservation_id is null or new.guest_person_id is null then
    return new;
  end if;

  update public.reward_guest_invitations
  set status=case new.status::text
      when 'reserved' then 'active'
      when 'attended' then 'attended'
      when 'no_show' then 'no_show'
      when 'cancelled_on_time' then 'cancelled_on_time'
      when 'cancelled_late' then 'cancelled_late'
      when 'cancelled_by_studio' then 'cancelled_by_studio'
      else status
    end,
    returned_at=case
      when new.status in ('cancelled_on_time','cancelled_by_studio')
        then coalesce(returned_at,now())
      else returned_at
    end,
    updated_at=now()
  where guest_reservation_id=new.id;

  return new;
end;
$$;

revoke all on function private.sync_reward_invitation_from_guest_reservation()
from public,anon,authenticated,service_role;

drop trigger if exists sf255_guest_invitation_reservation_sync on public.reservations;
create trigger sf255_guest_invitation_reservation_sync
after update of status on public.reservations
for each row
when (new.guest_person_id is not null and new.host_reservation_id is not null)
execute function private.sync_reward_invitation_from_guest_reservation();

create or replace function private.cascade_host_reservation_to_guest()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.host_reservation_id is not null then
    return new;
  end if;

  if old.status='reserved'
     and new.status in ('cancelled_on_time','cancelled_late','cancelled_by_studio') then
    update public.reservations
    set status=new.status,
        cancelled_at=coalesce(new.cancelled_at,now()),
        cancellation_reason='Cancelada por cambio en reserva de anfitriona',
        cancelled_by=new.cancelled_by,
        updated_at=now()
    where host_reservation_id=new.id
      and status='reserved';
  elsif old.status='reserved' and new.status='no_show' then
    update public.reservations
    set status='no_show',
        updated_at=now()
    where host_reservation_id=new.id
      and status='reserved';

    update public.reward_guest_invitations
    set status='no_show',
        updated_at=now()
    where host_reservation_id=new.id
      and status in ('active','attended');
  end if;

  return new;
end;
$$;

revoke all on function private.cascade_host_reservation_to_guest()
from public,anon,authenticated,service_role;

drop trigger if exists sf255_host_reservation_guest_cascade on public.reservations;
create trigger sf255_host_reservation_guest_cascade
after update of status on public.reservations
for each row
when (old.status='reserved' and new.status<>old.status)
execute function private.cascade_host_reservation_to_guest();

create or replace function public.coach_session_roster(
  target_studio_id uuid,
  target_session_id uuid
)
returns table(
  reservation_id uuid,
  student_id uuid,
  student_name text,
  attendance_status public.reservation_status,
  package_name text,
  commercial_pending boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_instructor_id uuid;
begin
  v_instructor_id:=private.current_instructor_id(target_studio_id);
  if v_instructor_id is null then
    raise exception 'forbidden';
  end if;

  if not exists(
    select 1
    from public.class_sessions cs
    where cs.id=target_session_id
      and cs.studio_id=target_studio_id
      and cs.instructor_id=v_instructor_id
  ) then
    raise exception 'session_not_available';
  end if;

  return query
  select
    r.id,
    s.id,
    coalesce(
      s.full_name,
      nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),
      'Invitado'
    ),
    r.status,
    case
      when r.guest_person_id is not null then 'Invitación'
      else pt.name
    end,
    case
      when r.guest_person_id is not null then false
      else r.acquisition_id is null
    end
  from public.reservations r
  left join public.students s
    on s.id=r.student_id
   and s.studio_id=r.studio_id
  left join public.persons p
    on p.id=r.guest_person_id
   and p.studio_id=r.studio_id
  left join public.product_acquisitions pa
    on pa.id=r.acquisition_id
   and pa.studio_id=r.studio_id
  left join public.product_templates pt
    on pt.id=pa.product_template_id
   and pt.studio_id=pa.studio_id
  where r.studio_id=target_studio_id
    and r.session_id=target_session_id
    and r.status in ('reserved','attended','no_show')
  order by
    lower(coalesce(s.full_name,trim(concat_ws(' ',p.first_name,p.last_name)),'Invitado')),
    r.booked_at;
end;
$$;

revoke all on function public.coach_session_roster(uuid,uuid)
from public,anon;
grant execute on function public.coach_session_roster(uuid,uuid)
to authenticated;
