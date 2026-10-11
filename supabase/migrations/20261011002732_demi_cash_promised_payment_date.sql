create or replace function public.service_create_demi_cash_purchase_with_due_date(
 p_studio uuid,p_conversation uuid,p_student uuid,p_product uuid,p_key uuid,p_expected_amount integer,p_due_on date
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; today date; sale uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select (clock_timestamp() at time zone timezone)::date into today from public.studios where id=p_studio;
 if today is null then return jsonb_build_object('ok',false,'reason_code','studio_not_found'); end if;
 if p_due_on is not null and (p_due_on<today or p_due_on>today+90) then
  return jsonb_build_object('ok',false,'reason_code','payment_due_date_invalid');
 end if;
 result:=public.service_create_demi_cash_purchase(p_studio,p_conversation,p_student,p_product,p_key,p_expected_amount);
 if not coalesce((result->>'ok')::boolean,false) then return result; end if;
 sale:=(result->>'sale_id')::uuid;
 if not coalesce((result->>'idempotent')::boolean,false) then
  update public.sales set payment_due_on=p_due_on,
   collection_note='Efectivo declarado: pendiente de cobro. Una primera reserva permitida.' || case when p_due_on is null then ' Fecha de pago no indicada.' else ' Pago prometido para '||p_due_on::text||'.' end
  where id=sale and studio_id=p_studio and student_id=p_student;
 end if;
 return result||jsonb_build_object('payment_due_on',(select payment_due_on from public.sales where id=sale and studio_id=p_studio));
end; $$;
revoke all on function public.service_create_demi_cash_purchase_with_due_date(uuid,uuid,uuid,uuid,uuid,integer,date) from public,anon,authenticated;
grant execute on function public.service_create_demi_cash_purchase_with_due_date(uuid,uuid,uuid,uuid,uuid,integer,date) to service_role;
