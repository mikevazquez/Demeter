begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare s uuid:='23ad2da8-046c-4aea-b769-e0a001227405'; t uuid:='7ba74303-90e1-4f0b-b358-94a9bf2a95c9'; sess uuid:='eaf629c4-dedd-4e26-a72c-077ff020797a'; r jsonb;
begin
insert into public.demi_first_class_payment_links(studio_id,class_template_id,checkout_url,amount_minor,currency,enabled,updated_by) values(s,t,'https://mpago.la/UAT-FICTICIO-NO-PAGAR',15000,'MXN',true,'00000000-0000-4000-8000-000000000001');
r:=public.service_get_demi_first_class_payment_options(s,sess);
if r#>>'{external_checkout,receipt_required}'<>'true' or r#>>'{external_checkout,test_only}'<>'true' then raise exception 'link_quote_failed'; end if;
r:=public.service_get_demi_first_class_payment_options('9fe23cfa-fb47-4670-afeb-ed4a56433772',sess);
if r->>'reason_code'<>'session_not_found' then raise exception 'studio_scope_failed'; end if;
update public.demi_first_class_payment_links set enabled=false where studio_id=s and class_template_id=t;
r:=public.service_get_demi_first_class_payment_options(s,sess);
if r->'external_checkout'<>'null'::jsonb then raise exception 'disabled_link_failed'; end if;
update public.demi_first_class_payment_links set enabled=true,amount_minor=10000 where studio_id=s and class_template_id=t;
r:=public.service_get_demi_first_class_payment_options(s,sess);
if r->'external_checkout'<>'null'::jsonb then raise exception 'stale_amount_failed'; end if;
update public.demi_first_class_payment_links set amount_minor=15000,currency='USD' where studio_id=s and class_template_id=t;
r:=public.service_get_demi_first_class_payment_options(s,sess);
if r->'external_checkout'<>'null'::jsonb then raise exception 'currency_failed'; end if;
begin
 update public.demi_first_class_payment_links set checkout_url='https://attacker.invalid/pay' where studio_id=s and class_template_id=t;
 raise exception 'invalid_host_allowed';
exception when check_violation then null; end;
if has_function_privilege('anon','public.service_get_demi_first_class_payment_options(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','public.service_get_demi_first_class_payment_options(uuid,uuid)','EXECUTE') then raise exception 'service_permissions_failed'; end if;
end $$;
select 'passed' result,7 variants,'synthetic; no provider request; rollback' scope;
rollback;
