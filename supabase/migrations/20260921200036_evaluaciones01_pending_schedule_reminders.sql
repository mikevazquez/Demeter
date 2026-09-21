create or replace function public.system_emit_evaluation_schedule_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.evaluation_invitations;
  v_local_today date;
  v_emitted integer := 0;
begin
  for v_invitation in
    select ei.*
    from public.evaluation_invitations ei
    where ei.status = 'pending_schedule'
  loop
    select (now() at time zone coalesce(s.timezone, 'America/Mexico_City'))::date
      into v_local_today
    from public.studios s
    where s.id = v_invitation.studio_id;

    if v_local_today < v_invitation.window_start
       or v_local_today > v_invitation.window_end then
      continue;
    end if;

    perform public.emit_domain_event(
      v_invitation.studio_id,
      'evaluation.pending_schedule.reminder',
      'evaluation_invitation',
      v_invitation.id,
      'evaluation.pending_schedule.reminder:'
        || v_invitation.id::text
        || ':'
        || v_local_today::text,
      now(),
      null,
      jsonb_build_object(
        'student_id', v_invitation.student_id,
        'discipline_id', v_invitation.discipline_id,
        'discipline_level_id', v_invitation.discipline_level_id,
        'invitation_kind', v_invitation.invitation_kind,
        'window_start', v_invitation.window_start,
        'window_end', v_invitation.window_end,
        'mandatory', v_invitation.invitation_kind = 'periodic'
      )
    );

    v_emitted := v_emitted + 1;
  end loop;

  return v_emitted;
end;
$$;

revoke all on function public.system_emit_evaluation_schedule_reminders()
from public, anon, authenticated;
grant execute on function public.system_emit_evaluation_schedule_reminders()
to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'studio_flow_evaluation_schedule_reminders'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'studio_flow_evaluation_schedule_reminders',
    '5 14 * * *',
    'select public.system_emit_evaluation_schedule_reminders();'
  );
end;
$$;
