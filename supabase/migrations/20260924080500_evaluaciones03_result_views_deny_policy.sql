-- EVALUACIONES-03 · Explicit deny policy for result read receipts.
-- The table is intentionally not a direct client surface. Its SECURITY DEFINER
-- RPCs validate the current student context before reading/writing receipts.

drop policy if exists "result views deny direct client access"
on public.student_evaluation_result_views;

create policy "result views deny direct client access"
on public.student_evaluation_result_views
for all
to anon, authenticated
using (false)
with check (false);
