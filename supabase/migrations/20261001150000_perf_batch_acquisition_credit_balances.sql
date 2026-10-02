-- Performance-only wrapper around the existing credit balance rule.
-- It does not change balance semantics; it batches existing RPC calls into one request.
create or replace function public.acquisition_credit_balances(
  target_acquisition_ids uuid[]
)
returns table (
  acquisition_id uuid,
  balance integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    item.acquisition_id,
    public.acquisition_credit_balance(item.acquisition_id)::integer as balance
  from unnest(coalesce(target_acquisition_ids, '{}'::uuid[])) as item(acquisition_id);
$function$;

revoke all on function public.acquisition_credit_balances(uuid[]) from public, anon;
grant execute on function public.acquisition_credit_balances(uuid[]) to authenticated;
