alter table public.workshop_purchase_sessions
 add constraint workshop_purchase_sessions_reservation_unique unique (reservation_id);
alter table public.workshop_purchases
 add constraint workshop_purchases_paid_not_above_total check (paid_minor <= total_minor);
alter table public.workshop_purchases
 add constraint workshop_purchases_due_for_balance check (status <> 'reserved' or paid_minor >= total_minor or balance_due_at is not null);
alter table public.workshop_offers
 add constraint workshop_offers_deposit_valid check (
   (deposit_mode='full' and deposit_value is null)
   or (deposit_mode='fixed' and deposit_value is not null and deposit_value <= full_price_minor)
   or (deposit_mode='percent' and deposit_value is not null and deposit_value <= 100)
 );
create index if not exists workshop_purchase_sessions_session_idx on public.workshop_purchase_sessions(session_id);
create index if not exists workshop_offer_sessions_session_idx on public.workshop_offer_sessions(session_id);
