-- EVALUACIONES-03 · Harden result read receipts.
-- This table is an internal audit/read-receipt store. Students interact with it
-- only through SECURITY DEFINER RPCs that validate the current student context.
-- Keep direct client table access closed while satisfying RLS hardening.

alter table public.student_evaluation_result_views
  enable row level security;

revoke all on table public.student_evaluation_result_views
from anon, authenticated;
