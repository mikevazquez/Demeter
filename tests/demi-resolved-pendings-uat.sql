-- DEMI-BASE-03 · UAT for migration 20261021190000_demi_supersede_resolved_pendings.
-- Run in Sandbox only, inside an isolated Demi UAT tenant. Everything is rolled back.
-- Scenarios: covered pending closes; received/online/other-product pendings stay; the intent being
-- activated is never superseded; replays are idempotent.
begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  owner uuid; run jsonb; s uuid; st uuid; c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  session_ok uuid; pack uuid; other uuid; g uuid; g_received uuid; g_online uuid; i uuid; i_active uuid;
  sale uuid; line uuid; r jsonb;
begin
  select user_id into owner from public.studio_memberships
  where studio_id='9fe23cfa-fb47-4670-afeb-ed4a56433772' and role='owner' and active limit 1;
  run := public.service_create_demi_uat_run('9fe23cfa-fb47-4670-afeb-ed4a56433772',owner,'demi-base-03-resolved-pendings');
  s := (run->>'studio_id')::uuid;
  session_ok := (run#>>'{fixtures,sessions,available}')::uuid;
  select id into pack from public.product_templates where studio_id=s and name='Paquete UAT 8 clases';
  select id into other from public.product_templates where studio_id=s and name='Primera clase UAT';
  select id into st from public.students where studio_id=s and active and lifecycle_status='active' order by created_at limit 1;
  if s is null or session_ok is null or pack is null or other is null or st is null then
    raise exception 'fixtures_missing s=% session=% pack=% other=% student=%',s,session_ok,pack,other,st;
  end if;
  insert into public.assistant_conversations(id,studio_id,channel,external_thread_ref,student_id)
  values (c,s,'whatsapp','base03-'||c,st),(c2,s,'whatsapp','base03-'||c2,st);

  -- C1 · first-class pending without receipt is closed by a class-granting package.
  insert into public.demi_group_bookings(id,studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency)
  values (gen_random_uuid(),s,c,session_ok,1,1,15000,'MXN') returning id into g;
  -- C2 · a pending that already has its receipt flow started stays untouched.
  insert into public.demi_group_bookings(id,studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency,status)
  values (gen_random_uuid(),s,c2,session_ok,1,1,15000,'MXN','awaiting_participants') returning id into g_received;

  insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited)
  values (s,st,other,'active',current_date,current_date+1,1,false);
  if (select status from public.demi_group_bookings where id=g)<>'superseded' then raise exception 'C1_not_superseded'; end if;
  if (select superseded_reason from public.demi_group_bookings where id=g)<>'package_acquired' then raise exception 'C1_reason'; end if;
  if (select status from public.demi_group_bookings where id=g_received)<>'awaiting_participants' then raise exception 'C2_touched'; end if;

  -- C3 · a started Mercado Pago request keeps the pending in its own flow.
  update public.demi_group_bookings set status='rejected' where id=g_received;
  insert into public.demi_group_bookings(id,studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency)
  values (gen_random_uuid(),s,c2,session_ok,1,1,15000,'MXN') returning id into g_online;
  insert into public.demi_payment_requests(group_id,studio_id,conversation_id,amount_minor,currency,external_reference,status)
  values (g_online,s,c2,15000,'MXN','base03-'||g_online,'order_created');
  insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited)
  values (s,st,other,'active',current_date,current_date+1,1,false);
  if (select status from public.demi_group_bookings where id=g_online)<>'awaiting_receipt' then raise exception 'C3_online_touched'; end if;

  -- C4 · a package-purchase intent closes only when the SAME product is acquired elsewhere.
  r := public.service_prepare_transfer_purchase(s,c,st,null,pack);
  if r->>'ok'<>'true' then raise exception 'C4_prepare:%',r; end if;
  i := (r->>'intent_id')::uuid;
  insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited)
  values (s,st,other,'active',current_date,current_date+1,1,false);
  if (select status from public.assistant_transfer_purchase_intents where id=i)<>'awaiting_receipt' then raise exception 'C4_other_product_closed'; end if;
  insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited)
  values (s,st,pack,'active',current_date,current_date+30,8,false);
  if (select status from public.assistant_transfer_purchase_intents where id=i)<>'superseded' then raise exception 'C4_same_product_not_closed'; end if;

  -- C5 · the acquisition created FROM an intent (sale idempotency key = intent id) never supersedes it.
  r := public.service_prepare_transfer_purchase(s,c2,st,null,pack);
  if r->>'ok'<>'true' then raise exception 'C5_prepare:%',r; end if;
  i_active := (r->>'intent_id')::uuid;
  sale := gen_random_uuid();
  insert into public.sales(id,studio_id,student_id,folio,status,currency,total_minor,idempotency_key)
  values (sale,s,st,'UAT-'||left(replace(sale::text,'-',''),12),'confirmed','MXN',60000,i_active);
  insert into public.sale_lines(studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor)
  values (s,sale,pack,'Paquete UAT 8 clases',1,60000,60000) returning id into line;
  insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited,sale_line_id)
  values (s,st,pack,'active',current_date,current_date+30,8,false,line);
  if (select status from public.assistant_transfer_purchase_intents where id=i_active)<>'awaiting_receipt' then raise exception 'C5_origin_superseded'; end if;

  -- C6 · replay: another covering operation does not change already superseded rows.
  update public.product_acquisitions set status='active' where studio_id=s and student_id=st and product_template_id=other;
  if (select count(*) from public.demi_group_bookings where id=g and status='superseded')<>1 then raise exception 'C6_replay'; end if;

  if has_function_privilege('authenticated','private.supersede_demi_pendings_on_operation()','EXECUTE') then
    raise exception 'C7_permissions';
  end if;
end $$;
select 'passed' result, 7 controls, 'synthetic tenant; rollback; no external effects' scope;
rollback;
