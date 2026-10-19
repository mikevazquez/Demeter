-- New purchases follow the approved contract; existing purchases are never rewritten.
-- Membership is checked at each selected local date, including the expiry date.
create or replace function private.workshop_assert_enrollment(
 p_studio_id uuid,p_student_id uuid,p_session_ids uuid[],p_required boolean
) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.students where id=p_student_id and studio_id=p_studio_id
   and active and lifecycle_status='active') then raise exception 'student_not_operable'; end if;
 if p_required then
  perform 1 from public.student_enrollments where studio_id=p_studio_id and student_id=p_student_id
   order by id for share;
 end if;
 if p_required and exists(
  select 1 from public.class_sessions s join public.studios st on st.id=s.studio_id
  where s.studio_id=p_studio_id and s.id=any(p_session_ids)
  and not exists(select 1 from public.student_enrollments e
   where e.studio_id=p_studio_id and e.student_id=p_student_id and e.status='active'
    and e.refunded_at is null and e.starts_on<=(s.starts_at at time zone st.timezone)::date
    and (e.expires_on is null or e.expires_on>=(s.starts_at at time zone st.timezone)::date))
 ) then raise exception 'enrollment_required'; end if;
end $$;
revoke all on function private.workshop_assert_enrollment(uuid,uuid,uuid[],boolean)
 from public,anon,authenticated,service_role;

create or replace function private.workshop_payment_quote(
  p_studio_id uuid, p_offer_id uuid, p_student_id uuid,
  p_session_ids uuid[], p_purchase_mode text
)
returns jsonb language plpgsql set search_path = '' as $$
declare v_quote jsonb; v_offer public.workshop_offers%rowtype; v_policy record; v_minimum numeric;
begin
  select * into v_offer from public.workshop_offers
  where studio_id = p_studio_id and id = p_offer_id for share;
  if not found then raise exception 'offer_not_found'; end if;
  select * into v_policy from public.workshop_studio_policies
  where studio_id = p_studio_id for share;
  perform private.workshop_assert_enrollment(p_studio_id,p_student_id,p_session_ids,
    coalesce(v_offer.requires_enrollment,v_policy.requires_enrollment,false));
  if exists(select 1 from unnest(p_session_ids) session_id
    where coalesce(jsonb_array_length(private.student_booking_blockers(p_student_id,session_id)),1)>0)
    then raise exception 'booking_blocked'; end if;
  perform 1 from public.workshop_offer_sessions where offer_id = p_offer_id
  order by session_id for share;
  v_quote := public.workshop_checkout_preflight_v2(
    p_studio_id, p_offer_id, p_student_id, p_session_ids, p_purchase_mode);
  if exists (select 1 from public.class_sessions
             where id = any(p_session_ids) and starts_at <= now()) then
    raise exception 'session_unavailable';
  end if;
  v_minimum := case v_offer.deposit_mode
    when 'full' then (v_quote->>'total_minor')::numeric
    when 'fixed' then least((v_quote->>'total_minor')::numeric, v_offer.deposit_value)
    when 'percent' then ceil((v_quote->>'total_minor')::numeric * v_offer.deposit_value / 100)
  end;
  if v_minimum is null or v_minimum < 0 or v_minimum <> trunc(v_minimum) then
    raise exception 'invalid_deposit';
  end if;
  return v_quote || jsonb_build_object('minimum_minor', v_minimum);
end $$;


