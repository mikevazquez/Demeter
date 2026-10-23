-- Recovered from the verified Sandbox catalog on 2026-10-19.
-- These atomic hold functions were missing from PR #317's versioned migration history.
-- Explicit selection mode only; the obsolete inferred-mode overload is not reintroduced.

CREATE OR REPLACE FUNCTION private.workshop_capacity_seats_taken(p_studio_id uuid, p_session_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select (select count(*) from public.reservations r where r.studio_id=p_studio_id and r.session_id=p_session_id and r.status::text in ('reserved','attended'))
+ (select count(*) from public.workshop_provisional_hold_sessions hs join public.workshop_provisional_holds h on h.id=hs.hold_id where hs.session_id=p_session_id and h.studio_id=p_studio_id and h.state='reserved_provisionally' and h.expires_at>now())
$function$;

CREATE OR REPLACE FUNCTION private.workshop_create_provisional_hold(p_studio_id uuid, p_offer_id uuid, p_student_id uuid, p_request_id uuid, p_reference text, p_session_ids uuid[], p_selection_mode text, p_amount_minor integer, p_total_minor integer, p_expires_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_existing public.workshop_provisional_holds%rowtype;
begin
 if p_studio_id is null or p_offer_id is null or p_student_id is null or p_request_id is null
    or p_reference is null or length(btrim(p_reference)) not between 1 and 200
    or p_selection_mode not in ('full','sessions') or p_selection_mode is null
    or p_amount_minor is null or p_amount_minor<=0 or p_total_minor is null
    or p_total_minor<p_amount_minor or p_expires_at is null
    or p_expires_at<=now() or p_expires_at>now()+interval '7 days'
 then raise exception 'invalid_provisional_request'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   p_studio_id::text||':'||p_request_id::text,0));
 select * into v_existing from public.workshop_provisional_holds
 where studio_id=p_studio_id and request_id=p_request_id for update;
 if found then
   if v_existing.offer_id<>p_offer_id or v_existing.student_id<>p_student_id
     or v_existing.transfer_reference<>btrim(p_reference)
     or v_existing.amount_minor<>p_amount_minor or v_existing.total_minor<>p_total_minor
     or v_existing.selection_mode<>p_selection_mode or v_existing.expires_at<>p_expires_at
     or (select array_agg(session_id order by session_id) from public.workshop_provisional_hold_sessions where hold_id=v_existing.id)
        is distinct from (select array_agg(x order by x) from unnest(p_session_ids) x)
   then raise exception 'idempotency_conflict'; end if;
   return v_existing.id;
 end if;
 if not exists(select 1 from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id)
    or not exists(select 1 from public.students where id=p_student_id and studio_id=p_studio_id)
    or exists(select 1 from unnest(p_session_ids) x where not exists(
      select 1 from public.workshop_offer_sessions os where os.offer_id=p_offer_id and os.session_id=x))
 then raise exception 'invalid_provisional_selection'; end if;
 if not private.workshop_provisional_capacity_available(p_studio_id,p_session_ids)
 then raise exception 'session_unavailable'; end if;
 insert into public.workshop_provisional_holds(
 studio_id,offer_id,student_id,request_id,transfer_reference,selection_mode,
 amount_minor,total_minor,expires_at,state)
 values(p_studio_id,p_offer_id,p_student_id,p_request_id,btrim(p_reference),
 p_selection_mode,p_amount_minor,p_total_minor,p_expires_at,'reserved_provisionally')
 returning id into v_id;
 insert into public.workshop_provisional_hold_sessions(hold_id,session_id)
 select v_id,x from unnest(p_session_ids) x;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION private.workshop_provisional_active_seats(p_studio_id uuid, p_session_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select count(*) from public.workshop_provisional_hold_sessions hs
 join public.workshop_provisional_holds h on h.id=hs.hold_id
 where hs.session_id=p_session_id and h.studio_id=p_studio_id
 and h.state='reserved_provisionally' and h.expires_at>now()
$function$;

CREATE OR REPLACE FUNCTION private.workshop_provisional_capacity_available(p_studio_id uuid, p_session_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_session uuid; v_capacity integer; v_occupied bigint; v_holds bigint;
begin
 if p_studio_id is null or p_session_ids is null or cardinality(p_session_ids) not between 1 and 100
    or (select count(distinct x) from unnest(p_session_ids) x) <> cardinality(p_session_ids)
 then return false; end if;
 for v_session in select x from unnest(p_session_ids) x order by x loop
   select capacity into v_capacity from public.class_sessions
   where id=v_session and studio_id=p_studio_id and status::text='scheduled'
     and starts_at>now() for update;
   if not found then return false; end if;
   select count(*) into v_occupied from public.reservations
   where studio_id=p_studio_id and session_id=v_session and status::text in ('reserved','attended');
   select count(*) into v_holds from public.workshop_provisional_hold_sessions hs
   join public.workshop_provisional_holds h on h.id=hs.hold_id
   where hs.session_id=v_session and h.studio_id=p_studio_id
     and h.state='reserved_provisionally' and h.expires_at>now();
   if v_occupied+v_holds>=v_capacity then return false; end if;
 end loop;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_create_workshop_provisional_hold(p_studio_id uuid, p_offer_id uuid, p_student_id uuid, p_session_ids uuid[], p_selection_mode text, p_request_id uuid, p_transfer_reference text, p_amount_minor integer, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := auth.uid(); v_quote jsonb; v_sessions uuid[];
v_existing public.workshop_provisional_holds%rowtype; v_id uuid; v_ref text := btrim(p_transfer_reference);
begin
 if v_actor is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio_id,'sales.write'),false)
 or not coalesce(private.has_capability(p_studio_id,'schedule.write'),false)
 or not exists(select 1 from public.user_accounts where id=v_actor and status='active')
 or not exists(select 1 from public.studios where id=p_studio_id and status='active')
 then raise exception 'forbidden'; end if;
 if p_request_id is null or p_selection_mode not in ('full','sessions')
 or p_amount_minor is null or p_amount_minor<=0 or v_ref is null or length(v_ref) not between 1 and 200
 or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days'
 then raise exception 'invalid_provisional_request'; end if;
 if p_session_ids is null or cardinality(p_session_ids) not between 1 and 100
 or (select count(distinct x) from unnest(p_session_ids) x)<>cardinality(p_session_ids)
 then raise exception 'invalid_selection'; end if;
 select array_agg(x order by x) into v_sessions from unnest(p_session_ids) x;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio_id::text||':'||p_request_id::text,0));
 select * into v_existing from public.workshop_provisional_holds
 where studio_id=p_studio_id and request_id=p_request_id for update;
 if found then
   if v_existing.offer_id is distinct from p_offer_id or v_existing.student_id is distinct from p_student_id
   or v_existing.selection_mode is distinct from p_selection_mode
   or v_existing.transfer_reference is distinct from v_ref or v_existing.amount_minor is distinct from p_amount_minor
   or v_existing.expires_at is distinct from p_expires_at
   or (select array_agg(session_id order by session_id) from public.workshop_provisional_hold_sessions where hold_id=v_existing.id) is distinct from v_sessions
   then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('hold_id',v_existing.id,'state',v_existing.state,'replayed',true);
 end if;
 if exists(select 1 from public.workshop_payment_authorizations where studio_id=p_studio_id and provider_event_id=v_ref)
 or exists(select 1 from public.workshop_purchases where studio_id=p_studio_id and idempotency_key=p_request_id)
 then raise exception 'payment_reference_conflict'; end if;
 v_quote := private.workshop_payment_quote(p_studio_id,p_offer_id,p_student_id,v_sessions,p_selection_mode);
 if p_amount_minor<(v_quote->>'minimum_minor')::integer
 or p_amount_minor>(v_quote->>'total_minor')::integer then raise exception 'invalid_deposit'; end if;
 if not private.workshop_provisional_capacity_available(p_studio_id,v_sessions) then raise exception 'session_unavailable'; end if;
 insert into public.workshop_provisional_holds(studio_id,offer_id,student_id,request_id,transfer_reference,selection_mode,amount_minor,total_minor,state,expires_at)
 values(p_studio_id,p_offer_id,p_student_id,p_request_id,v_ref,p_selection_mode,p_amount_minor,(v_quote->>'total_minor')::integer,'reserved_provisionally',p_expires_at)
 returning id into v_id;
 insert into public.workshop_provisional_hold_sessions(hold_id,session_id)
 select v_id,x from unnest(v_sessions) x;
 return jsonb_build_object('hold_id',v_id,'state','reserved_provisionally','replayed',false);
end $function$;

revoke all on function private.workshop_capacity_seats_taken(uuid,uuid),private.workshop_provisional_active_seats(uuid,uuid),private.workshop_provisional_capacity_available(uuid,uuid[]),private.workshop_create_provisional_hold(uuid,uuid,uuid,uuid,text,uuid[],text,integer,integer,timestamptz),public.admin_create_workshop_provisional_hold(uuid,uuid,uuid,uuid[],text,uuid,text,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_create_workshop_provisional_hold(uuid,uuid,uuid,uuid[],text,uuid,text,integer,timestamptz) to authenticated;
