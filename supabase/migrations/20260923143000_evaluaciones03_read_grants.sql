-- Hotfix · EVALUACIONES-03
-- Direct administrative/student reads are protected by RLS, but the base
-- tables also need SELECT granted to authenticated for those policies to run.
grant select on table public.evaluation_invitations to authenticated;
grant select on table public.student_evaluation_cycles to authenticated;
