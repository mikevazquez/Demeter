do $$ begin
  create type public.online_checkout_status as enum (
    'created',
    'preference_created',
    'pending',
    'approved',
    'rejected',
    'cancelled',
    'expired',
    'error'
  );
exception when duplicate_object then null; end $$;

alter table public.product_templates
  add column if not exists online_purchasable boolean not null default false;

create table public.online_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  product_template_id uuid not null references public.product_templates(id) on delete restrict,
  provider text not null default 'mercado_pago'
    check (provider in ('mercado_pago')),
  client_request_key uuid not null,
  external_reference text not null,
  preference_id text,
  provider_payment_id text,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status public.online_checkout_status not null default 'created',
  provider_status text,
  provider_status_detail text,
  init_point text,
  sandbox_init_point text,
  sale_id uuid references public.sales(id) on delete restrict,
  approved_at timestamptz,
  processed_at timestamptz,
  last_webhook_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, client_request_key),
  unique (external_reference),
  check (external_reference = 'STFLOW-MP-' || id::text),
  check ((status = 'approved' and approved_at is not null) or status <> 'approved'),
  check (processed_at is null or sale_id is not null)
);

create unique index online_checkout_attempts_preference_unique
  on public.online_checkout_attempts(provider, preference_id)
  where preference_id is not null;

create unique index online_checkout_attempts_payment_unique
  on public.online_checkout_attempts(provider, provider_payment_id)
  where provider_payment_id is not null;

create index online_checkout_attempts_student_created_idx
  on public.online_checkout_attempts(studio_id, student_id, created_at desc);

create index online_checkout_attempts_status_idx
  on public.online_checkout_attempts(provider, status, updated_at);

alter table public.online_checkout_attempts enable row level security;

create policy online_checkout_attempts_student_self_read
on public.online_checkout_attempts for select to authenticated
using (private.is_current_student(student_id, studio_id));

create policy online_checkout_attempts_staff_read
on public.online_checkout_attempts for select to authenticated
using ((select private.has_capability(studio_id, 'sales.read')));

grant select on public.online_checkout_attempts to authenticated;
revoke insert, update, delete on public.online_checkout_attempts from public, anon, authenticated;
revoke all on public.online_checkout_attempts from anon;

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
    'preference_id', v_attempt.preference_id,
    'init_point', v_attempt.init_point,
    'sandbox_init_point', v_attempt.sandbox_init_point,
    'created_at', v_attempt.created_at
  );
end;
$$;

revoke all on function public.student_create_online_checkout_attempt(uuid, uuid)
  from public, anon;
grant execute on function public.student_create_online_checkout_attempt(uuid, uuid)
  to authenticated;

