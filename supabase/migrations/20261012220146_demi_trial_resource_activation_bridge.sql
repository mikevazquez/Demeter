-- A receipt activation already carries the participant's validated resource.
-- Keep ordinary previews blocked until a resource is explicitly selected.
do $migration$
declare original text; changed text; needle text;
begin
 select pg_get_functiondef('private.assistant_trial_booking_preview_demi2_base(uuid,uuid,uuid,uuid)'::regprocedure) into original;
 needle:='if coalesce(v_session.requires_resource,false) then';
 if position(needle in original)=0 then raise exception 'unexpected_trial_resource_guard'; end if;
 changed:=replace(original,needle,$replacement$
 if coalesce(v_session.requires_resource,false) and not (
  auth.role()='service_role' and exists(
   select 1 from public.assistant_transfer_purchase_intents i
   join public.session_resources sr on sr.studio_id=i.studio_id and sr.session_id=i.session_id and sr.resource_id=i.resource_id
   join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id
   where i.id::text=current_setting('demi.trial_payment_activation',true)
    and i.studio_id=target_studio_id and i.student_id=target_student_id
    and i.session_id=target_session_id and i.intent_kind='trial_class'
    and i.status='awaiting_receipt' and i.expires_at>clock_timestamp()
    and sr.enabled and r.active and r.space_id=v_session.space_id
    and coalesce(sr.capacity_override,v_session.resource_uses_per_item,1)>
     (select count(*) from public.reservation_resource_assignments ra where ra.studio_id=sr.studio_id and ra.session_id=sr.session_id and ra.resource_id=sr.resource_id and ra.released_at is null)
  )
 ) then
 $replacement$);
 execute changed;
end; $migration$;
