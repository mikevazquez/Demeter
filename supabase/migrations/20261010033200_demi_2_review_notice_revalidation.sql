create function public.service_revalidate_demi_receipt_review_notice(p_request uuid,p_lease uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n public.demi_receipt_review_notices%rowtype; eligible boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into n from public.demi_receipt_review_notices where id=p_request and notification_status='claimed' and notification_lease=p_lease and notification_claimed_at>clock_timestamp()-interval '5 minutes' for update;
 if not found then return jsonb_build_object('eligible',false,'reason_code','notification_lease_lost'); end if;
 if n.source_kind='enrollment' then
  select exists(select 1 from public.demi_enrollment_receipts r join public.assistant_enrollment_intents i on i.id=r.intent_id and i.studio_id=r.studio_id where r.id=n.source_id and r.studio_id=n.studio_id and r.status=n.decision and i.status=n.decision and i.receipt_reference=r.id::text and i.conversation_id=n.conversation_id) into eligible;
 else
  select exists(select 1 from public.assistant_transfer_purchase_intents i where i.id=n.source_id and i.studio_id=n.studio_id and i.conversation_id=n.conversation_id and i.status='rejected'
   and not exists(select 1 from public.assistant_transfer_purchase_intents newer where newer.studio_id=i.studio_id and newer.conversation_id=i.conversation_id and newer.created_at>i.created_at and newer.status='validated')) into eligible;
 end if;
 if not eligible then update public.demi_receipt_review_notices set notification_status='review',notification_error='review_outcome_superseded',notification_lease=null where id=n.id; end if;
 return jsonb_build_object('eligible',eligible,'reason_code',case when eligible then null else 'review_outcome_superseded' end);
end $$;
revoke all on function public.service_revalidate_demi_receipt_review_notice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_revalidate_demi_receipt_review_notice(uuid,uuid) to service_role;
