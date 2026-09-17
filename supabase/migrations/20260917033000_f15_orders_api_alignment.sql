alter type public.online_checkout_status
  rename value 'preference_created' to 'order_created';

drop index if exists public.online_checkout_attempts_preference_unique;

alter table public.online_checkout_attempts
  drop column if exists preference_id,
  drop column if exists init_point,
  drop column if exists sandbox_init_point,
  add column if not exists provider_order_id text,
  add column if not exists checkout_url text;

create unique index if not exists online_checkout_attempts_order_unique
  on public.online_checkout_attempts(provider, provider_order_id)
  where provider_order_id is not null;

create or replace function public.student_create_online_checkout_attempt(
  target_product_template_id uuid,
  target_client_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_product_template_id is null then raise exception 'product_required'; end if;
  if target_client_request_key is null then raise exception 'request_key_required'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select pt.* into v_product
  from public.product_templates pt
  where pt.id = target_product_template_id
    and pt.studio_id = v_student.studio_id
    and pt.active = true
    and pt.online_purchasable = true
    and pt.product_type::text in ('package', 'membership');

  if not found then raise exception 'product_not_available_online'; end if;
  if v_product.price_minor <= 0 then raise exception 'online_price_invalid'; end if;

  insert into public.online_checkout_attempts (
    id,
    studio_id,
    student_id,
    product_template_id,
    provider,
    client_request_key,
    external_reference,
    amount_minor,
    currency
  ) values (
    v_attempt_id,
    v_student.studio_id,
    v_student.id,
    v_product.id,
    'mercado_pago',
    target_client_request_key,
    'STFLOW-MP-' || v_attempt_id::text,
    v_product.price_minor,
    upper(v_product.currency)
  )
  on conflict (student_id, client_request_key) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then
    select * into v_attempt
    from public.online_checkout_attempts
    where student_id = v_student.id
      and client_request_key = target_client_request_key;

    if v_attempt.product_template_id <> v_product.id then
      raise exception 'request_key_reused_for_different_product';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_attempt.id,
    'external_reference', v_attempt.external_reference,
    'product_template_id', v_attempt.product_template_id,
    'amount_minor', v_attempt.amount_minor,
    'currency', v_attempt.currency,
    'status', v_attempt.status::text,
    'provider_order_id', v_attempt.provider_order_id,
    'checkout_url', v_attempt.checkout_url,
    'created_at', v_attempt.created_at
  );
end;
$$;

revoke all on function public.student_create_online_checkout_attempt(uuid, uuid)
  from public, anon;
grant execute on function public.student_create_online_checkout_attempt(uuid, uuid)
  to authenticated;
