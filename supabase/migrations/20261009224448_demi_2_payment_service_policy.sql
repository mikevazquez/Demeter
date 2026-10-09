-- Intentionally service-only: public callers cannot read or write payment proof.
create policy demi_payment_requests_service_only on public.demi_payment_requests for all to service_role using(true) with check(true);
