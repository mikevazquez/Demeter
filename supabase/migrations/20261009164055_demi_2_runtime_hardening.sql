create or replace function public.service_complete_demi_group(p_studio uuid,p_conversation uuid,p_group uuid,p_participants jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype; item jsonb; idx integer:=0; st public.students%rowtype;
 person uuid; contact uuid; child uuid; intent uuid; allocation integer; total integer; r jsonb; out jsonb:='[]'; n integer; slot public.demi_group_participants%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if g.status not in ('awaiting_participants','partial','provisional','validated') or g.receipt_event_id is null then return jsonb_build_object('ok',false,'reason_code','receipt_required_before_participants'); end if;
 if jsonb_typeof(p_participants)<>'array' or jsonb_array_length(p_participants)<>g.participant_count then return jsonb_build_object('ok',false,'reason_code','participant_count_mismatch'); end if;
 if exists(select 1 from jsonb_array_elements(p_participants) x where coalesce(x->>'phone','') !~ '^[0-9]{10}$' or length(trim(coalesce(x->>'name','')))<3)
 then return jsonb_build_object('ok',false,'reason_code','participant_data_required'); end if;
 if (select count(distinct x->>'phone') from jsonb_array_elements(p_participants) x)<>g.participant_count then
  perform public.assistant_create_handoff(p_studio,p_conversation,null,'group_duplicate_phone','Dos participantes comparten teléfono; no se inventó ni se fusionó identidad.');
  return jsonb_build_object('ok',false,'reason_code','duplicate_participant_phone');
 end if;
 if exists(select 1 from public.demi_group_participants gp join jsonb_array_elements(p_participants) with ordinality x(value,ordinal) on x.ordinal=gp.ordinal where gp.group_id=g.id and gp.phone is distinct from x.value->>'phone') then return jsonb_build_object('ok',false,'reason_code','participant_identity_changed'); end if;
 if g.status in ('validated','provisional') then
  select coalesce(jsonb_agg(result order by ordinal),'[]'::jsonb),count(reservation_id),coalesce(sum(allocated_minor),0) into out,n,total from public.demi_group_participants where group_id=g.id;
  return jsonb_build_object('ok',true,'status',g.status,'participants',out,'reserved_count',n,'allocated_minor',total,'unallocated_minor',g.amount_minor-total,'payment_validation_required',g.status='provisional','idempotent',true);
 end if;
 if not exists(select 1 from public.class_sessions where id=g.session_id and studio_id=p_studio and status='scheduled' and starts_at>clock_timestamp()+interval '30 minutes') then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 -- All rows lock the session in one transaction; concurrent groups cannot oversell.
 perform 1 from public.class_sessions where id=g.session_id and studio_id=p_studio for update;
 for item in select value from jsonb_array_elements(p_participants) loop
  idx:=idx+1;
  select * into slot from public.demi_group_participants where group_id=g.id and ordinal=idx;
  if found and slot.phone<>item->>'phone' then return jsonb_build_object('ok',false,'reason_code','participant_identity_changed'); end if;
  if slot.reservation_id is not null then out:=out||jsonb_build_array(slot.result||jsonb_build_object('idempotent',true)); continue; end if;
  begin
   select * into st from public.students where studio_id=p_studio and phone='+52'||(item->>'phone') and lifecycle_status<>'archived' for update;
   if not found then
    select pc.person_id into person from public.person_contacts pc join public.crm_contacts cc on cc.person_id=pc.person_id and cc.studio_id=pc.studio_id where pc.studio_id=p_studio and pc.kind='phone' and pc.value='+52'||(item->>'phone') limit 1;
    if person is null then
     insert into public.persons(studio_id,first_name,last_name) values(p_studio,trim(item->>'name'),null) returning id into person;
     insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(p_studio,person,'phone','+52'||(item->>'phone'),true);
    end if;
    insert into public.crm_contacts(studio_id,person_id,lifecycle_status,source) values(p_studio,person,'prospect','demi_group') on conflict do nothing;
    select id into contact from public.crm_contacts where studio_id=p_studio and person_id=person;
    r:=public.assistant_ensure_trial_student(p_studio,contact);
    if not coalesce((r->>'ok')::boolean,false) then raise exception 'group_identity:%',r; end if;
    select * into st from public.students where id=(r->>'student_id')::uuid;
   end if;
   allocation:=0;
   if st.student_type='trial' and st.trial_status is distinct from 'attended' and st.trial_status is distinct from 'converted' then
    if exists(select 1 from public.reservations where studio_id=p_studio and student_id=st.id and status='reserved') then
     r:=jsonb_build_object('ok',false,'reason_code','trial_reservation_already_pending');
    else
     allocation:=g.amount_minor/g.transfer_count;
     select coalesce(sum(allocated_minor),0) into total from public.demi_group_participants where group_id=g.id and ordinal<>idx;
     if total+allocation>g.amount_minor then raise exception 'group_allocation_exceeded'; end if;
     child:=gen_random_uuid();
     insert into public.assistant_conversations(id,studio_id,student_id,channel,context) values(child,p_studio,st.id,'internal_demo',jsonb_build_object('group_id',g.id,'payer_conversation',g.conversation_id));
     r:=public.service_prepare_trial_transfer(p_studio,child,st.id,g.session_id,null);
     if coalesce((r->>'ok')::boolean,false) then
      intent:=(r->>'intent_id')::uuid;
      if (select amount_minor from public.assistant_transfer_purchase_intents where id=intent)<>allocation then raise exception 'group_quote_changed'; end if;
      update public.assistant_transfer_purchase_intents set receipt_amount_matches=true,receipt_storage_path=g.receipt_path where id=intent;
      r:=public.service_activate_trial_transfer_receipt(p_studio,child,st.id,intent,g.receipt_event_id,'group-allocation:'||g.id||':'||idx,g.receipt_media_id);
     end if;
    end if;
   else
    r:=public.service_book_student(p_studio,g.session_id,st.id);
    r:=r||jsonb_build_object('ok',coalesce((r->>'eligible')::boolean,false));
   end if;
   if not coalesce((r->>'ok')::boolean,false) then allocation:=0; end if;
   r:=r||jsonb_build_object('ordinal',idx,'participant_name',item->>'name');
   insert into public.demi_group_participants(group_id,ordinal,student_id,reservation_id,transfer_intent_id,allocated_minor,phone,result)
   values(g.id,idx,st.id,nullif(r->>'reservation_id','')::uuid,intent,allocation,item->>'phone',r)
   on conflict(group_id,ordinal) do update set student_id=excluded.student_id,reservation_id=excluded.reservation_id,transfer_intent_id=excluded.transfer_intent_id,allocated_minor=excluded.allocated_minor,result=excluded.result;
  exception when others then
   r:=jsonb_build_object('ok',false,'ordinal',idx,'participant_name',item->>'name','reason_code','participant_operation_failed','error_code',sqlstate);
   insert into public.demi_group_participants(group_id,ordinal,phone,result) values(g.id,idx,item->>'phone',r)
   on conflict(group_id,ordinal) do update set result=excluded.result;
  end;
  out:=out||jsonb_build_array(r);
  person:=null; contact:=null; intent:=null; slot:=null;
 end loop;
 select count(reservation_id),coalesce(sum(allocated_minor),0) into n,total from public.demi_group_participants where group_id=g.id;
 update public.demi_group_bookings set status=case when n=g.participant_count and total=g.amount_minor then 'provisional' else 'partial' end where id=g.id;
 if n<>g.participant_count or total<>g.amount_minor then perform public.assistant_create_handoff(p_studio,p_conversation,null,'group_partial','Resultado parcial de grupo '||g.id||'; revisar reservas e importe no asignado.'); end if;
 return jsonb_build_object('ok',n=g.participant_count and total=g.amount_minor,'status',case when n=g.participant_count and total=g.amount_minor then 'provisional' else 'partial' end,'participants',out,'reserved_count',n,'allocated_minor',total,'unallocated_minor',g.amount_minor-total,'payment_validation_required',true);
end; $$;

create or replace function public.service_update_demi_followup_stage(p_studio uuid,p_conversation uuid,p_stage text,p_reason text default null,p_source text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare person uuid; c public.assistant_conversations%rowtype; q text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio;
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 select person_id into person from public.students where id=c.student_id and studio_id=p_studio;
 if person is null then select person_id into person from public.crm_contacts where id=nullif(c.context->>'crm_contact_id','')::uuid and studio_id=p_studio; end if;
 if person is null then return jsonb_build_object('ok',false,'reason_code','identity_required'); end if;
 if p_stage not in ('answering_questions','awaiting_receipt','awaiting_participant_data','not_booked','not_qualified','opt_out') then return jsonb_build_object('ok',false,'reason_code','invalid_stage'); end if;
 if p_stage='not_qualified' and length(trim(coalesce(p_reason,'')))<3 then return jsonb_build_object('ok',false,'reason_code','qualification_reason_required'); end if;
 q:=case when p_stage='not_qualified' then 'not_qualified' else 'pending' end;
 insert into public.crm_followups(studio_id,person_id,prospect_stage,qualification,qualification_reason,revision)
 values(p_studio,person,case when p_stage in ('not_qualified','opt_out') then 'answering_questions' else p_stage end,q,case when q='not_qualified' then p_reason else null end,1)
 on conflict(studio_id,person_id) do update set prospect_stage=excluded.prospect_stage,qualification=excluded.qualification,qualification_reason=excluded.qualification_reason,revision=public.crm_followups.revision+1,updated_at=clock_timestamp();
 if p_stage in ('not_qualified','opt_out','not_booked') then
  update public.demi_followups set state='cancelled',reason_code=p_stage,lease_token=null,lease_until=null where studio_id=p_studio and person_id=person and state in ('pending','processing');
  if p_stage='opt_out' then
   insert into public.person_communication_preferences(studio_id,person_id,retention_enabled,promotions_enabled) values(p_studio,person,false,false)
   on conflict(studio_id,person_id) do update set retention_enabled=false,promotions_enabled=false,updated_at=clock_timestamp();
  end if;
 else
  if not exists(select 1 from public.students where studio_id=p_studio and person_id=person and student_type<>'trial') then
   perform public.service_schedule_demi_followups(p_studio,p_conversation,case when exists(select 1 from public.students where studio_id=p_studio and person_id=person and trial_status='attended') then 'post_trial' else 'prospect' end,coalesce(p_source,gen_random_uuid()::text),clock_timestamp());
  end if;
 end if;
 return jsonb_build_object('ok',true,'stage',p_stage,'qualification',q);
end; $$;
