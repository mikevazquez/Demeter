-- CANCELACION-MIN-04 · Hardening e índices de notificaciones.

create index if not exists app_notifications_student_idx
  on public.app_notifications(student_id, created_at desc)
  where student_id is not null;

create index if not exists app_notifications_instructor_idx
  on public.app_notifications(instructor_id, created_at desc)
  where instructor_id is not null;

create index if not exists app_notifications_session_fk_idx
  on public.app_notifications(session_id)
  where session_id is not null;

create index if not exists app_notifications_source_event_idx
  on public.app_notifications(source_event_id)
  where source_event_id is not null;

-- La revisión automática corre por cron/trigger interno; no necesita ser RPC pública.
revoke execute on function public.admin_process_session_minimum_review(uuid)
from authenticated;
