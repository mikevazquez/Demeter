-- Demi quotes, explicit acceptance and receipt evidence use the existing conversation,
-- capacity gate, staff review and delivery queue. No receipt is treated as verified funds.
alter table public.workshop_studio_policies add column demi_enabled boolean not null default false;
create table public.demi_workshop_purchase_intents (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 conversation_id uuid not null references public.assistant_conversations(id), student_id uuid not null references public.students(id),
 offer_id uuid not null references public.workshop_offers(id), offer_revision integer not null,
 selection_mode text not null check(selection_mode in ('full','sessions')), session_ids uuid[] not null,
 amount_minor integer not null check(amount_minor>0), total_minor integer not null check(total_minor>=amount_minor),
 currency text not null check(currency='MXN'), due_at timestamptz not null,
 terms_version text not null default 'workshop-20261016-v1',
 status text not null default 'quoted' check(status in ('quoted','receipt_required','held','cancelled')),
 prepared_turn_id uuid not null references public.assistant_turns(id), accepted_turn_id uuid references public.assistant_turns(id),
 hold_id uuid unique references public.workshop_provisional_holds(id), expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(), unique(studio_id,prepared_turn_id)
);
create unique index demi_workshop_pending_receipt on public.demi_workshop_purchase_intents(studio_id,conversation_id)
 where status='receipt_required';
alter table public.demi_workshop_purchase_intents enable row level security;
revoke all on public.demi_workshop_purchase_intents from public,anon,authenticated,service_role;
grant select on public.demi_workshop_purchase_intents to service_role;
create table public.demi_workshop_receipts (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 intent_id uuid not null references public.demi_workshop_purchase_intents(id),
 event_id uuid not null references public.assistant_whatsapp_events(id), provider_message_id text not null,
 storage_path text not null, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 amount_minor integer not null, currency text not null, hold_id uuid not null unique references public.workshop_provisional_holds(id),
 created_at timestamptz not null default clock_timestamp(), unique(studio_id,sha256),unique(studio_id,event_id),unique(studio_id,provider_message_id)
);
alter table public.demi_workshop_receipts enable row level security;
revoke all on public.demi_workshop_receipts from public,anon,authenticated,service_role;
grant select on public.demi_workshop_receipts to service_role;

alter table public.assistant_pending_actions drop constraint assistant_pending_actions_action_type_check;
alter table public.assistant_pending_actions add constraint assistant_pending_actions_action_type_check check(action_type in
 ('booking.create','booking.cancel','booking.reschedule','waitlist.join','account.activate','enrollment.resolve',
  'commerce.transfer_package_choice','commerce.cash_purchase','commerce.workshop_purchase'));

create function public.service_demi_workshop_catalog(p_studio uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.studios where id=p_studio and status='active') then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled) then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(jsonb_build_object('workshop_ref','workshop:'||o.id,'title',o.title,
  'full_price_minor',o.full_price_minor,'individual_sessions',o.allow_individual_sessions,
  'deposit_mode',o.deposit_mode,'deposit_value',o.deposit_value,'currency',st.currency,
  'requires_enrollment',coalesce(o.requires_enrollment,policy.requires_enrollment,false),
  'sessions',(select jsonb_agg(jsonb_build_object('session_ref','session:'||s.id,'starts_at',s.starts_at,
    'individual_price_minor',os.individual_price_minor,'available',greatest(0,s.capacity-private.workshop_capacity_seats_taken(p_studio,s.id))) order by s.starts_at,s.id)
   from public.workshop_offer_sessions os join public.class_sessions s on s.id=os.session_id and s.studio_id=p_studio
   where os.offer_id=o.id and s.status::text='scheduled' and s.starts_at>now() and s.assistant_visible)) order by o.created_at desc,o.id),'[]'::jsonb) into result
 from public.workshop_offers o join public.studios st on st.id=o.studio_id
 left join public.workshop_studio_policies policy on policy.studio_id=o.studio_id
 where o.studio_id=p_studio and exists(select 1 from public.workshop_offer_sessions os join public.class_sessions s on s.id=os.session_id
  where os.offer_id=o.id and s.studio_id=p_studio and s.status::text='scheduled' and s.starts_at>now() and s.assistant_visible);
 return result;
end $$;

