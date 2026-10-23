-- Preserve the published profile RPC and reuse the existing sale-payment authority.
-- Sale -> purchase is the same lock order used by Hoy and overdue evaluation.
create or replace function public.admin_register_workshop_payment(
 p_studio_id uuid,p_purchase_id uuid,p_payment_amount_minor integer,p_payment_method text,
 p_payment_reference text default null,p_payment_notes text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare purchase public.workshop_purchases%rowtype; sale public.sales%rowtype; old public.payments%rowtype;
 method text; v_reference text:=btrim(p_payment_reference); result jsonb;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
  or not coalesce(private.has_capability(p_studio_id,'sales.write'),false)
  or not coalesce(private.has_capability(p_studio_id,'students.read'),false)
  or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
  or not exists(select 1 from public.studios where id=p_studio_id and status='active') then raise exception 'forbidden'; end if;
 method:=case btrim(p_payment_method) when 'efectivo' then 'cash' when 'transferencia' then 'bank_transfer' else btrim(p_payment_method) end;
 if p_payment_amount_minor is null or p_payment_amount_minor<=0 then raise exception 'payment_invalid'; end if;
 if method is null or method not in ('cash','bank_transfer') then raise exception 'payment_method_required'; end if;
 if v_reference is null or length(v_reference) not between 3 and 200 then raise exception 'payment_reference_required'; end if;
 if not exists(select 1 from public.studio_payment_methods where studio_id=p_studio_id and code=method and active) then raise exception 'payment_method_unavailable'; end if;
 select * into purchase from public.workshop_purchases where studio_id=p_studio_id and id=p_purchase_id;
 if not found then raise exception 'workshop_purchase_not_found'; end if;
 select * into sale from public.sales where studio_id=p_studio_id and id=purchase.sale_id and student_id=purchase.student_id for update;
 if not found then raise exception 'sale_not_found'; end if;
 select * into purchase from public.workshop_purchases where studio_id=p_studio_id and id=p_purchase_id and sale_id=sale.id for update;
 if sale.status<>'confirmed' then raise exception 'sale_not_open'; end if;
 select * into old from public.payments where studio_id=p_studio_id and sale_id=sale.id and kind='payment' and payments.reference=v_reference order by id limit 1;
 if found then
  if old.amount_minor<>p_payment_amount_minor or old.method<>method then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('ok',true,'purchase_id',purchase.id,'sale_id',sale.id,'student_id',purchase.student_id,
   'paid_minor',purchase.paid_minor,'balance_minor',greatest(0,purchase.total_minor-purchase.paid_minor),'replayed',true);
 end if;
 if purchase.status not in ('reserved','pending_payment') then raise exception 'workshop_purchase_not_open'; end if;
 result:=public.admin_register_sale_payment(sale.id,p_payment_amount_minor,method,v_reference,p_payment_notes,null);
 select * into purchase from public.workshop_purchases where id=p_purchase_id;
 return result||jsonb_build_object('purchase_id',purchase.id,'student_id',purchase.student_id,
  'paid_minor',purchase.paid_minor,'balance_minor',greatest(0,purchase.total_minor-purchase.paid_minor),'replayed',false);
end $$;
revoke all on function public.admin_register_workshop_payment(uuid,uuid,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_register_workshop_payment(uuid,uuid,integer,text,text,text) to authenticated;
