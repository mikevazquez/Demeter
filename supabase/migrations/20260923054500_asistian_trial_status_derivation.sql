-- ASISTIAN-INBOUND-03
-- Keep trial funnel status derived from the student's actual reservation history.

create or replace function private.asistian_refresh_trial_status(
  target_student_id uuid,
  target_studio_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next public.trial_status;
begin
  if not exists (
    select 1
    from public.students s
    where s.id = target_student_id
      and s.studio_id = target_studio_id
      and s.student_type = 'trial'
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.student_id = target_student_id
      and r.studio_id = target_studio_id
      and r.status = 'attended'
  ) then
    v_next := 'attended';
  elsif exists (
    select 1
    from public.reservations r
    where r.student_id = target_student_id
      and r.studio_id = target_studio_id
      and r.status = 'reserved'
  ) then
    v_next := 'pending';
  elsif exists (
    select 1
    from public.reservations r
    where r.student_id = target_student_id
      and r.studio_id = target_studio_id
      and r.status = 'no_show'
  ) then
    v_next := 'no_show';
  elsif exists (
    select 1
    from public.reservations r
    where r.student_id = target_student_id
      and r.studio_id = target_studio_id
      and r.status in ('cancelled_on_time','cancelled_late','cancelled_by_studio')
  ) then
    v_next := 'cancelled';
  else
    v_next := 'pending';
  end if;

  update public.students
  set trial_status = v_next,
      updated_at = now()
  where id = target_student_id
    and studio_id = target_studio_id
    and student_type = 'trial'
    and trial_status is distinct from v_next;
end;
$$;

create or replace function private.asistian_refresh_trial_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.asistian_refresh_trial_status(new.student_id, new.studio_id);

  if tg_op = 'UPDATE' and old.student_id is distinct from new.student_id then
    perform private.asistian_refresh_trial_status(old.student_id, old.studio_id);
  end if;

  return new;
end;
$$;

drop trigger if exists asistian_refresh_trial_status_on_reservation
  on public.reservations;

create trigger asistian_refresh_trial_status_on_reservation
after insert or update of status, student_id
on public.reservations
for each row
execute function private.asistian_refresh_trial_status_trigger();

do $$
declare
  v record;
begin
  for v in
    select id, studio_id
    from public.students
    where student_type = 'trial'
  loop
    perform private.asistian_refresh_trial_status(v.id, v.studio_id);
  end loop;
end
$$;
