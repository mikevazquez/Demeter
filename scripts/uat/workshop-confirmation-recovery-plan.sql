-- TALL-NOTIF-01: read-only inventory, NOT a resend or event backfill.
-- Re-run immediately before any separately authorized recovery operation.
-- Existing events are excluded even if delivery failed: reconcile them first.
begin transaction isolation level repeatable read read only;

with affected_purchases(id) as (values
  ('57d664c5-2af6-4e4c-854b-cf3900b5bbd6'::uuid),
  ('92486800-9d0b-438c-b03f-e8d56c52a88f'::uuid),
  ('1c1a031d-f381-4863-88b0-aa96690093a0'::uuid),
  ('29c12075-d0df-4450-91ba-252fe0df082b'::uuid),
  ('6e2d37a2-de4c-43e7-93f3-b28b1d7ba1ce'::uuid)
)
select w.id as purchase_id, r.id as reservation_id, cs.starts_at,
  'booking.created:' || r.id::text as deduplication_key,
  case
    when w.status <> 'reserved' or w.paid_minor <= 0 then 'purchase_ineligible'
    when r.status <> 'reserved' then 'reservation_ineligible'
    when cs.status <> 'scheduled' or cs.starts_at <= clock_timestamp() then 'session_ineligible'
    when not s.active or nullif(trim(s.phone), '') is null then 'recipient_ineligible'
    when exists (select 1 from public.domain_events e
      where e.studio_id=w.studio_id and
        (e.deduplication_key='booking.created:' || r.id::text or
          (e.source_entity_type='reservation' and e.source_entity_id=r.id
            and e.event_type='booking.created'))) then 'event_exists_reconcile'
    when exists (select 1 from public.automation_executions a
      where a.studio_id=w.studio_id and a.subject_entity_id=r.id)
      then 'legacy_execution_exists_reconcile'
    else 'missing_event_candidate'
  end as recovery_status
from affected_purchases ap
join public.workshop_purchases w on w.id=ap.id
join public.workshop_purchase_sessions ps on ps.purchase_id=w.id
join public.reservations r on r.id=ps.reservation_id and r.studio_id=w.studio_id
  and r.student_id=w.student_id and r.session_id=ps.session_id
join public.class_sessions cs on cs.id=r.session_id and cs.studio_id=w.studio_id
join public.students s on s.id=w.student_id and s.studio_id=w.studio_id
where w.studio_id='f1d69ae2-84c5-4b76-b77c-d792c9318225'
  and w.offer_id='80bed9b6-5232-4de6-b969-40dbbac644a2'
order by w.id, cs.starts_at, r.id;

rollback;
