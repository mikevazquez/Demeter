alter table public.online_checkout_attempts
  add column if not exists product_name_snapshot text,
  add column if not exists validity_days_snapshot integer,
  add column if not exists credit_limit_snapshot integer,
  add column if not exists unlimited_snapshot boolean,
  add column if not exists package_term_snapshot text;

update public.online_checkout_attempts a
set product_name_snapshot = coalesce(a.product_name_snapshot, p.name),
    validity_days_snapshot = coalesce(a.validity_days_snapshot, p.validity_days),
    credit_limit_snapshot = coalesce(a.credit_limit_snapshot, p.credit_limit),
    unlimited_snapshot = coalesce(a.unlimited_snapshot, p.unlimited),
    package_term_snapshot = coalesce(a.package_term_snapshot, p.package_term)
from public.product_templates p
where p.id = a.product_template_id
  and (
    a.product_name_snapshot is null
    or a.validity_days_snapshot is null
    or a.unlimited_snapshot is null
    or a.package_term_snapshot is null
  );

alter table public.online_checkout_attempts
  alter column product_name_snapshot set not null,
  alter column validity_days_snapshot set not null,
  alter column unlimited_snapshot set not null;

alter table public.online_checkout_attempts
  drop constraint if exists online_checkout_attempts_snapshot_validity_check;

alter table public.online_checkout_attempts
  add constraint online_checkout_attempts_snapshot_validity_check
  check (validity_days_snapshot > 0);

create unique index if not exists payments_mercado_pago_reference_unique
  on public.payments(reference)
  where method = 'mercado_pago'
    and kind = 'payment'
    and reference is not null;

create table if not exists public.online_checkout_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_event_id text not null,
  provider_order_id text not null,
  action text,
  request_id text,
  signature_ts text,
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','ignored','error')),
  result_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, provider_event_id)
);

create index if not exists online_checkout_webhook_events_order_idx
  on public.online_checkout_webhook_events(provider, provider_order_id, received_at desc);

