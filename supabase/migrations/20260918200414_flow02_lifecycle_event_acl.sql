-- FLUJO 02 · ACL explícita para historial de ciclo de vida.
-- Evita depender de DEFAULT PRIVILEGES distintos entre Sandbox y Production.

revoke all on table public.student_lifecycle_events from anon;
revoke all on table public.student_lifecycle_events from authenticated;
grant select, insert, delete on table public.student_lifecycle_events to authenticated;
