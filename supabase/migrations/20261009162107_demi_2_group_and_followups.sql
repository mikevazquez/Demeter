-- Shared proof and explicit allocations: the payer is the conversation, not a participant.
create table public.demi_group_bookings (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 conversation_id uuid not null references public.assistant_conversations(id),
 session_id uuid not null references public.class_sessions(id),
 participant_count integer not null check(participant_count between 1 and 10),
 transfer_count integer not null check(transfer_count between 1 and participant_count),
 amount_minor integer not null check(amount_minor>0),
 currency text not null,
 status text not null default 'awaiting_receipt' check(status in ('awaiting_receipt','awaiting_participants','partial','provisional','validated','rejected')),
 receipt_event_id uuid references public.assistant_whatsapp_events(id),
 receipt_provider_id text,
 receipt_media_id text,
 receipt_sha256 text,
 receipt_path text,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default(clock_timestamp()+interval '24 hours'),
 unique(studio_id,receipt_sha256)
);
create unique index demi_group_open_conversation on public.demi_group_bookings(studio_id,conversation_id)
where status in ('awaiting_receipt','awaiting_participants','partial');
create table public.demi_group_participants (
 group_id uuid not null references public.demi_group_bookings(id),
 ordinal integer not null,
 student_id uuid references public.students(id),
 reservation_id uuid references public.reservations(id),
 transfer_intent_id uuid references public.assistant_transfer_purchase_intents(id),
 allocated_minor integer not null default 0,
 phone text not null,
 result jsonb not null default '{}',
 primary key(group_id,ordinal),
 unique(group_id,phone), unique(group_id,student_id)
);
alter table public.demi_group_bookings enable row level security;
alter table public.demi_group_participants enable row level security;
revoke all on public.demi_group_bookings,public.demi_group_participants from public,anon,authenticated;
grant all on public.demi_group_bookings,public.demi_group_participants to service_role;
grant select on public.demi_group_bookings,public.demi_group_participants to authenticated;
create policy demi_group_staff_read on public.demi_group_bookings for select to authenticated
using(private.has_capability(studio_id,'sales.read'));
create policy demi_group_participants_staff_read on public.demi_group_participants for select to authenticated
using(exists(select 1 from public.demi_group_bookings g where g.id=group_id and private.has_capability(g.studio_id,'sales.read')));

create function public.service_prepare_demi_group(p_studio uuid,p_conversation uuid,p_session uuid,p_count integer,p_transfer_count integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.class_sessions%rowtype; g public.demi_group_bookings%rowtype; price integer; curr text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if p_count not between 1 and 10 or p_transfer_count not between 1 and p_count then return jsonb_build_object('ok',false,'reason_code','invalid_count'); end if;
 if not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio) then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status in ('awaiting_receipt','awaiting_participants','partial') for update;
 if found then
  if g.session_id<>p_session or g.participant_count<>p_count or g.transfer_count<>p_transfer_count then return jsonb_build_object('ok',false,'reason_code','group_already_pending'); end if;
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'idempotent',true);
 end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.requires_resource then return jsonb_build_object('ok',false,'reason_code','group_resource_selection_required'); end if;
 if c.capacity-(select count(*) from public.reservations where session_id=c.id and status in ('reserved','attended'))<p_count then return jsonb_build_object('ok',false,'reason_code','session_full'); end if;
 select drop_in_price_minor into price from public.class_templates where id=c.template_id and studio_id=p_studio;
 select currency into curr from public.studios where id=p_studio;
 if coalesce(price,0)<=0 then return jsonb_build_object('ok',false,'reason_code','price_not_configured'); end if;
 insert into public.demi_group_bookings(studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency)
 values(p_studio,p_conversation,p_session,p_count,p_transfer_count,price*p_transfer_count,curr) returning * into g;
 return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'reservation_confirmed',false);
end; $$;

create function public.service_record_demi_group_receipt(p_studio uuid,p_conversation uuid,p_group uuid,p_event uuid,p_provider text,p_media text,p_path text,p_hash text,p_amount integer,p_currency text,p_confidence numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if not exists(select 1 from public.assistant_whatsapp_events where id=p_event and studio_id=p_studio and provider_event_id=p_provider and media_id=p_media) then return jsonb_build_object('ok',false,'reason_code','receipt_event_mismatch'); end if;
 if g.receipt_sha256 is not null then
  return jsonb_build_object('ok',g.receipt_sha256=p_hash,'reason_code',case when g.receipt_sha256=p_hash then null else 'group_already_has_receipt' end,'status',g.status,'idempotent',true);
 end if;
 if g.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'reason_code','group_expired'); end if;
 if coalesce(p_confidence,0)<0.75 or p_amount is null then return jsonb_build_object('ok',false,'reason_code','receipt_unreadable'); end if;
 if p_amount<>g.amount_minor or p_currency is distinct from g.currency then return jsonb_build_object('ok',false,'reason_code','receipt_amount_mismatch','expected_amount_minor',g.amount_minor); end if;
 if nullif(p_path,'') is null or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'reason_code','receipt_storage_required'); end if;
 if exists(select 1 from public.demi_group_bookings where studio_id=p_studio and receipt_sha256=p_hash)
 or exists(select 1 from public.assistant_transfer_purchase_intents where studio_id=p_studio and receipt_event_id=p_event) then return jsonb_build_object('ok',false,'reason_code','receipt_already_allocated'); end if;
 update public.demi_group_bookings set receipt_event_id=p_event,receipt_provider_id=p_provider,receipt_media_id=p_media,receipt_path=p_path,receipt_sha256=p_hash,status='awaiting_participants' where id=g.id;
 return jsonb_build_object('ok',true,'status','awaiting_participants','payment_validation_required',true,'reservation_confirmed',false);
end; $$;

create function public.service_complete_demi_group(p_studio uuid,p_conversation uuid,p_group uuid,p_participants jsonb)
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

create function public.admin_review_demi_group(p_group uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.demi_group_bookings%rowtype; row record;
begin
 select * into g from public.demi_group_bookings where id=p_group for update;
 if not found or auth.uid() is null or not private.has_capability(g.studio_id,'sales.write') then raise exception 'forbidden'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
 if g.status=(case when p_decision='approved' then 'validated' else 'rejected' end) then return jsonb_build_object('ok',true,'idempotent',true); end if;
 if g.status<>'provisional' then raise exception 'group_partial_requires_review'; end if;
 for row in select transfer_intent_id from public.demi_group_participants where group_id=g.id and transfer_intent_id is not null loop
  perform public.admin_review_transfer_purchase(row.transfer_intent_id,p_decision,p_note);
 end loop;
 update public.demi_group_bookings set status=case when p_decision='approved' then 'validated' else 'rejected' end where id=g.id;
 return jsonb_build_object('ok',true,'status',case when p_decision='approved' then 'validated' else 'rejected' end);
end; $$;
revoke all on function public.service_prepare_demi_group(uuid,uuid,uuid,integer,integer),public.service_record_demi_group_receipt(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,numeric),public.service_complete_demi_group(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_prepare_demi_group(uuid,uuid,uuid,integer,integer),public.service_record_demi_group_receipt(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,numeric),public.service_complete_demi_group(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.admin_review_demi_group(uuid,text,text) from public,anon;
grant execute on function public.admin_review_demi_group(uuid,text,text) to authenticated;
