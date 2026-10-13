create index if not exists saas_billing_checkout_plan_idx
  on public.saas_billing_checkout_attempts(plan_id);

create index if not exists saas_billing_checkout_plan_price_idx
  on public.saas_billing_checkout_attempts(plan_price_id);

create index if not exists saas_billing_checkout_created_by_idx
  on public.saas_billing_checkout_attempts(created_by)
  where created_by is not null;

create index if not exists saas_billing_webhook_studio_idx
  on public.saas_billing_webhook_events(studio_id, event_created_at desc)
  where studio_id is not null;
