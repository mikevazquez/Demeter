-- TALL-NOTIF-01: publish the missing booking facts inside the checkout transaction.
-- No backfill, provider calls, channel changes or changes to existing privileges.
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
   -- Match ordinary bookings: downstream rules decide channels and delivery.
   -- The existing replay return above prevents duplicate events on retry.
   perform public.emit_domain_event(
     p_studio_id => p_studio_id,
     p_event_type => 'booking.created',
     p_source_entity_type => 'reservation',
     p_source_entity_id => v_reservation,
     p_deduplication_key => 'booking.created:' || v_reservation::text,
     p_occurred_at => clock_timestamp(),
     p_actor_user_id => auth.uid(),
     p_payload => jsonb_build_object(
       'reservation_id', v_reservation,
       'session_id', v_session,
       'student_id', p_student_id,
       'acquisition_id', null,
       'credit_cost', 0,
       'source', 'workshop_checkout',
       'workshop_purchase_id', v_purchase
     )
   );
 end loop;
 return jsonb_build_object('purchase_id',v_purchase,'sale_id',v_sale,'replayed',false,'status','reserved','total_minor',v_total,'paid_minor',p_confirmed_amount_minor);
end $function$;
