-- Default Supabase grants include UPDATE/DELETE; remove them for evidence records.
revoke all on public.demi_group_receipts from service_role;
grant select,insert on public.demi_group_receipts to service_role;