create or replace function public.admin_authorize_workshop_payment(
  p_studio_id uuid, p_offer_id uuid, p_student_id uuid, p_session_ids uuid[],
  p_purchase_mode text, p_idempotency_key uuid, p_amount_minor integer,
  p_currency text, p_payment_method text, p_payment_reference text, p_received boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_sessions uuid[]; v_quote jsonb; v_currency text;
  v_reference text := btrim(p_payment_reference);
  v_existing public.workshop_payment_authorizations%rowtype;
  v_id uuid;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated'
     or not coalesce(private.has_capability(p_studio_id, 'sales.write'), false)
     or not coalesce(private.has_capability(p_studio_id, 'schedule.write'), false)
     or not exists (select 1 from public.user_accounts where id = v_actor and status = 'active')
     or not exists (select 1 from public.studios where id = p_studio_id and status = 'active') then
    raise exception 'forbidden';
  end if;
  -- An upload, OCR result, pending transfer or a service-role caller is not an attestation.
  if p_received is distinct from true then raise exception 'payment_not_verified'; end if;
  if p_idempotency_key is null or p_amount_minor is null or p_amount_minor <= 0
     or p_currency is distinct from 'MXN'
     or p_payment_method is null or p_payment_method not in ('cash', 'bank_transfer')
     or v_reference is null or length(v_reference) not between 1 and 200 then
    raise exception 'invalid_payment_authorization';
  end if;
  select array_agg(x order by x) into v_sessions from unnest(p_session_ids) x;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_studio_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.workshop_payment_authorizations
  where studio_id = p_studio_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.offer_id is distinct from p_offer_id
       or v_existing.student_id is distinct from p_student_id
       or v_existing.session_ids is distinct from v_sessions
       or v_existing.selection_mode is distinct from p_purchase_mode
       or v_existing.amount_minor is distinct from p_amount_minor
       or v_existing.currency is distinct from p_currency
       or v_existing.payment_method is distinct from p_payment_method
       or v_existing.provider_event_id is distinct from v_reference then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object('authorization_id', v_existing.id, 'replayed', true);
  end if;
  if exists (select 1 from public.workshop_purchases
             where studio_id = p_studio_id and idempotency_key = p_idempotency_key) then
    raise exception 'idempotency_conflict';
  end if;
  -- Keep historical private evidence intact and prevent reusing its request or
  -- bank/receipt reference through the replacement authorization path.
  if exists (select 1 from private.workshop_payment_authorizations
             where studio_id = p_studio_id and
               (request_id = p_idempotency_key or nullif(btrim(reference), '') = v_reference)) then
    raise exception 'historical_payment_conflict';
  end if;
  select currency into v_currency from public.studios where id = p_studio_id for share;
  if v_currency is distinct from p_currency then raise exception 'currency_mismatch'; end if;
  if not exists (select 1 from public.studio_payment_methods
                 where studio_id = p_studio_id and code = p_payment_method and active) then
    raise exception 'payment_method_unavailable';
  end if;
  v_quote := private.workshop_payment_quote(
    p_studio_id, p_offer_id, p_student_id, p_session_ids, p_purchase_mode);
  if p_amount_minor > (v_quote->>'total_minor')::integer then raise exception 'payment_exceeds_total'; end if;
  if p_amount_minor < (v_quote->>'minimum_minor')::numeric then raise exception 'insufficient_deposit'; end if;
  -- The first selected session sets the balance deadline at checkout.
  begin
    insert into public.workshop_payment_authorizations(
      studio_id, offer_id, student_id, idempotency_key, selection_mode, session_ids,
      total_minor, amount_minor, currency, provider_event_id, payment_method, verified_by
    ) values (
      p_studio_id, p_offer_id, p_student_id, p_idempotency_key, p_purchase_mode, v_sessions,
      (v_quote->>'total_minor')::integer, p_amount_minor, p_currency, v_reference, p_payment_method, v_actor
    ) returning id into v_id;
  exception when unique_violation then raise exception 'payment_event_conflict';
  end;
  return jsonb_build_object('authorization_id', v_id, 'replayed', false);
end $$;

-- The caller supplies only IDs: price, amount, method and selection come from
-- immutable reviewed evidence. This service-only RPC is intentionally not wired to UI/Demi.

CREATE OR REPLACE FUNCTION public.workshop_checkout_confirm_v2(p_studio_id uuid, p_offer_id uuid, p_student_id uuid, p_session_ids uuid[], p_purchase_mode text, p_idempotency_key uuid, p_confirmed_amount_minor integer, p_payment_method text, p_payment_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_offer record; v_policy record; v_existing record; v_quote jsonb; v_total integer; v_due integer; v_sale uuid; v_purchase uuid; v_reservation uuid; v_session uuid; v_student_user uuid; v_requires_enrollment boolean; v_deposit integer; v_mode text; v_grace integer; v_balance_due timestamptz; v_timezone text;
begin
 if p_purchase_mode is null or p_purchase_mode not in ('full','sessions') then raise exception 'invalid_purchase_mode'; end if;
 if p_idempotency_key is null or p_confirmed_amount_minor is null or p_confirmed_amount_minor<=0 or nullif(trim(p_payment_method),'') is null then raise exception 'invalid_confirmed_payment'; end if;
 -- Serialize identical checkout requests before writing any row.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio_id::text||':'||p_idempotency_key::text,0));
 select * into v_existing from public.workshop_purchases where studio_id=p_studio_id and idempotency_key=p_idempotency_key;
 if found then
   if v_existing.selection_mode is distinct from p_purchase_mode or v_existing.offer_id<>p_offer_id or v_existing.student_id<>p_student_id or v_existing.paid_minor<>p_confirmed_amount_minor or
      (select array_agg(session_id order by session_id) from public.workshop_purchase_sessions where purchase_id=v_existing.id)
       is distinct from (select array_agg(x order by x) from unnest(p_session_ids) x)
   then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('purchase_id',v_existing.id,'sale_id',v_existing.sale_id,'replayed',true,'status',v_existing.status);
 end if;
 select * into v_offer from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id;
 if not found then raise exception 'offer_not_found'; end if;
 select * into v_policy from public.workshop_studio_policies where studio_id=p_studio_id;
 v_requires_enrollment:=coalesce(v_offer.requires_enrollment,v_policy.requires_enrollment,false);
 perform private.workshop_assert_enrollment(p_studio_id,p_student_id,p_session_ids,v_requires_enrollment);
 v_quote:=public.workshop_checkout_preflight_v2(p_studio_id,p_offer_id,p_student_id,p_session_ids,p_purchase_mode);
 v_total:=(v_quote->>'total_minor')::integer;
 if p_confirmed_amount_minor>v_total then raise exception 'payment_exceeds_total'; end if;
 if v_offer.deposit_mode='full' then v_deposit:=v_total;
 elsif v_offer.deposit_mode='fixed' then v_deposit:=least(v_total,v_offer.deposit_value::integer);
 else v_deposit:=ceil(v_total*v_offer.deposit_value/100)::integer; end if;
 if p_confirmed_amount_minor<v_deposit then raise exception 'insufficient_deposit'; end if;
 select min(starts_at) into v_balance_due from public.class_sessions
 where studio_id=p_studio_id and id=any(p_session_ids);
 select timezone into v_timezone from public.studios where id=p_studio_id;
 if v_balance_due is null then raise exception 'invalid_selection'; end if;
 v_mode:=coalesce(v_offer.overdue_mode,v_policy.overdue_mode,'keep_and_notify');
 v_grace:=coalesce(v_offer.grace_minutes,v_policy.grace_minutes,0);
 select user_id into v_student_user from public.students where id=p_student_id and studio_id=p_studio_id;
 insert into public.sales(studio_id,student_id,folio,status,currency,total_minor,idempotency_key,payment_due_on)
 values(p_studio_id,p_student_id,'WS-'||replace(p_idempotency_key::text,'-',''),'confirmed','MXN',v_total,p_idempotency_key,
 case when p_confirmed_amount_minor<v_total then (v_balance_due at time zone v_timezone)::date else null end)
 returning id into v_sale;
 insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference)
 values(p_studio_id,v_sale,'payment',p_confirmed_amount_minor,p_payment_method,p_payment_reference);
 insert into public.workshop_purchases(studio_id,offer_id,student_id,sale_id,total_minor,paid_minor,balance_due_at,overdue_mode,grace_minutes,status,idempotency_key,selection_mode)
 values(p_studio_id,p_offer_id,p_student_id,v_sale,v_total,p_confirmed_amount_minor,
 case when p_confirmed_amount_minor<v_total then v_balance_due else null end,v_mode,v_grace,'reserved',p_idempotency_key,p_purchase_mode)
 returning id into v_purchase;
 for v_session in select unnest(p_session_ids) order by 1 loop
   if exists(select 1 from public.reservations where studio_id=p_studio_id and session_id=v_session and student_id=p_student_id and status::text in ('reserved','attended')) then raise exception 'student_already_reserved'; end if;
   insert into public.reservations(studio_id,session_id,student_id,student_user_id,status,credits_held)
   values(p_studio_id,v_session,p_student_id,v_student_user,'reserved',0) returning id into v_reservation;
   insert into public.workshop_purchase_sessions(purchase_id,session_id,reservation_id) values(v_purchase,v_session,v_reservation);
 end loop;
 return jsonb_build_object('purchase_id',v_purchase,'sale_id',v_sale,'replayed',false,'status','reserved','total_minor',v_total,'paid_minor',p_confirmed_amount_minor);
