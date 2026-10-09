begin;
do $$
declare s uuid:='23ad2da8-046c-4aea-b769-e0a001227405'; rid uuid:='4aab740d-dfbf-4373-81e3-f598cbc15da6'; a jsonb;b jsonb;
begin
a:=public.service_get_reservation_checkin_token(s,rid);b:=public.service_get_reservation_checkin_token(s,rid);
if a->>'ok'<>'true' or coalesce(a->>'token','')='' or a->>'token'<>b->>'token' then raise exception 'qr_unstable_or_missing'; end if;
b:=public.service_get_reservation_checkin_token('9fe23cfa-fb47-4670-afeb-ed4a56433772',rid);
if b->>'reason_code'<>'reservation_not_found' or b ? 'token' then raise exception 'qr_studio_scope';end if;
update public.reservation_checkin_tokens set revoked_at=clock_timestamp() where reservation_id=rid and studio_id=s;
b:=public.service_get_reservation_checkin_token(s,rid);
if b->>'reason_code'<>'reservation_not_valid' or b ? 'token' then raise exception 'qr_revocation';end if;
if has_function_privilege('anon','public.service_get_reservation_checkin_token(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','public.service_get_reservation_checkin_token(uuid,uuid)','EXECUTE') then raise exception 'qr_service_access';end if;
end $$;
select 'passed' result,4 variants,'no tokens disclosed; rollback' scope;
rollback;
