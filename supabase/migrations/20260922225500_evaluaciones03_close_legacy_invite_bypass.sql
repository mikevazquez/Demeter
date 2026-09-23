-- EVALUACIONES-03 · Close legacy bypasses around the adaptive diagnostic.

create or replace function public.admin_create_evaluation_invitation(
  p_student_id uuid,
  p_discipline_id uuid,
  p_window_start date,
  p_window_end date,
  p_cadence_months integer default 3
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
begin
  return public.admin_create_evaluation_invitation_v2(
    p_student_id,
    p_discipline_id,
    p_window_start,
    p_window_end,
    3,
    null
  );
end;
$$;
