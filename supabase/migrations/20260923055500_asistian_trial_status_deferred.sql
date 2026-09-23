-- ASISTIAN-INBOUND-04
-- Recompute trial status at transaction end so lifecycle events cannot overwrite
-- the student's state when another active reservation already exists.

drop trigger if exists asistian_refresh_trial_status_on_reservation
  on public.reservations;

create constraint trigger asistian_refresh_trial_status_on_reservation
after insert or update
on public.reservations
deferrable initially deferred
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
