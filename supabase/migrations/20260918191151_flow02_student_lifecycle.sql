-- FLUJO 02 · Inactivar, eliminar y reactivar alumna
-- Business deletion is irreversible while historical commercial/attendance references stay intact.

alter table public.students alter column phone drop not null;

create table if not exists public.student_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  from_status public.student_lifecycle_status not null,
  to_status public.student_lifecycle_status not null,
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_lifecycle_events_student_created_idx
  on public.student_lifecycle_events(student_id, created_at desc);

alter table public.student_lifecycle_events enable row level security;

drop policy if exists student_lifecycle_events_read on public.student_lifecycle_events;
create policy student_lifecycle_events_read
on public.student_lifecycle_events
for select
to authenticated
using (private.has_capability(studio_id, 'students.read'));

drop policy if exists student_lifecycle_events_write on public.student_lifecycle_events;
create policy student_lifecycle_events_write
on public.student_lifecycle_events
for insert
to authenticated
with check (
  private.has_capability(studio_id, 'students.archive')
  and changed_by = (select auth.uid())
);

drop policy if exists student_lifecycle_events_delete on public.student_lifecycle_events;
create policy student_lifecycle_events_delete
on public.student_lifecycle_events
for delete
to authenticated
using (private.has_capability(studio_id, 'students.archive'));

create or replace function private.cancel_future_student_reservations(
  target_student_id uuid,
  target_reason text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation record;
  v_credit_cost integer;
  v_count integer := 0;
begin
  for v_reservation in
    select r.id, r.studio_id, r.acquisition_id, r.credits_held, pa.unlimited
    from public.reservations r
    join public.class_sessions cs on cs.id = r.session_id
    left join public.product_acquisitions pa on pa.id = r.acquisition_id
    where r.student_id = target_student_id
      and r.status = 'reserved'
      and cs.starts_at > now()
    for update of r
  loop
    v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);

    update public.reservations
    set status = 'cancelled_by_studio',
        cancelled_at = now(),
        cancellation_reason = coalesce(nullif(trim(target_reason), ''), 'Cambio de estado de alumna'),
        cancelled_by = (select auth.uid()),
        updated_at = now()
    where id = v_reservation.id;

    if v_reservation.acquisition_id is not null and not coalesce(v_reservation.unlimited, false) then
      insert into public.credit_ledger(
        studio_id, acquisition_id, movement_type, quantity, reservation_id, note, created_by
      ) values (
        v_reservation.studio_id,
        v_reservation.acquisition_id,
        'release',
        v_credit_cost,
        v_reservation.id,
        format('%s crédito(s) devueltos por cancelación del estudio al cambiar estado de alumna', v_credit_cost),
        (select auth.uid())
      )
      on conflict (reservation_id, movement_type) do nothing;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.cancel_future_student_reservations(uuid,text) from public;
revoke all on function private.cancel_future_student_reservations(uuid,text) from authenticated;

