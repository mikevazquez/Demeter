begin;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
set local request.jwt.claim.role='service_role';
do $$
declare source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772'; owner uuid; run jsonb; s uuid; c uuid; g uuid; session uuid; alternative uuid; contact uuid; req uuid; r jsonb; order_data jsonb; participants jsonb; group_row public.demi_group_bookings%rowtype; f public.demi_followups%rowtype; variant text; results jsonb:='[]'; original_price integer; before_payments integer; before_reservations integer;
begin
 select user_id into owner from public.studio_memberships where studio_id=source and role='owner' and active limit 1;
 foreach variant in array array['normal','late_without_hold','class_past','class_full','prospect_alternative'] loop
  run:=public.service_create_demi_uat_run(source,owner,'payment-flow-'||variant); s:=(run->>'studio_id')::uuid;
  session:=(run#>>'{fixtures,sessions,available}')::uuid; alternative:=(run#>>'{fixtures,sessions,alternative}')::uuid;
  select id into contact from public.crm_contacts where studio_id=s and person_id=(run#>>'{fixtures,people,prospect_existing,person_id}')::uuid;
  c:=gen_random_uuid();
  insert into public.assistant_conversations(id,studio_id,channel,context) values(c,s,'whatsapp',jsonb_build_object('crm_contact_id',contact));
  select count(*) into before_reservations from public.reservations where studio_id=s;
  if variant='prospect_alternative' then r:=public.service_prepare_demi_prospect_payment(s,c,contact,session,null);
  else r:=public.service_prepare_demi_group(s,c,session,1,1); end if; if r->>'ok'<>'true' then raise exception 'prepare:%',r; end if; g:=(r->>'group_id')::uuid;
  select * into group_row from public.demi_group_bookings where id=g;
  if (select count(*) from public.reservations where studio_id=s)<>before_reservations then raise exception 'request_holds_cup'; end if;
  if (select count(*) from public.demi_followups where studio_id=s and conversation_id=c and source_ref='payment:'||g)<>2
   or not exists(select 1 from public.demi_followups where conversation_id=c and step=1 and due_at=group_row.created_at+interval '2 hours')
   or not exists(select 1 from public.demi_followups where conversation_id=c and step=2 and due_at=group_row.created_at+interval '6 hours') then raise exception 'payment_reminder_timing'; end if;
  perform public.service_update_demi_followup_stage(s,c,'awaiting_receipt',null,'repeat-1');
  perform public.service_update_demi_followup_stage(s,c,'awaiting_receipt',null,'repeat-2');
  if (select count(*) from public.demi_followups where studio_id=s and conversation_id=c and kind='prospect')<>2 then raise exception 'repeat_payment_reminders'; end if;
  insert into public.demi_mercadopago_settings(studio_id,enabled) values(s,true);
  r:=public.service_prepare_demi_mercadopago(s,c,g); if r->>'ok'<>'true' then raise exception 'mp_prepare:%',r; end if; req:=(r->>'request_id')::uuid;
  update public.demi_payment_requests set provider_order_id='SYNTHETIC-'||req where id=req;
  order_data:=jsonb_build_object('id','SYNTHETIC-'||req,'external_reference','demi_'||req,'status','rejected');
  r:=public.service_apply_demi_mercadopago_order(req,order_data);
  if r->>'status'<>'rejected' or (select count(*) from public.reservations where studio_id=s)<>before_reservations then raise exception 'rejected_reserved'; end if;
  order_data:=order_data||jsonb_build_object('status','processed','status_detail','accredited','total_amount','150.00','total_paid_amount','150.00','currency','MXN','transactions',jsonb_build_object('payments',jsonb_build_array(jsonb_build_object('id','SYNTHETIC-PAY-'||req,'status','processed','status_detail','accredited','amount','150.00','paid_amount','150.00'))));
  if variant='late_without_hold' then update public.demi_group_bookings set expires_at=clock_timestamp()-interval '1 day' where id=g; end if;
  r:=public.service_apply_demi_mercadopago_order(req,order_data); if r->>'status'<>'approved' then raise exception 'approve:%',r; end if;
  select * into f from public.demi_followups where studio_id=s and conversation_id=c limit 1;
  if private.demi_followup_stop_reason(f,clock_timestamp())<>'payment_received' then raise exception 'paid_reminder_continues'; end if;
  if (select count(*) from public.reservations where studio_id=s)<>before_reservations then raise exception 'payment_invents_data'; end if;
  r:=public.service_resume_demi_paid_group(s,c,g);
  if r->>'status'<>'participant_data_required' then raise exception 'missing_data:%',r; end if;
  participants:=jsonb_build_array(jsonb_build_object('name','Pago Flujo UAT','phone',case when variant='prospect_alternative' then (select right(pc.value,10) from public.person_contacts pc join public.crm_contacts cc on cc.person_id=pc.person_id and cc.studio_id=pc.studio_id where cc.id=contact and pc.kind='phone' limit 1) else '9998887111' end));
  insert into public.assistant_tool_executions(studio_id,conversation_id,tool_call_id,tool_name,schema_version,permission_class,request_json,result_json,status)
  values(s,c,'payment-data-'||c,'complete_group_booking',1,'B',jsonb_build_object('group_id',g,'participants',participants),'{}','blocked');
  if variant in ('class_past','prospect_alternative') then update public.demi_group_bookings set session_id=(run#>>'{fixtures,sessions,past}')::uuid where id=g; end if;
  if variant='class_full' then update public.demi_group_bookings set session_id=(run#>>'{fixtures,sessions,full}')::uuid where id=g; end if;
  if variant in ('class_past','class_full','prospect_alternative') then
   r:=public.service_resume_demi_paid_group(s,c,g);
   if r->>'alternative_required'<>'true' or r->>'payment_received'<>'true' or (select count(*) from public.reservations where studio_id=s)<>before_reservations then raise exception 'unavailable_not_preserved:%',r; end if;
   if exists(select 1 from public.assistant_handoffs where conversation_id=c and status='open') then raise exception 'ordinary_alternative_paused'; end if;
   r:=public.service_reselect_demi_paid_group(source,c,g,alternative,null);
   if r->>'reason_code'<>'group_not_found' then raise exception 'cross_studio_reselect'; end if;
   if variant='prospect_alternative' then r:=public.service_prepare_demi_prospect_payment(s,c,contact,alternative,null);
   else r:=public.service_prepare_demi_group(s,c,alternative,1,1); end if;
   if r->>'payment_preserved'<>'true' or r->>'group_id'<>g::text then raise exception 'alternative_new_payment:%',r; end if;
  end if;
  r:=public.service_resume_demi_paid_group(s,c,g);
  if r->>'status'<>'validated' or r->>'reserved_count'<>'1' or r->>'payment_validation_required'<>'false' then raise exception 'automatic_booking:%',r; end if;
  if (select count(*) from public.payments where studio_id=s)<>1 or (select count(*) from public.reservations where studio_id=s)<>before_reservations+1 then raise exception 'finance_counts'; end if;
  r:=public.service_resume_demi_paid_group(s,c,g);
  if r->>'idempotent'<>'true' or (select count(*) from public.payments where studio_id=s)<>1 or (select count(*) from public.reservations where studio_id=s)<>before_reservations+1 then raise exception 'resume_duplicate:%',r; end if;
  r:=public.service_reselect_demi_paid_group(s,c,g,alternative,null);
  if r->>'ok'<>'false' then raise exception 'allocated_payment_moved'; end if;
  if exists(select 1 from public.payments p join public.assistant_transfer_purchase_intents i on i.sale_id=p.sale_id join public.product_acquisitions a on a.id=i.acquisition_id join public.class_sessions cs on cs.id=i.session_id join public.studios st on st.id=i.studio_id where p.studio_id=s and (a.starts_on<>(cs.starts_at at time zone st.timezone)::date or a.expires_on<>a.starts_on+7)) then raise exception 'credit_wrong_date'; end if;
  results:=results||jsonb_build_array(jsonb_build_object('variant',variant,'passed',true));
 end loop;
 perform set_config('uat.payment_flow_results',results::text,true);
end $$;
select current_setting('uat.payment_flow_results')::jsonb results;
rollback;

