-- EVALUACIONES-03 · Normalize open legacy initial invitations.
-- Existing first-time placement invitations created before adaptive diagnostics
-- must continue as diagnostics from the first active technical level.
--
-- This only touches open invitations that have no technical evaluation yet and
-- belong to students without a confirmed diagnostic/placement result.

update public.evaluation_invitations ei
set evaluation_purpose = 'diagnostic',
    discipline_level_id = private.evaluations_first_active_level(
      ei.studio_id,
      ei.discipline_id
    ),
    updated_at = now()
where ei.invitation_kind = 'first'
  and ei.evaluation_purpose = 'placement'
  and ei.status in ('offered','pending_schedule','scheduled')
  and private.evaluations_first_active_level(
        ei.studio_id,
        ei.discipline_id
      ) is not null
  and not private.evaluations_has_confirmed_diagnostic(
        ei.studio_id,
        ei.student_id,
        ei.discipline_id
      )
  and not exists (
    select 1
    from public.technical_evaluations te
    where te.evaluation_invitation_id = ei.id
  );
