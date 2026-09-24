-- NOTIFICACIONES-02 · Retire central rules no longer exposed by the approved 27-process catalog.
-- Their replacements/covered flows remain represented in the business-facing control center.

update public.notification_rules
set enabled = false,
    updated_at = clock_timestamp()
where rule_key in (
  'p0.booking.cancelled',
  'p0.evaluation.scheduled'
)
  and archived_at is null;