alter table public.online_checkout_webhook_events enable row level security;
revoke all on public.online_checkout_webhook_events from public, anon, authenticated;
grant select, insert, update on public.online_checkout_webhook_events to service_role;

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
  if v_product.validity_days is null or v_product.validity_days <= 0 then
    raise exception 'product_validity_missing';
  end if;

  insert into public.online_checkout_attempts (
    id,
    studio_id,
    student_id,
    product_template_id,
    provider,
    client_request_key,
    external_reference,
    amount_minor,
    currency,
    product_name_snapshot,
    validity_days_snapshot,
    credit_limit_snapshot,
    unlimited_snapshot,
    package_term_snapshot
  ) values (
    v_attempt_id,
    v_student.studio_id,
    v_student.id,
    v_product.id,
    'mercado_pago',
    target_client_request_key,
    'STFLOW-MP-' || v_attempt_id::text,
    v_product.price_minor,
    upper(v_product.currency),
    v_product.name,
    v_product.validity_days,
    v_product.credit_limit,
    v_product.unlimited,
    v_product.package_term
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

create or replace function public.service_confirm_online_checkout_approved(
  target_attempt_id uuid,
  target_provider_order_id text,
  target_provider_payment_id text,
  target_external_reference text,
  target_provider_status text,
  target_provider_status_detail text,
  target_paid_amount_minor integer,
  target_currency text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_attempt public.online_checkout_attempts%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_sale_line_id uuid;
  v_acquisition_id uuid;
  v_sale_date date;
  v_timezone text;
  v_folio text;
begin
  if target_attempt_id is null then raise exception 'attempt_required'; end if;
  if nullif(trim(coalesce(target_provider_order_id, '')), '') is null then
    raise exception 'provider_order_required';
  end if;
  if nullif(trim(coalesce(target_provider_payment_id, '')), '') is null then
    raise exception 'provider_payment_required';
  end if;
  if nullif(trim(coalesce(target_external_reference, '')), '') is null then
    raise exception 'external_reference_required';
  end if;
  if coalesce(target_paid_amount_minor, 0) <= 0 then raise exception 'paid_amount_invalid'; end if;

  select * into v_attempt
  from public.online_checkout_attempts
  where id = target_attempt_id
    and provider = 'mercado_pago'
  for update;

  if not found then raise exception 'checkout_attempt_not_found'; end if;

  if v_attempt.processed_at is not null or v_attempt.sale_id is not null then
    if v_attempt.provider_order_id is distinct from target_provider_order_id then
      raise exception 'provider_order_mismatch';
    end if;
    if v_attempt.provider_payment_id is not null
       and v_attempt.provider_payment_id is distinct from target_provider_payment_id then
      raise exception 'provider_payment_mismatch';
    end if;

    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'attempt_id', v_attempt.id,
      'sale_id', v_attempt.sale_id,
      'provider_payment_id', v_attempt.provider_payment_id
    );
  end if;

  if v_attempt.provider_order_id is distinct from target_provider_order_id then
    raise exception 'provider_order_mismatch';
  end if;
  if v_attempt.external_reference is distinct from target_external_reference then
    raise exception 'external_reference_mismatch';
  end if;
  if lower(coalesce(target_provider_status, '')) <> 'processed'
     or lower(coalesce(target_provider_status_detail, '')) <> 'accredited' then
    raise exception 'provider_not_approved';
  end if;
  if v_attempt.amount_minor <> target_paid_amount_minor then raise exception 'paid_amount_mismatch'; end if;
  if upper(v_attempt.currency) <> upper(coalesce(target_currency, '')) then
    raise exception 'currency_mismatch';
  end if;
  if v_attempt.validity_days_snapshot is null or v_attempt.validity_days_snapshot <= 0 then
    raise exception 'product_validity_missing';
  end if;

  select timezone into v_timezone
  from public.studios
  where id = v_attempt.studio_id;

  v_sale_date := (now() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;
  v_folio := 'MP-' || to_char(v_sale_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_attempt.id::text, '-', ''), 1, 12));

  insert into public.sales(
    id,
    studio_id,
    student_id,
    folio,
    currency,
    total_minor,
    created_by
  ) values (
    v_sale_id,
    v_attempt.studio_id,
    v_attempt.student_id,
    v_folio,
    v_attempt.currency,
    v_attempt.amount_minor,
    null
  );

  insert into public.sale_lines(
    studio_id,
    sale_id,
    product_template_id,
    product_name,
    quantity,
    unit_price_minor,
    line_total_minor
  ) values (
    v_attempt.studio_id,
    v_sale_id,
    v_attempt.product_template_id,
    v_attempt.product_name_snapshot,
    1,
    v_attempt.amount_minor,
    v_attempt.amount_minor
  ) returning id into v_sale_line_id;

  insert into public.payments(
    studio_id,
    sale_id,
    kind,
    amount_minor,
    method,
    reference,
    notes,
    created_by
  ) values (
    v_attempt.studio_id,
    v_sale_id,
    'payment',
    v_attempt.amount_minor,
    'mercado_pago',
    trim(target_provider_payment_id),
    'Mercado Pago Order ' || trim(target_provider_order_id),
    null
  );

  insert into public.product_acquisitions(
    studio_id,
    student_id,
    product_template_id,
    status,
    starts_on,
    expires_on,
    credit_limit,
    unlimited,
    sale_line_id
  ) values (
    v_attempt.studio_id,
    v_attempt.student_id,
    v_attempt.product_template_id,
    'active',
    v_sale_date,
    v_sale_date + v_attempt.validity_days_snapshot,
    v_attempt.credit_limit_snapshot,
    v_attempt.unlimited_snapshot,
    v_sale_line_id
  ) returning id into v_acquisition_id;

  if not v_attempt.unlimited_snapshot and coalesce(v_attempt.credit_limit_snapshot, 0) > 0 then
    insert into public.credit_ledger(
      studio_id,
      acquisition_id,
      movement_type,
      quantity,
      note,
      created_by
    ) values (
      v_attempt.studio_id,
      v_acquisition_id,
      'grant',
      v_attempt.credit_limit_snapshot,
      'Venta Mercado Pago ' || v_folio,
      null
    );
  end if;

  update public.online_checkout_attempts
  set provider_payment_id = trim(target_provider_payment_id),
      status = 'approved',
      provider_status = trim(target_provider_status),
      provider_status_detail = trim(target_provider_status_detail),
      sale_id = v_sale_id,
      approved_at = now(),
      processed_at = now(),
      last_webhook_at = now(),
      failure_code = null,
      updated_at = now()
  where id = v_attempt.id;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'attempt_id', v_attempt.id,
    'sale_id', v_sale_id,
    'sale_line_id', v_sale_line_id,
    'acquisition_id', v_acquisition_id,
    'provider_payment_id', trim(target_provider_payment_id)
  );
end;
$$;

revoke all on function public.service_confirm_online_checkout_approved(
  uuid, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.service_confirm_online_checkout_approved(
  uuid, text, text, text, text, text, integer, text
) to service_role;
