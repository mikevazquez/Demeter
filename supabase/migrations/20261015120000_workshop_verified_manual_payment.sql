-- LOCAL DEVELOPMENT ONLY: not applied to Sandbox or Production.
-- Requires the existing workshop schema and explicit purchase-mode migration.
-- Manual receipt attestation is limited to authenticated staff with sales.write.
-- No provider/webhook path is enabled by this migration.

create table public.workshop_payment_authorizations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  offer_id uuid not null references public.workshop_offers(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  idempotency_key uuid not null,
  selection_mode text not null check (selection_mode in ('full', 'sessions')),
  session_ids uuid[] not null check (cardinality(session_ids) between 1 and 100),
  total_minor integer not null check (total_minor > 0),
  amount_minor integer not null check (amount_minor > 0 and amount_minor <= total_minor),
  currency text not null check (currency = 'MXN'),
  provider text not null default 'manual_review' check (provider = 'manual_review'),
  provider_event_id text not null check (length(btrim(provider_event_id)) between 1 and 200),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer')),
  verified_at timestamptz not null default now(),
  verified_by uuid not null references auth.users(id) on delete restrict,
  consumed_purchase_id uuid unique references public.workshop_purchases(id) on delete restrict,
  consumed_at timestamptz,
  checkout_result jsonb,
  unique (studio_id, idempotency_key),
  unique (studio_id, provider, provider_event_id),
  check (
    (consumed_purchase_id is null and consumed_at is null and checkout_result is null)
    or (consumed_purchase_id is not null and consumed_at is not null and checkout_result is not null)
  )
);

alter table public.workshop_payment_authorizations enable row level security;
revoke all on public.workshop_payment_authorizations from public, anon, authenticated, service_role;
grant select on public.workshop_payment_authorizations to service_role;

-- Evidence cannot be edited or deleted; only the first atomic consumption is allowed.
create function private.workshop_payment_authorization_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'payment_authorization_immutable'; end if;
  if old.consumed_purchase_id is not null
     or new.consumed_purchase_id is null
     or (to_jsonb(new) - array['consumed_purchase_id', 'consumed_at', 'checkout_result'])
        is distinct from
        (to_jsonb(old) - array['consumed_purchase_id', 'consumed_at', 'checkout_result'])
  then raise exception 'payment_authorization_immutable'; end if;
  return new;
end $$;

create trigger workshop_payment_authorization_immutable
before update or delete on public.workshop_payment_authorizations
for each row execute function private.workshop_payment_authorization_immutable();

-- Stabilize offer settings/prices for both attestation and checkout. Existing
-- preflight locks class sessions in UUID order and rechecks shared Agenda capacity.
create function private.workshop_payment_quote(
  p_studio_id uuid, p_offer_id uuid, p_student_id uuid,
  p_session_ids uuid[], p_purchase_mode text
)
returns jsonb language plpgsql set search_path = '' as $$
declare v_quote jsonb; v_offer public.workshop_offers%rowtype; v_policy record; v_minimum numeric;
begin
  select * into v_offer from public.workshop_offers
  where studio_id = p_studio_id and id = p_offer_id for share;
  if not found then raise exception 'offer_not_found'; end if;
  select * into v_policy from public.workshop_studio_policies
  where studio_id = p_studio_id for share;
  if coalesce(v_offer.requires_enrollment, v_policy.requires_enrollment, false) then
    raise exception 'enrollment_verification_required';
  end if;
  perform 1 from public.workshop_offer_sessions where offer_id = p_offer_id
  order by session_id for share;
  v_quote := public.workshop_checkout_preflight_v2(
    p_studio_id, p_offer_id, p_student_id, p_session_ids, p_purchase_mode);
  if exists (select 1 from public.class_sessions
             where id = any(p_session_ids) and starts_at <= now()) then
    raise exception 'session_unavailable';
  end if;
  v_minimum := case v_offer.deposit_mode
    when 'full' then (v_quote->>'total_minor')::numeric
    when 'fixed' then least((v_quote->>'total_minor')::numeric, v_offer.deposit_value)
    when 'percent' then ceil((v_quote->>'total_minor')::numeric * v_offer.deposit_value / 100)
  end;
  if v_minimum is null or v_minimum < 0 or v_minimum <> trunc(v_minimum) then
    raise exception 'invalid_deposit';
  end if;
  return v_quote || jsonb_build_object('minimum_minor', v_minimum);
end $$;