end $function$;

create or replace function private.admin_purchase_workshop(
  p_studio_id uuid, p_offer_id uuid, p_student_id uuid, p_session_ids uuid[],
  p_purchase_mode text, p_request_id uuid, p_received_amount_minor integer,
  p_payment_method text, p_reference text, p_received boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_currency text; v_authorization jsonb; v_result jsonb; v_session uuid;
begin
  -- Recheck the signed actor and tenant on every direct RPC/action invocation.
  if auth.uid() is null
     or not coalesce(private.has_capability(p_studio_id,'sales.write'),false)
     or not coalesce(private.has_capability(p_studio_id,'schedule.write'),false)
     or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
     or not exists(select 1 from public.studios where id=p_studio_id and status='active') then
    raise exception 'forbidden';
  end if;
  if not exists(select 1 from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id) then
    raise exception 'offer_not_found';
  end if;
  if not exists(select 1 from public.students where id=p_student_id and studio_id=p_studio_id
                and active and lifecycle_status='active') then
    raise exception 'student_not_operable';
  end if;
  select currency into v_currency from public.studios where id=p_studio_id;
  v_authorization := public.admin_authorize_workshop_payment(
    p_studio_id,p_offer_id,p_student_id,p_session_ids,p_purchase_mode,p_request_id,
    p_received_amount_minor,v_currency,p_payment_method,p_reference,p_received);
  if not exists(select 1 from public.workshop_payment_authorizations
    where id=(v_authorization->>'authorization_id')::uuid and consumed_purchase_id is not null) then
    for v_session in select unnest(p_session_ids) order by 1 loop
      if coalesce(jsonb_array_length(private.student_booking_blockers(p_student_id,v_session)),1)>0 then
        raise exception 'booking_blocked';
      end if;
      -- Workshop enrollment policy was checked by the payment quote. An explicit
      -- guest offer must not inherit the enrollment requirement of ordinary packages.
    end loop;
  end if;
  v_result := public.workshop_checkout_confirm_authorized(
    p_studio_id,(v_authorization->>'authorization_id')::uuid,p_request_id);
  return v_result || jsonb_build_object('authorization_id',v_authorization->>'authorization_id');
end $$;


create or replace function public.service_revalidate_demi_receipt_review_notice(p_request uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.demi_receipt_review_notices%rowtype; eligible boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into n from public.demi_receipt_review_notices where id=p_request and notification_status='claimed' and notification_lease=p_lease and notification_claimed_at>clock_timestamp()-interval '5 minutes' for update;
 if not found then return jsonb_build_object('eligible',false,'reason_code','notification_lease_lost'); end if;
 if n.source_kind='enrollment' then
  select exists(select 1 from public.demi_enrollment_receipts r join public.assistant_enrollment_intents i on i.id=r.intent_id and i.studio_id=r.studio_id where r.id=n.source_id and r.studio_id=n.studio_id and r.status=n.decision and i.status=n.decision and i.receipt_reference=r.id::text and i.conversation_id=n.conversation_id) into eligible;
 elsif n.source_kind='workshop' then
  select exists(select 1 from public.workshop_provisional_holds h
   join public.demi_workshop_hold_links l on l.hold_id=h.id and l.studio_id=h.studio_id
   join public.assistant_conversations c on c.id=l.conversation_id and c.studio_id=l.studio_id
   where h.id=n.source_id and h.studio_id=n.studio_id and l.conversation_id=n.conversation_id
    and c.student_id=h.student_id
    and ((n.decision='approved' and h.state='confirmed')
      or (n.decision='rejected' and h.state in ('rejected','expired')))) into eligible;
 else
  select exists(select 1 from public.assistant_transfer_purchase_intents i where i.id=n.source_id and i.studio_id=n.studio_id and i.conversation_id=n.conversation_id and i.status='rejected'
   and not exists(select 1 from public.assistant_transfer_purchase_intents newer where newer.studio_id=i.studio_id and newer.conversation_id=i.conversation_id and newer.created_at>i.created_at and newer.status='validated')) into eligible;
 end if;
 if not eligible then update public.demi_receipt_review_notices set notification_status='review',notification_error='review_outcome_superseded',notification_lease=null where id=n.id; end if;
 return jsonb_build_object('eligible',eligible,'reason_code',case when eligible then null else 'review_outcome_superseded' end);
end $$;
revoke all on function public.service_revalidate_demi_receipt_review_notice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_revalidate_demi_receipt_review_notice(uuid,uuid) to service_role;

create or replace function private.admin_workshop_context_revision(p_studio_id uuid,p_offer_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v_revision integer; v_due timestamptz;
begin
 result:=private.admin_workshop_context(p_studio_id,p_offer_id);
 if p_offer_id is not null then
  select revision into v_revision from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id for share;
  result:=private.admin_workshop_context(p_studio_id,p_offer_id);
  select min(s.starts_at) into v_due from public.workshop_offer_sessions os
   join public.class_sessions s on s.id=os.session_id and s.studio_id=p_studio_id
   where os.offer_id=p_offer_id;
  result:=jsonb_set(result,'{offer,revision}',to_jsonb(v_revision));
  result:=jsonb_set(result,'{offer,dueAt}',coalesce(to_jsonb(v_due),'null'::jsonb));
 end if;
 return result;
end $$;

create or replace function public.service_create_demi_workshop_hold(
 p_studio_id uuid,p_conversation_id uuid,p_offer_id uuid,
 p_session_ids uuid[],p_selection_mode text,p_request_id uuid,
 p_transfer_reference text,p_amount_minor integer,p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_student uuid; v_quote jsonb; v_sessions uuid[]; v_hold uuid; v_existing public.workshop_provisional_holds%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select student_id into v_student from public.assistant_conversations
 where id=p_conversation_id and studio_id=p_studio_id and status='open' and assistant_key='demi' and student_id is not null;
 if v_student is null or not exists(select 1 from public.students where id=v_student and studio_id=p_studio_id)
 then raise exception 'conversation_student_not_verified'; end if;
 if p_request_id is null or p_transfer_reference is null or length(btrim(p_transfer_reference)) not between 1 and 200
 or p_selection_mode not in ('full','sessions') or p_amount_minor is null or p_amount_minor<=0
 or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days'
 then raise exception 'invalid_provisional_request'; end if;
 if p_session_ids is null or cardinality(p_session_ids) not between 1 and 100
 or (select count(distinct s) from unnest(p_session_ids) s)<>cardinality(p_session_ids)
 then raise exception 'invalid_selection'; end if;
 select array_agg(s order by s) into v_sessions from unnest(p_session_ids) s;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio_id::text||':'||p_request_id::text,0));
 select * into v_existing from public.workshop_provisional_holds
 where studio_id=p_studio_id and request_id=p_request_id for update;
 if found then
  if v_existing.offer_id is distinct from p_offer_id or v_existing.student_id is distinct from v_student
   or v_existing.selection_mode is distinct from p_selection_mode or v_existing.transfer_reference is distinct from btrim(p_transfer_reference)
   or v_existing.amount_minor is distinct from p_amount_minor or v_existing.expires_at is distinct from p_expires_at
   or (select array_agg(session_id order by session_id) from public.workshop_provisional_hold_sessions where hold_id=v_existing.id) is distinct from v_sessions
   or not exists(select 1 from public.demi_workshop_hold_links where hold_id=v_existing.id and studio_id=p_studio_id and conversation_id=p_conversation_id)
  then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('hold_id',v_existing.id,'state',v_existing.state,'replayed',true);
 end if;
 if exists(select 1 from public.workshop_provisional_holds where studio_id=p_studio_id and transfer_reference=btrim(p_transfer_reference))
 or exists(select 1 from public.workshop_payment_authorizations where studio_id=p_studio_id and provider_event_id=btrim(p_transfer_reference))
 then raise exception 'payment_reference_conflict'; end if;
 v_quote:=private.workshop_payment_quote(p_studio_id,p_offer_id,v_student,v_sessions,p_selection_mode);
 if p_amount_minor<(v_quote->>'minimum_minor')::integer or p_amount_minor>(v_quote->>'total_minor')::integer
 then raise exception 'invalid_deposit'; end if;
 v_hold:=private.workshop_create_provisional_hold(p_studio_id,p_offer_id,v_student,p_request_id,btrim(p_transfer_reference),v_sessions,p_selection_mode,p_amount_minor,(v_quote->>'total_minor')::integer,p_expires_at);
 insert into public.demi_workshop_hold_links(hold_id,studio_id,conversation_id) values(v_hold,p_studio_id,p_conversation_id);
 return jsonb_build_object('hold_id',v_hold,'state','reserved_provisionally','replayed',false);
end $$;
revoke all on function public.service_create_demi_workshop_hold(uuid,uuid,uuid,uuid[],text,uuid,text,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.service_create_demi_workshop_hold(uuid,uuid,uuid,uuid[],text,uuid,text,integer,timestamptz) to service_role;
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
