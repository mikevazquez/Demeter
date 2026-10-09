alter table public.demi_operation_retry_settings add column delivery_failure_limit integer not null default 3 check(delivery_failure_limit between 1 and 5);
