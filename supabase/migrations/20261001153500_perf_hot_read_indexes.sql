-- Studio Flow V2 performance: targeted indexes for hot read paths only.
-- No business rules, policies, or data semantics are changed.

create index if not exists evaluation_invitations_reservation_status_idx
  on public.evaluation_invitations (reservation_id, status)
  where reservation_id is not null;

create index if not exists payments_studio_effective_on_idx
  on public.payments (studio_id, effective_on);

create index if not exists app_notifications_student_unread_idx
  on public.app_notifications (student_id, recipient_kind)
  where student_id is not null and read_at is null;

create index if not exists product_acquisitions_active_window_idx
  on public.product_acquisitions (studio_id, status, starts_on, expires_on)
  include (student_id)
  where refunded_at is null;
