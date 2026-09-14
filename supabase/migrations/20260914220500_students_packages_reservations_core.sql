create table public.students (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index students_studio_email_unique
  on public.students(studio_id, lower(email))
  where email is not null;
create index students_studio_active_idx on public.students(studio_id, active);
create unique index students_user_unique on public.students(user_id) where user_id is not null;

alter table public.students enable row level security;
grant select, insert, update, delete on public.students to authenticated;

create policy students_staff_select on public.students for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_studio_role(studio_id, array['owner','admin','coach']::public.studio_role[]))
  );
create policy students_admin_insert on public.students for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy students_admin_update on public.students for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy students_admin_delete on public.students for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

alter table public.student_packages add column student_id uuid references public.students(id) on delete cascade;
alter table public.student_packages alter column student_user_id drop not null;
alter table public.student_packages add constraint student_packages_identity_check
  check (student_id is not null or student_user_id is not null);
create index student_packages_student_record_idx on public.student_packages(student_id, expires_on);

alter table public.reservations add column student_id uuid references public.students(id) on delete cascade;
alter table public.reservations alter column student_user_id drop not null;
alter table public.reservations add constraint reservations_identity_check
  check (student_id is not null or student_user_id is not null);
create unique index reservations_session_student_unique
  on public.reservations(session_id, student_id)
  where student_id is not null;
create index reservations_student_record_idx on public.reservations(student_id, booked_at desc);

create policy packages_admin_insert on public.packages for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy packages_admin_update on public.packages for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy packages_admin_delete on public.packages for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

create policy student_packages_admin_insert on public.student_packages for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy student_packages_admin_update on public.student_packages for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy student_packages_admin_delete on public.student_packages for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

create policy reservations_admin_insert on public.reservations for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy reservations_admin_update on public.reservations for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy reservations_admin_delete on public.reservations for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

create or replace function public.admin_book_student(target_session_id uuid, target_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_package public.student_packages%rowtype;
  v_reservation_id uuid;
  v_booked_count integer;
  v_class_date date;
  v_timezone text;
begin
  select * into v_session from public.class_sessions where id = target_session_id for update;
  if not found then raise exception 'session_not_found'; end if;

  if not private.has_studio_role(v_session.studio_id, array['owner','admin']::public.studio_role[]) then
    raise exception 'forbidden';
  end if;

  if v_session.status <> 'scheduled' then raise exception 'session_not_bookable'; end if;

  select * into v_student from public.students where id = target_student_id and studio_id = v_session.studio_id and active;
  if not found then raise exception 'student_not_found'; end if;

  if exists (select 1 from public.reservations r where r.session_id = target_session_id and r.student_id = target_student_id and r.status <> 'cancelled') then
    raise exception 'already_booked';
  end if;

  select count(*) into v_booked_count from public.reservations r where r.session_id = target_session_id and r.status in ('booked','attended');
  if v_booked_count >= v_session.capacity then raise exception 'session_full'; end if;

  select timezone into v_timezone from public.studios where id = v_session.studio_id;
  v_class_date := (v_session.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;

  select sp.* into v_package
  from public.student_packages sp
  where sp.studio_id = v_session.studio_id
    and sp.student_id = target_student_id
    and sp.starts_on <= v_class_date
    and sp.expires_on >= v_class_date
    and (sp.credits_remaining is null or sp.credits_remaining > 0)
  order by sp.expires_on asc, sp.created_at asc
  limit 1
  for update;

  if not found then raise exception 'no_active_package'; end if;

  insert into public.reservations(studio_id, session_id, student_id, student_user_id, student_package_id, status)
  values (v_session.studio_id, target_session_id, target_student_id, v_student.user_id, v_package.id, 'booked')
  returning id into v_reservation_id;

  if v_package.credits_remaining is not null then
    update public.student_packages
    set credits_remaining = credits_remaining - 1
    where id = v_package.id;
  end if;

  return v_reservation_id;
end;
$$;

create or replace function public.admin_cancel_reservation(target_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.reservations%rowtype;
begin
  select * into v_reservation from public.reservations where id = target_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;

  if not private.has_studio_role(v_reservation.studio_id, array['owner','admin']::public.studio_role[]) then
    raise exception 'forbidden';
  end if;

  if v_reservation.status = 'cancelled' then return; end if;

  update public.reservations set status = 'cancelled', updated_at = now() where id = v_reservation.id;

  if v_reservation.student_package_id is not null then
    update public.student_packages
    set credits_remaining = case when credits_remaining is null then null else credits_remaining + 1 end
    where id = v_reservation.student_package_id;
  end if;
end;
$$;

revoke all on function public.admin_book_student(uuid, uuid) from public, anon;
revoke all on function public.admin_cancel_reservation(uuid) from public, anon;
grant execute on function public.admin_book_student(uuid, uuid) to authenticated;
grant execute on function public.admin_cancel_reservation(uuid) to authenticated;