create function public.service_prepare_demi_workshop_purchase(
 p_studio uuid,p_conversation uuid,p_offer uuid,p_sessions uuid[],p_mode text,p_turn uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.assistant_conversations%rowtype; intent public.demi_workshop_purchase_intents%rowtype;
 q jsonb; ids uuid[]; rev integer; first_date timestamptz; summary jsonb; v_currency text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled) then raise exception 'workshop_demi_disabled'; end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio and assistant_key='demi' and status='open' for update;
 if not found or c.student_id is null then raise exception 'verified_student_required'; end if;
 if not exists(select 1 from public.assistant_turns where id=p_turn and studio_id=p_studio and conversation_id=c.id and role='user' and direction='inbound') then raise exception 'inbound_turn_required'; end if;
 if p_sessions is null or cardinality(p_sessions) not between 1 and 100 or cardinality(p_sessions)<>(select count(distinct s) from unnest(p_sessions) s) then raise exception 'invalid_selection'; end if;
 select array_agg(s order by s) into ids from unnest(p_sessions) s;
 select * into intent from public.demi_workshop_purchase_intents where studio_id=p_studio and prepared_turn_id=p_turn;
 if found then
  if intent.conversation_id<>c.id or intent.offer_id<>p_offer or intent.session_ids is distinct from ids or intent.selection_mode is distinct from p_mode then raise exception 'idempotency_conflict'; end if;
 else
  if exists(select 1 from public.demi_workshop_purchase_intents where studio_id=p_studio and conversation_id=c.id and status='receipt_required' and expires_at>now()) then raise exception 'workshop_receipt_pending'; end if;
  if exists(select 1 from public.demi_group_bookings where studio_id=p_studio and conversation_id=c.id and status='awaiting_receipt' and expires_at>now())
   or exists(select 1 from public.assistant_enrollment_intents where studio_id=p_studio and conversation_id=c.id and status in ('receipt_required','human_review'))
   or exists(select 1 from public.assistant_transfer_purchase_intents where studio_id=p_studio and conversation_id=c.id and status='awaiting_receipt') then raise exception 'another_receipt_pending'; end if;
  q:=private.workshop_payment_quote(p_studio,p_offer,c.student_id,ids,p_mode);
  select revision into rev from public.workshop_offers where id=p_offer and studio_id=p_studio;
  select min(starts_at) into first_date from public.class_sessions where studio_id=p_studio and id=any(ids);
  select currency into v_currency from public.studios where id=p_studio;
  if v_currency is distinct from 'MXN' then raise exception 'currency_mismatch'; end if;
  if not exists(select 1 from public.studio_bank_transfer_settings where studio_id=p_studio and enabled)
   or not exists(select 1 from public.studio_payment_methods where studio_id=p_studio and code='bank_transfer' and active) then raise exception 'payment_method_unavailable'; end if;
  update public.demi_workshop_purchase_intents set status='cancelled' where studio_id=p_studio and conversation_id=c.id and (status='quoted' or(status='receipt_required' and expires_at<=now()));
  update public.assistant_pending_actions set status='cancelled',updated_at=clock_timestamp() where studio_id=p_studio and conversation_id=c.id and action_type='commerce.workshop_purchase' and status='pending';
  insert into public.demi_workshop_purchase_intents(studio_id,conversation_id,student_id,offer_id,offer_revision,selection_mode,session_ids,amount_minor,total_minor,currency,due_at,prepared_turn_id,expires_at)
   values(p_studio,c.id,c.student_id,p_offer,rev,p_mode,ids,(q->>'minimum_minor')::integer,(q->>'total_minor')::integer,v_currency,first_date,p_turn,least(now()+interval '24 hours',first_date)) returning * into intent;
 end if;
 summary:=jsonb_build_object('intent_id',intent.id,'amount_minor',intent.amount_minor,'total_minor',intent.total_minor,'currency',intent.currency,'due_at',intent.due_at,
  'selection_mode',intent.selection_mode,'session_ids',intent.session_ids,'terms_version',intent.terms_version,
  'terms','El anticipo no es reembolsable. El saldo completo vence al iniciar la primera fecha adquirida. Faltar no condona saldo ni repone sesiones. Un comprobante solo permite un apartado provisional sujeto a cupo y revisión; no confirma el ingreso.');
 if intent.status='quoted' and not exists(select 1 from public.assistant_pending_actions where studio_id=p_studio and conversation_id=c.id and action_type='commerce.workshop_purchase' and action_payload->>'intent_id'=intent.id::text and status='pending') then
  insert into public.assistant_pending_actions(studio_id,conversation_id,action_type,action_token_hash,action_payload,confirmation_summary,expires_at)
   values(p_studio,c.id,'commerce.workshop_purchase',md5(gen_random_uuid()::text),jsonb_build_object('intent_id',intent.id),summary,intent.expires_at);
 end if;
 return summary||jsonb_build_object('ok',true,'confirmation_required',intent.status='quoted','status',intent.status,'reservation_confirmed',false);