create function public.admin_authorize_workshop_payment(
  p_studio_id uuid, p_offer_id uuid, p_student_id uuid, p_session_ids uuid[],
  p_purchase_mode text, p_idempotency_key uuid, p_amount_minor integer,
  p_currency text, p_payment_method text, p_payment_reference text, p_received boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_sessions uuid[]; v_quote jsonb; v_currency text;
  v_reference text := btrim(p_payment_reference);
  v_existing public.workshop_payment_authorizations%rowtype;
  v_id uuid;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated'
     or not coalesce(private.has_capability(p_studio_id, 'sales.write'), false) then
    raise exception 'forbidden';
  end if;
  -- An upload, OCR result, pending transfer or a service-role caller is not an attestation.
  if p_received is distinct from true then raise exception 'payment_not_verified'; end if;
  if p_idempotency_key is null or p_amount_minor is null or p_amount_minor <= 0
     or p_currency is distinct from 'MXN'
     or p_payment_method is null or p_payment_method not in ('cash', 'bank_transfer')
     or v_reference is null or length(v_reference) not between 1 and 200 then
    raise exception 'invalid_payment_authorization';
  end if;
  select array_agg(x order by x) into v_sessions from unnest(p_session_ids) x;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_studio_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.workshop_payment_authorizations
  where studio_id = p_studio_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.offer_id is distinct from p_offer_id
       or v_existing.student_id is distinct from p_student_id
       or v_existing.session_ids is distinct from v_sessions
       or v_existing.selection_mode is distinct from p_purchase_mode
       or v_existing.amount_minor is distinct from p_amount_minor
       or v_existing.currency is distinct from p_currency
       or v_existing.payment_method is distinct from p_payment_method
       or v_existing.provider_event_id is distinct from v_reference then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object('authorization_id', v_existing.id, 'replayed', true);
  end if;
  if exists (select 1 from public.workshop_purchases
             where studio_id = p_studio_id and idempotency_key = p_idempotency_key) then
    raise exception 'idempotency_conflict';
  end if;
  select currency into v_currency from public.studios where id = p_studio_id for share;
  if v_currency is distinct from p_currency then raise exception 'currency_mismatch'; end if;
  if not exists (select 1 from public.studio_payment_methods
                 where studio_id = p_studio_id and code = p_payment_method and active) then
    raise exception 'payment_method_unavailable';
  end if;
  v_quote := private.workshop_payment_quote(
    p_studio_id, p_offer_id, p_student_id, p_session_ids, p_purchase_mode);
  if p_amount_minor > (v_quote->>'total_minor')::integer then raise exception 'payment_exceeds_total'; end if;
  if p_amount_minor < (v_quote->>'minimum_minor')::numeric then raise exception 'insufficient_deposit'; end if;
  if p_amount_minor < (v_quote->>'total_minor')::integer and not exists (
    select 1 from public.workshop_offers where id = p_offer_id and balance_due_at is not null
  ) then raise exception 'balance_due_date_required'; end if;
  begin
    insert into public.workshop_payment_authorizations(
      studio_id, offer_id, student_id, idempotency_key, selection_mode, session_ids,
      total_minor, amount_minor, currency, provider_event_id, payment_method, verified_by
    ) values (
      p_studio_id, p_offer_id, p_student_id, p_idempotency_key, p_purchase_mode, v_sessions,
      (v_quote->>'total_minor')::integer, p_amount_minor, p_currency, v_reference, p_payment_method, v_actor
    ) returning id into v_id;
  exception when unique_violation then raise exception 'payment_event_conflict';
  end;
  return jsonb_build_object('authorization_id', v_id, 'replayed', false);
end $$;

-- The caller supplies only IDs: price, amount, method and selection come from
-- immutable reviewed evidence. This service-only RPC is intentionally not wired to UI/Demi.
create function public.workshop_checkout_confirm_authorized(
  p_studio_id uuid, p_authorization_id uuid, p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auth public.workshop_payment_authorizations%rowtype; v_quote jsonb; v_result jsonb;
begin
  if p_studio_id is null or p_idempotency_key is null or p_authorization_id is null then
    raise exception 'invalid_payment_authorization';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_studio_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_auth from public.workshop_payment_authorizations
  where id = p_authorization_id and studio_id = p_studio_id for update;
  if not found then raise exception 'payment_authorization_not_found'; end if;
  if v_auth.idempotency_key is distinct from p_idempotency_key then raise exception 'idempotency_conflict'; end if;
  if v_auth.consumed_purchase_id is not null then
    return v_auth.checkout_result || jsonb_build_object('replayed', true);
  end if;
  if exists (select 1 from public.workshop_purchases
             where studio_id = p_studio_id and idempotency_key = p_idempotency_key) then
    raise exception 'idempotency_conflict';
  end if;
  if not exists (select 1 from public.studios where id = p_studio_id and currency = v_auth.currency) then
    raise exception 'currency_mismatch';
  end if;
  v_quote := private.workshop_payment_quote(
    v_auth.studio_id, v_auth.offer_id, v_auth.student_id, v_auth.session_ids, v_auth.selection_mode);
  if (v_quote->>'total_minor')::integer is distinct from v_auth.total_minor then
    raise exception 'authorized_price_changed';
  end if;
  v_result := public.workshop_checkout_confirm_v2(
    v_auth.studio_id, v_auth.offer_id, v_auth.student_id, v_auth.session_ids,
    v_auth.selection_mode, v_auth.idempotency_key, v_auth.amount_minor,
    v_auth.payment_method, v_auth.provider_event_id);
  update public.workshop_payment_authorizations
  set consumed_purchase_id = (v_result->>'purchase_id')::uuid,
      consumed_at = now(), checkout_result = v_result
  where id = v_auth.id;
  return v_result;
end $$;

-- Retire both amount-taking entrypoints, including service-role access. The
-- authorized SECURITY DEFINER function can invoke v2 as owner within its transaction.
revoke all on function public.workshop_checkout_confirm(uuid,uuid,uuid,uuid[],uuid,integer,text,text)
from public, anon, authenticated, service_role;
revoke all on function public.workshop_checkout_confirm_v2(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text)
from public, anon, authenticated, service_role;
revoke all on function private.workshop_payment_authorization_immutable() from public, anon, authenticated, service_role;
revoke all on function private.workshop_payment_quote(uuid,uuid,uuid,uuid[],text) from public, anon, authenticated, service_role;
revoke all on function public.admin_authorize_workshop_payment(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,text,boolean)
from public, anon, authenticated, service_role;
grant execute on function public.admin_authorize_workshop_payment(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,text,boolean)
to authenticated;
revoke all on function public.workshop_checkout_confirm_authorized(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.workshop_checkout_confirm_authorized(uuid,uuid,uuid) to service_role;

comment on table public.workshop_payment_authorizations is
'Immutable staff attestation of received workshop funds; no OCR or provider verification implied. Consumption is atomic with checkout.';