create or replace function public.admin_set_student_lifecycle(
  p_student_id uuid,
  p_status public.student_lifecycle_status
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found or not private.has_capability(v_student.studio_id, 'students.archive') then
    raise exception 'students_archive_denied';
  end if;

  if v_student.lifecycle_status = 'archived' then
    raise exception 'student_deleted';
  end if;

  if p_status not in ('active','inactive') then
    raise exception 'invalid_lifecycle_transition';
  end if;

  if v_student.lifecycle_status = p_status then
    return;
  end if;

  if p_status = 'inactive' then
    perform private.cancel_future_student_reservations(
      p_student_id,
      'Reserva cancelada por el estudio al inactivar a la alumna'
    );

    if v_student.user_id is not null then
      update public.studio_memberships
      set active = false
      where studio_id = v_student.studio_id
        and user_id = v_student.user_id
        and role = 'student';
    end if;
  else
    if v_student.user_id is not null then
      update public.studio_memberships
      set active = true
      where studio_id = v_student.studio_id
        and user_id = v_student.user_id
        and role = 'student';
    end if;
  end if;

  update public.students
  set lifecycle_status = p_status,
      active = (p_status = 'active'),
      archived_at = null,
      archived_by = null,
      updated_at = now()
  where id = p_student_id;

  insert into public.student_lifecycle_events(
    studio_id, student_id, from_status, to_status, changed_by
  ) values (
    v_student.studio_id,
    p_student_id,
    v_student.lifecycle_status,
    p_status,
    (select auth.uid())
  );
end;
$$;

create or replace function public.admin_delete_student(
  p_student_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_person_id uuid;
  v_user_id uuid;
  v_cancelled integer := 0;
begin
  select * into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found or not private.has_capability(v_student.studio_id, 'students.archive') then
    raise exception 'students_archive_denied';
  end if;

  if v_student.lifecycle_status = 'archived' then
    return jsonb_build_object('ok', true, 'already_deleted', true, 'cancelled_reservations', 0);
  end if;

  v_person_id := v_student.person_id;
  v_user_id := v_student.user_id;

  v_cancelled := private.cancel_future_student_reservations(
    p_student_id,
    'Reserva cancelada por el estudio al eliminar a la alumna'
  );

  delete from public.student_lifecycle_events where student_id = p_student_id;

  if v_user_id is not null then
    delete from public.studio_memberships
    where studio_id = v_student.studio_id
      and user_id = v_user_id
      and role = 'student';
  end if;

  if v_person_id is not null then
    delete from public.profile_field_values pfv
    using public.profile_field_definitions pfd
    where pfv.definition_id = pfd.id
      and pfv.person_id = v_person_id
      and pfd.studio_id = v_student.studio_id
      and pfd.entity_type = 'student';
  end if;

  update public.students
  set user_id = null,
      person_id = null,
      full_name = 'Alumna eliminada',
      phone = null,
      email = null,
      active = false,
      lifecycle_status = 'archived',
      profile_status = 'incomplete',
      archived_at = now(),
      archived_by = (select auth.uid()),
      updated_at = now()
  where id = p_student_id;

  if v_person_id is not null
     and not exists (select 1 from public.instructors i where i.person_id = v_person_id)
     and not exists (
       select 1 from public.students s
       where s.person_id = v_person_id and s.id <> p_student_id
     ) then
    delete from public.persons where id = v_person_id;
  end if;

  if v_user_id is not null
     and not exists (
       select 1 from public.studio_memberships sm
       where sm.user_id = v_user_id and sm.active = true
     ) then
    update public.user_accounts
    set status = 'inactive',
        updated_at = now()
    where id = v_user_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_deleted', false,
    'cancelled_reservations', v_cancelled,
    'former_user_id', v_user_id
  );
end;
$$;

revoke all on function public.admin_delete_student(uuid) from public;
grant execute on function public.admin_delete_student(uuid) to authenticated;

-- A phone may already belong to a Person that only has a deleted Student record
-- (or to an Instructor). In that case a future alta creates a new Student record
-- instead of resurrecting the deleted one.
create or replace function public.admin_create_student(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_person_id uuid;
  v_student_id uuid;
  v_full_name text;
  v_email text;
begin
  select m.studio_id into v_studio_id
  from public.studio_memberships m
  where m.user_id = (select auth.uid())
    and m.active = true
    and private.has_capability(m.studio_id, 'students.write')
  limit 1;

  if v_studio_id is null then raise exception 'students_write_denied'; end if;
  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;

  select pc.person_id into v_person_id
  from public.person_contacts pc
  where pc.studio_id = v_studio_id
    and pc.kind = 'phone'
    and pc.value = p_phone
  limit 1;

  if v_person_id is not null and exists (
    select 1
    from public.students s
    where s.studio_id = v_studio_id
      and s.person_id = v_person_id
      and s.lifecycle_status <> 'archived'
  ) then
    raise exception 'phone_exists';
  end if;

  if exists (
    select 1 from public.students s
    where s.studio_id = v_studio_id
      and s.phone = p_phone
      and s.lifecycle_status <> 'archived'
  ) then
    raise exception 'phone_exists';
  end if;

  if v_person_id is null then
    insert into public.persons(studio_id, first_name, last_name)
    values(v_studio_id, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''))
    returning id into v_person_id;

    insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
    values(v_person_id, v_studio_id, 'phone', p_phone, true);
  else
    update public.persons
    set first_name = trim(p_first_name),
        last_name = nullif(trim(coalesce(p_last_name, '')), ''),
        updated_at = now()
    where id = v_person_id;
  end if;

  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');

  if v_email is not null then
    if exists (
      select 1 from public.person_contacts pc
      where pc.studio_id = v_studio_id
        and pc.kind = 'email'
        and lower(pc.value) = v_email
        and pc.person_id <> v_person_id
    ) then
      raise exception 'email_exists';
    end if;

    update public.person_contacts
    set value = v_email,
        is_primary = true,
        updated_at = now()
    where person_id = v_person_id and kind = 'email';

    if not found then
      insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
      values(v_person_id, v_studio_id, 'email', v_email, true);
    end if;
  else
    select pc.value into v_email
    from public.person_contacts pc
    where pc.person_id = v_person_id and pc.kind = 'email'
    order by pc.is_primary desc, pc.created_at asc
    limit 1;
  end if;

  v_full_name := trim(
    p_first_name ||
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null
      then ' ' || trim(p_last_name)
      else ''
    end
  );

  insert into public.students(
    studio_id, person_id, full_name, phone, email, active, lifecycle_status, profile_status
  ) values (
    v_studio_id,
    v_person_id,
    v_full_name,
    p_phone,
    v_email,
    true,
    'active',
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null and v_email is not null
      then 'complete'::public.profile_completeness_status
      else 'incomplete'::public.profile_completeness_status
    end
  )
  returning id into v_student_id;

  return v_student_id;
end;
$$;

-- Normalize legacy "archived" records to the new irreversible business-deletion semantics.
create temporary table flow02_legacy_archived_students on commit drop as
select id, studio_id, person_id, user_id
from public.students
where lifecycle_status = 'archived';

update public.studio_memberships sm
set active = false
from flow02_legacy_archived_students legacy
where legacy.user_id is not null
  and sm.studio_id = legacy.studio_id
  and sm.user_id = legacy.user_id
  and sm.role = 'student';

delete from public.profile_field_values pfv
using flow02_legacy_archived_students legacy, public.profile_field_definitions pfd
where legacy.person_id is not null
  and pfv.person_id = legacy.person_id
  and pfv.definition_id = pfd.id
  and pfd.studio_id = legacy.studio_id
  and pfd.entity_type = 'student';

update public.students s
set user_id = null,
    person_id = null,
    full_name = 'Alumna eliminada',
    phone = null,
    email = null,
    active = false,
    profile_status = 'incomplete',
    updated_at = now()
from flow02_legacy_archived_students legacy
where s.id = legacy.id;

delete from public.persons p
using flow02_legacy_archived_students legacy
where legacy.person_id is not null
  and p.id = legacy.person_id
  and not exists (select 1 from public.instructors i where i.person_id = p.id)
  and not exists (select 1 from public.students s where s.person_id = p.id);

update public.user_accounts ua
set status = 'inactive',
    updated_at = now()
where ua.id in (
  select legacy.user_id
  from flow02_legacy_archived_students legacy
  where legacy.user_id is not null
)
and not exists (
  select 1 from public.studio_memberships sm
  where sm.user_id = ua.id and sm.active = true
);
