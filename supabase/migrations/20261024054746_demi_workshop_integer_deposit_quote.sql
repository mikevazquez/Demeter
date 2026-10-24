-- Fixed deposits may retain a numeric scale (30000.00 cents). The quote has
-- already validated integral cents; serialize them as integers so every caller
-- can safely consume minimum_minor without interpreting decimal text as int.
-- Preserve quote, enrollment, blockers, capacity and payment rules and ACLs.
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
  return v_quote || jsonb_build_object('minimum_minor', v_minimum::integer);
end $$;


