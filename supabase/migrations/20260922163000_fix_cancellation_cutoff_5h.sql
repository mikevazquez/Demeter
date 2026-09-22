-- Correct the studio cancellation policy from 8 hours to 5 hours.
-- A cancellation is on time when it happens at least 5 hours before class.
-- Also repair historical reservations that were incorrectly classified as late
-- only because they fell inside the old 5–8 hour window.

create or replace function private.reservation_cancellation_outcome(
  target_starts_at timestamptz
)
returns public.reservation_status
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when now() <= target_starts_at - interval '5 hours'
      then 'cancelled_on_time'::public.reservation_status
    else 'cancelled_late'::public.reservation_status
  end;
$$;

with affected as (
  select
    r.id,
    r.studio_id,
    r.acquisition_id
  from public.reservations r
  join public.class_sessions cs
    on cs.id = r.session_id
  where r.status = 'cancelled_late'
    and r.cancelled_at is not null
    and cs.starts_at - r.cancelled_at >= interval '5 hours'
    and cs.starts_at - r.cancelled_at < interval '8 hours'
),
corrected as (
  update public.reservations r
  set
    status = 'cancelled_on_time',
    updated_at = now()
  from affected a
  where r.id = a.id
  returning
    r.id,
    r.studio_id,
    r.acquisition_id
)
insert into public.credit_ledger(
  studio_id,
  acquisition_id,
  movement_type,
  quantity,
  reservation_id,
  note,
  created_by
)
select
  c.studio_id,
  c.acquisition_id,
  'adjustment',
  -cl.quantity,
  c.id,
  'Corrección de crédito por cambio de política de cancelación de 8 h a 5 h',
  null
from corrected c
join public.credit_ledger cl
  on cl.reservation_id = c.id
 and cl.movement_type = 'consume'
 and cl.quantity < 0
where c.acquisition_id is not null
  and not exists (
    select 1
    from public.credit_ledger existing
    where existing.reservation_id = c.id
      and existing.movement_type = 'adjustment'
  );

revoke all on function private.reservation_cancellation_outcome(timestamptz)
from public, anon, authenticated;
