-- SF-176 · Automatización MVP · Pago confirmado.
-- payment INSERT confirmado -> payment.confirmed -> dispatch asíncrono.
-- La automatización nunca debe revertir el pago si falla la infraestructura de mensajería.

create extension if not exists pg_net with schema extensions;

create or replace function public.verify_automation_dispatch_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vault.decrypted_secrets s
    where s.name = 'studio_flow_automation_dispatch_token'
      and s.decrypted_secret = p_token
      and nullif(trim(p_token), '') is not null
  );
$$;

revoke all on function public.verify_automation_dispatch_token(text)
  from public, anon, authenticated;
grant execute on function public.verify_automation_dispatch_token(text)
  to service_role;

create or replace function private.emit_payment_confirmed_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_concept text;
  v_package text;
  v_net_paid_minor integer;
  v_balance_minor integer;
begin
  if new.kind::text <> 'payment' or coalesce(new.amount_minor, 0) <= 0 then
    return new;
  end if;

  select *
    into v_sale
  from public.sales
  where id = new.sale_id;

  if not found or v_sale.status::text <> 'confirmed' then
    return new;
  end if;

  select
    string_agg(sl.product_name, ' + ' order by sl.created_at, sl.id),
    string_agg(
      sl.product_name,
      ' + ' order by sl.created_at, sl.id
    ) filter (where pt.product_type::text in ('package', 'membership'))
  into v_concept, v_package
  from public.sale_lines sl
  left join public.product_templates pt
    on pt.id = sl.product_template_id
  where sl.sale_id = new.sale_id
    and sl.refunded_at is null;

  select coalesce(sum(
    case
      when p.kind::text = 'payment' then p.amount_minor
      when p.kind::text = 'refund' then -p.amount_minor
      else 0
    end
  ), 0)::integer
  into v_net_paid_minor
  from public.payments p
  where p.sale_id = new.sale_id;

  v_balance_minor := greatest(v_sale.total_minor - v_net_paid_minor, 0);

  perform public.emit_domain_event(
    p_studio_id => new.studio_id,
    p_event_type => 'payment.confirmed',
    p_source_entity_type => 'payment',
    p_source_entity_id => new.id,
    p_deduplication_key => 'payment.confirmed:' || new.id::text,
    p_occurred_at => coalesce(new.created_at, now()),
    p_actor_user_id => new.created_by,
    p_payload => jsonb_build_object(
      'payment_id', new.id,
      'sale_id', new.sale_id,
      'student_id', v_sale.student_id,
      'sale_folio', v_sale.folio,
      'amount_minor', new.amount_minor,
      'currency', v_sale.currency,
      'method', new.method,
      'reference', new.reference,
      'concept', v_concept,
      'package', v_package,
      'balance_minor', v_balance_minor
    )
  );

  return new;
exception
  when others then
    -- La automatización es un efecto secundario; nunca revierte el pago.
    return new;
end;
$$;

drop trigger if exists sf176_emit_payment_confirmed on public.payments;
create trigger sf176_emit_payment_confirmed
after insert on public.payments
for each row
when (new.kind::text = 'payment')
execute function private.emit_payment_confirmed_event();

create or replace function private.dispatch_payment_confirmed_event_id(p_event_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_dispatch_token text;
  v_request_id bigint;
begin
  select s.decrypted_secret
    into v_project_url
  from vault.decrypted_secrets s
  where s.name = 'studio_flow_project_url'
  limit 1;

  select s.decrypted_secret
    into v_dispatch_token
  from vault.decrypted_secrets s
  where s.name = 'studio_flow_automation_dispatch_token'
  limit 1;

  if nullif(trim(v_project_url), '') is null
     or nullif(trim(v_dispatch_token), '') is null then
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/process-payment-confirmed',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-studio-flow-dispatch-token', v_dispatch_token
    ),
    body := jsonb_build_object('eventId', p_event_id)
  )
  into v_request_id;

  return v_request_id;
exception
  when others then
    return null;
end;
$$;

revoke all on function private.dispatch_payment_confirmed_event_id(uuid)
  from public, anon, authenticated;
grant execute on function private.dispatch_payment_confirmed_event_id(uuid)
  to service_role;

create or replace function private.dispatch_payment_confirmed_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.dispatch_payment_confirmed_event_id(new.event_id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists sf176_dispatch_payment_confirmed on public.domain_events;
create trigger sf176_dispatch_payment_confirmed
after insert on public.domain_events
for each row
when (new.event_type = 'payment.confirmed')
execute function private.dispatch_payment_confirmed_event();