end $$;

create function public.service_accept_demi_workshop_purchase(p_studio uuid,p_conversation uuid,p_turn uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.assistant_conversations%rowtype; intent public.demi_workshop_purchase_intents%rowtype;
 a public.assistant_pending_actions%rowtype; message text; bank public.studio_bank_transfer_settings%rowtype; quote jsonb; rev integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled) then raise exception 'workshop_demi_disabled'; end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio and assistant_key='demi' and status='open' for update;
 if not found or c.student_id is null then raise exception 'verified_student_required'; end if;
 select * into a from public.assistant_pending_actions where studio_id=p_studio and conversation_id=c.id and action_type='commerce.workshop_purchase' and status in ('pending','executed') and expires_at>now() order by created_at desc,id desc limit 1 for update;
 if not found then raise exception 'workshop_confirmation_missing'; end if;
 select * into intent from public.demi_workshop_purchase_intents where id=(a.action_payload->>'intent_id')::uuid and studio_id=p_studio and conversation_id=c.id and student_id=c.student_id and expires_at>now() for update;
 if not found or intent.status not in ('quoted','receipt_required') then raise exception 'workshop_confirmation_missing'; end if;
 select regexp_replace(translate(lower(content),'áéíóúü','aeiouu'),'[^a-z0-9 ]','','g') into message from public.assistant_turns
  where id=p_turn and studio_id=p_studio and conversation_id=c.id and role='user' and direction='inbound' and content !~ '[?¿]' and created_at>=(select created_at from public.assistant_turns where id=intent.prepared_turn_id);
 if p_turn=intent.prepared_turn_id or btrim(coalesce(message,'')) not in
  ('si','si por favor','si confirmo','confirmo','confirmado','confirmo la compra','si confirmo la compra','acepto','acepto las condiciones','si acepto','de acuerdo','adelante','hazlo','dale','va','ok','okay','correcto') then raise exception 'explicit_confirmation_required'; end if;
 if intent.status='quoted' then
  quote:=private.workshop_payment_quote(p_studio,intent.offer_id,c.student_id,intent.session_ids,intent.selection_mode);
  select revision into rev from public.workshop_offers where id=intent.offer_id;
  if rev<>intent.offer_revision or (quote->>'total_minor')::integer<>intent.total_minor or (quote->>'minimum_minor')::integer<>intent.amount_minor then raise exception 'workshop_revision_conflict'; end if;
  update public.demi_workshop_purchase_intents set status='receipt_required',accepted_turn_id=p_turn where id=intent.id;
  update public.assistant_pending_actions set status='executed',confirmed_at=clock_timestamp(),executed_at=clock_timestamp(),execution_ref=intent.id::text where id=a.id;
 end if;
 select * into bank from public.studio_bank_transfer_settings where studio_id=p_studio and enabled;
 if not found then raise exception 'payment_method_unavailable'; end if;
 return jsonb_build_object('ok',true,'intent_id',intent.id,'status','receipt_required','amount_minor',intent.amount_minor,'total_minor',intent.total_minor,'currency',intent.currency,
  'bank_details',jsonb_build_object('bank_name',bank.bank_name,'account_holder',bank.account_holder,'clabe',bank.clabe,'account_number',bank.account_number,'instructions',bank.instructions),
  'receipt_required',true,'payment_verified',false,'reservation_confirmed',false,'capacity_held',false,'due_at',intent.due_at);
end $$;

