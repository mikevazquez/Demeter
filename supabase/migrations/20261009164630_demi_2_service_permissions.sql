-- Existing service-only RPCs check auth.role(); remove unnecessary public exposure too.
revoke all on function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text),public.service_prepare_trial_transfer(uuid,uuid,uuid,uuid,uuid),public.service_record_meta_whatsapp_referral(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text),public.service_prepare_trial_transfer(uuid,uuid,uuid,uuid,uuid),public.service_record_meta_whatsapp_referral(uuid,uuid,uuid,jsonb) to service_role;
create index demi_followup_person_pending on public.demi_followups(studio_id,person_id) where state in ('pending','processing');
create index demi_group_conversation_history on public.demi_group_bookings(studio_id,conversation_id,created_at desc);
