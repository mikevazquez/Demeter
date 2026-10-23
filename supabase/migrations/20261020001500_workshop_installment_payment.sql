create or replace function public.admin_register_workshop_payment(
  p_studio_id uuid,
  p_purchase_id uuid,
  p_payment_amount_minor integer,
  p_payment_method text,
  p_payment_reference text default null,
  p_payment_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_purchase public.workshop_purchases%rowtype;
  v_sale public.sales%rowtype;
  v_gross_paid integer := 0;
  v_refunded integer := 0;
  v_net_collected integer := 0;
  v_balance integer := 0;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'unauthenticated';
  end if;
  if coalesce(p_payment_amount_minor, 0) <= 0 then
    raise exception 'payment_invalid';
  end if;
  if nullif(trim(coalesce(p_payment_method, '')), '') is null then
    raise exception 'payment_method_required';
  end if;

  select *
  into v_purchase
  from public.workshop_purchases
  where id = p_purchase_id
    and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'workshop_purchase_not_found';
  end if;
  if not coalesce(private.has_capability(p_studio_id, 'sales.write'), false) then
    raise exception 'forbidden';
  end if;

  select *
  into v_sale
  from public.sales
  where id = v_purchase.sale_id
    and studio_id = p_studio_id
    and student_id = v_purchase.student_id
  for update;

  if not found then
    raise exception 'sale_not_found';
  end if;
  if v_sale.status <> 'confirmed' then
    raise exception 'sale_not_open';
  end if;
  if v_purchase.status not in ('reserved', 'pending_payment') then
    raise exception 'workshop_purchase_not_open';
  end if;

  select
    coalesce(sum(case when p.kind = 'payment' then p.amount_minor else 0 end), 0)::integer,
    coalesce(sum(case when p.kind = 'refund' then p.amount_minor else 0 end), 0)::integer
  into v_gross_paid, v_refunded
  from public.payments p
  where p.sale_id = v_sale.id
    and p.studio_id = p_studio_id;

  v_net_collected := greatest(v_gross_paid - v_refunded, 0);
  v_balance := greatest(v_purchase.total_minor - v_net_collected, 0);

  if v_balance <= 0 then
    raise exception 'sale_already_paid';
  end if;
  if p_payment_amount_minor > v_balance then
    raise exception 'payment_exceeds_balance';
  end if;

  insert into public.payments(
    studio_id,
    sale_id,
    kind,
    amount_minor,
    method,
    reference,
    notes,
    created_by
  )
  values(
    p_studio_id,
    v_sale.id,
    'payment',
    p_payment_amount_minor,
    trim(p_payment_method),
    nullif(trim(coalesce(p_payment_reference, '')), ''),
    nullif(trim(coalesce(p_payment_notes, '')), ''),
    auth.uid()
  );

  v_gross_paid := v_gross_paid + p_payment_amount_minor;
  v_net_collected := greatest(v_gross_paid - v_refunded, 0);
  v_balance := greatest(v_purchase.total_minor - v_net_collected, 0);

  update public.workshop_purchases
  set
    paid_minor = least(total_minor, v_net_collected),
    balance_due_at = case when v_balance = 0 then null else balance_due_at end
  where id = v_purchase.id
    and studio_id = p_studio_id;

  if v_balance = 0 then
    update public.sales
    set payment_due_on = null,
        collection_note = null,
        updated_at = now()
    where id = v_sale.id
      and studio_id = p_studio_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'sale_id', v_sale.id,
    'paid_minor', least(v_purchase.total_minor, v_net_collected),
    'balance_minor', v_balance
  );
end
$function$;

revoke all on function public.admin_register_workshop_payment(uuid,uuid,integer,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_register_workshop_payment(uuid,uuid,integer,text,text,text)
  to authenticated;