create function public.service_record_demi_workshop_receipt(
 p_studio uuid,p_conversation uuid,p_intent uuid,p_event uuid,p_provider text,p_path text,p_hash text,p_amount integer,p_currency text,p_confidence numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare intent public.demi_workshop_purchase_intents%rowtype; receipt public.demi_workshop_receipts%rowtype; held jsonb; rev integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into intent from public.demi_workshop_purchase_intents where id=p_intent and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found or not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio and student_id=intent.student_id and assistant_key='demi' and status='open') then raise exception 'conversation_identity_mismatch'; end if;
 if not exists(select 1 from public.assistant_whatsapp_events where id=p_event and studio_id=p_studio and provider_event_id=p_provider and assistant_conversation_id=p_conversation)
  or p_path is distinct from p_studio::text||'/workshop/'||intent.id::text||'/'||p_hash or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'receipt_source_mismatch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio::text||':receipt:'||p_hash,0));
 select * into receipt from public.demi_workshop_receipts where studio_id=p_studio and (sha256=p_hash or event_id=p_event or provider_message_id=p_provider);
 if found then
  if receipt.intent_id<>intent.id then raise exception 'receipt_already_used'; end if;
  return jsonb_build_object('ok',true,'hold_id',receipt.hold_id,'replayed',true,'payment_verified',false,'reservation_confirmed',false);
 end if;
 if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled) then raise exception 'workshop_demi_disabled'; end if;
 if intent.status<>'receipt_required' or intent.accepted_turn_id is null or intent.expires_at<=now() then raise exception 'workshop_receipt_not_expected'; end if;
 if p_amount is distinct from intent.amount_minor or p_currency is distinct from intent.currency or p_confidence is null or p_confidence<0.8 or p_confidence>1 then raise exception 'receipt_amount_mismatch'; end if;
 if exists(select 1 from public.demi_enrollment_receipts where studio_id=p_studio and (sha256=p_hash or event_id=p_event))
  or exists(select 1 from public.demi_group_receipts where studio_id=p_studio and (sha256=p_hash or event_id=p_event)) then raise exception 'receipt_already_used'; end if;
 select revision into rev from public.workshop_offers where id=intent.offer_id and studio_id=p_studio for share;
 if rev is distinct from intent.offer_revision then raise exception 'workshop_revision_conflict'; end if;
 held:=public.service_create_demi_workshop_hold(p_studio,p_conversation,intent.offer_id,intent.session_ids,intent.selection_mode,intent.id,'workshop-receipt:'||p_hash,intent.amount_minor,least(intent.expires_at,now()+interval '24 hours'));
 insert into public.demi_workshop_receipts(studio_id,intent_id,event_id,provider_message_id,storage_path,sha256,amount_minor,currency,hold_id)
  values(p_studio,intent.id,p_event,p_provider,p_path,p_hash,p_amount,p_currency,(held->>'hold_id')::uuid) returning * into receipt;
 update public.demi_workshop_purchase_intents set status='held',hold_id=receipt.hold_id where id=intent.id;
 return jsonb_build_object('ok',true,'hold_id',receipt.hold_id,'state','reserved_provisionally','expires_at',least(intent.expires_at,now()+interval '24 hours'),'replayed',false,'payment_verified',false,'reservation_confirmed',false);
end $$;
revoke all on function public.service_demi_workshop_catalog(uuid),public.service_prepare_demi_workshop_purchase(uuid,uuid,uuid,uuid[],text,uuid),public.service_accept_demi_workshop_purchase(uuid,uuid,uuid),public.service_record_demi_workshop_receipt(uuid,uuid,uuid,uuid,text,text,text,integer,text,numeric) from public,anon,authenticated,service_role;
grant execute on function public.service_demi_workshop_catalog(uuid),public.service_prepare_demi_workshop_purchase(uuid,uuid,uuid,uuid[],text,uuid),public.service_accept_demi_workshop_purchase(uuid,uuid,uuid),public.service_record_demi_workshop_receipt(uuid,uuid,uuid,uuid,text,text,text,integer,text,numeric) to service_role;

