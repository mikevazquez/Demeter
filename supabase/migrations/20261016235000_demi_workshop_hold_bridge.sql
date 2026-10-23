-- Sandbox-only: Demi creates an unverified workshop hold, never a payment.
create table if not exists public.demi_workshop_hold_links (
 hold_id uuid primary key references public.workshop_provisional_holds(id) on delete restrict,
 studio_id uuid not null references public.studios(id),
 conversation_id uuid not null references public.assistant_conversations(id),
 created_at timestamptz not null default now()
);
alter table public.demi_workshop_hold_links enable row level security;
revoke all on public.demi_workshop_hold_links from public, anon, authenticated;
create index if not exists demi_workshop_hold_links_conversation_idx on public.demi_workshop_hold_links(studio_id,conversation_id);

create or replace function public.service_create_demi_workshop_hold(
 p_studio_id uuid,p_conversation_id uuid,p_offer_id uuid,
 p_session_ids uuid[],p_selection_mode text,p_request_id uuid,
 p_transfer_reference text,p_amount_minor integer,p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_student uuid; v_quote jsonb; v_sessions uuid[]; v_hold uuid; v_existing public.workshop_provisional_holds%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select student_id into v_student from public.assistant_conversations
 where id=p_conversation_id and studio_id=p_studio_id and status='active' and student_id is not null;
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