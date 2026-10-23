-- Read-only conversation recovery. Payment, identity and capacity authority stay
-- in the existing workshop RPCs; a receipt is never proof of confirmed funds.
create function public.service_demi_workshop_context(p_studio uuid, p_conversation uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.assistant_conversations%rowtype;
  enabled boolean;
  pending jsonb;
begin
  if auth.role() is distinct from 'service_role'
    or not exists(select 1 from public.studios where id=p_studio and status='active')
  then raise exception 'forbidden'; end if;
  if p_conversation is not null then
    select * into c from public.assistant_conversations
      where id=p_conversation and studio_id=p_studio and assistant_key='demi' and status='open';
    if not found then raise exception 'conversation_identity_mismatch'; end if;
    select jsonb_build_object(
      'intent_ref','workshop-intent:'||i.id,
      'workshop_ref','workshop:'||i.offer_id,
      'title',o.title,'purchase_mode',i.selection_mode,
      'session_refs',(select jsonb_agg('session:'||s) from unnest(i.session_ids) s),
      'status',case
        when p.id is not null then case when p.status='reserved' then 'confirmed' else p.status end
        when h.state='confirmed' then 'review_required'
        when h.state in ('rejected','expired') then h.state
        when h.state='reserved_provisionally' and h.expires_at>now() then 'reserved_provisionally'
        when h.id is not null then 'expired'
        when i.status='cancelled' then 'cancelled'
        when i.expires_at<=now() then 'expired'
        else i.status end,
      'amount_minor',i.amount_minor,'total_minor',i.total_minor,'currency',i.currency,
      'paid_minor',coalesce(p.paid_minor,0),
      'balance_minor',case when p.id is not null then p.total_minor-p.paid_minor else i.total_minor end,
      'due_at',coalesce(p.balance_due_at,i.due_at),
      'expires_at',coalesce(h.expires_at,i.expires_at),
      'receipt_received',h.id is not null,
      'payment_verified',p.id is not null,
      'reservation_confirmed',coalesce(p.status='reserved',false),
      'capacity_held',coalesce(h.state='reserved_provisionally' and h.expires_at>now(),false),
      'purchase_ref',case when p.id is not null then 'purchase:'||p.id else null end
    ) into pending
    from public.demi_workshop_purchase_intents i
    join public.workshop_offers o on o.id=i.offer_id and o.studio_id=i.studio_id
    left join public.workshop_provisional_holds h on h.id=i.hold_id
      and h.studio_id=i.studio_id and h.student_id=i.student_id
    left join public.workshop_purchases p on p.studio_id=i.studio_id
      and p.student_id=i.student_id and p.idempotency_key=h.request_id
    where i.studio_id=p_studio and i.conversation_id=c.id and i.student_id=c.student_id
    order by i.created_at desc,i.id desc limit 1;
  end if;
  select coalesce((select demi_enabled from public.workshop_studio_policies where studio_id=p_studio),false) into enabled;
  return jsonb_build_object('ok',true,'enabled',enabled,
    'workshops',public.service_demi_workshop_catalog(p_studio),
    'current_purchase',pending);
end $$;
revoke all on function public.service_demi_workshop_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_demi_workshop_context(uuid,uuid) to service_role;