-- Sandbox: tenant-scoped review queue; no direct table grants.
create or replace function public.admin_workshop_provisional_review_queue(p_studio_id uuid,p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_rows jsonb;
begin
 if v_actor is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio_id,'students.read'),false)
 or not coalesce(private.has_capability(p_studio_id,'sales.read'),false)
 or not coalesce(private.has_capability(p_studio_id,'schedule.read'),false)
 or not exists(select 1 from public.user_accounts where id=v_actor and status='active')
 or not exists(select 1 from public.studios where id=p_studio_id and status='active')
 then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_offers where studio_id=p_studio_id and id=p_offer_id)
 then raise exception 'offer_not_found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',h.id,'student_id',h.student_id,'student_name',s.full_name,
 'transfer_reference',h.transfer_reference,'amount_minor',h.amount_minor,
 'total_minor',h.total_minor,'expires_at',h.expires_at,
 'receipt_path',(select storage_path from public.demi_workshop_receipts where hold_id=h.id and studio_id=p_studio_id),
 'session_count',(select count(*) from public.workshop_provisional_hold_sessions hs where hs.hold_id=h.id)
 ) order by h.created_at,h.id),'[]'::jsonb)
 into v_rows
 from public.workshop_provisional_holds h
 join public.students s on s.id=h.student_id and s.studio_id=p_studio_id
 where h.studio_id=p_studio_id and h.offer_id=p_offer_id
 and h.state='reserved_provisionally' and h.expires_at>now();
 return v_rows;
end $$;
revoke all on function public.admin_workshop_provisional_review_queue(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_workshop_provisional_review_queue(uuid,uuid) to authenticated;

create function private.workshop_receipt_read_allowed(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.role()='authenticated' and exists(
  select 1 from public.demi_workshop_receipts r join public.user_accounts a on a.id=auth.uid() and a.status='active'
   join public.studios s on s.id=r.studio_id and s.status='active'
  where r.storage_path=p_path and private.has_capability(r.studio_id,'sales.read')
   and private.has_capability(r.studio_id,'students.read') and private.has_capability(r.studio_id,'schedule.read'))
$$;
revoke all on function private.workshop_receipt_read_allowed(text) from public,anon,authenticated,service_role;
grant execute on function private.workshop_receipt_read_allowed(text) to authenticated;
create policy workshop_receipt_staff_read on storage.objects for select to authenticated
 using(bucket_id='transfer-receipts' and private.workshop_receipt_read_allowed(name));

create or replace function private.workshop_edit_locked(p_offer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workshop_provisional_holds where offer_id=p_offer_id)
 or exists(select 1 from public.workshop_purchases where offer_id=p_offer_id)
 or exists(select 1 from public.workshop_payment_authorizations where offer_id=p_offer_id)
 or exists(select 1 from private.workshop_payment_authorizations where offer_id=p_offer_id)
 or exists(select 1 from public.workshop_offer_sessions os join public.class_sessions s on s.id=os.session_id
   left join public.class_templates t on t.id=s.template_id
   where os.offer_id=p_offer_id and (s.starts_at<=now() or s.status::text<>'scheduled'
     or t.workshop_offer_id is distinct from p_offer_id
     or exists(select 1 from public.reservations r where r.session_id=s.id)))
$$;


create or replace function private.guard_configurable_workshop_session()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_owned boolean; v_held boolean;
begin
 select exists(select 1 from public.class_templates where id=old.template_id and workshop_offer_id is not null)
   or exists(select 1 from public.workshop_offer_sessions where session_id=old.id) into v_owned;
 if not v_owned then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='DELETE' then raise exception 'workshop_session_delete_forbidden'; end if;
 select exists(select 1 from public.reservations where session_id=old.id)
 or exists(select 1 from public.workshop_offer_sessions os where os.session_id=old.id and
   (exists(select 1 from public.workshop_provisional_holds h where h.offer_id=os.offer_id) or exists(select 1 from public.workshop_purchases p where p.offer_id=os.offer_id)
    or exists(select 1 from public.workshop_payment_authorizations a where a.offer_id=os.offer_id)
    or exists(select 1 from private.workshop_payment_authorizations a where a.offer_id=os.offer_id))) into v_held;
 if v_held and ((new.starts_at,new.ends_at,new.capacity,new.instructor_id,new.space_id,new.template_id,new.studio_id)
    is distinct from (old.starts_at,old.ends_at,old.capacity,old.instructor_id,old.space_id,old.template_id,old.studio_id)
    or (new.status::text='cancelled' and old.status::text<>'cancelled')) then raise exception 'workshop_edit_locked'; end if;
 return new;
end $$;
