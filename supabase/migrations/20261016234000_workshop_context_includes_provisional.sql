-- Workshop capacity display includes provisional holds in Sandbox.
CREATE OR REPLACE FUNCTION private.admin_workshop_context(p_studio_id uuid, p_offer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_offer public.workshop_offers%rowtype; v_policy record; v_students jsonb := '[]';
begin
  if auth.uid() is null
     or not coalesce(private.has_capability(p_studio_id, 'schedule.read'), false)
     or not coalesce(private.has_capability(p_studio_id, 'sales.read'), false)
     or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
     or not exists(select 1 from public.studios where id=p_studio_id and status='active') then
    raise exception 'forbidden';
  end if;
  if p_offer_id is null then
    return jsonb_build_object('offers',coalesce((
      select jsonb_agg(jsonb_build_object('id',id,'title',title,'fullPriceMinor',full_price_minor,
        'sessionCount',(select count(*) from public.workshop_offer_sessions where offer_id=o.id))
        order by o.created_at desc,o.id)
      from public.workshop_offers o where studio_id=p_studio_id
    ),'[]'::jsonb));
  end if;
  select * into v_offer from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id;
  if not found then raise exception 'offer_not_found'; end if;
  select * into v_policy from public.workshop_studio_policies where studio_id=p_studio_id;
  if coalesce(private.has_capability(p_studio_id,'students.read'),false) then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(full_name,''),'Alumna'))
      order by full_name,id),'[]'::jsonb) into v_students
    from public.students where studio_id=p_studio_id and active and lifecycle_status='active';
  end if;
  return jsonb_build_object(
    'offer',jsonb_build_object('id',v_offer.id,'title',v_offer.title,
      'fullPriceMinor',v_offer.full_price_minor,'allowIndividualSessions',v_offer.allow_individual_sessions,
      'requiresEnrollment',coalesce(v_offer.requires_enrollment,v_policy.requires_enrollment,false),
      'depositMode',v_offer.deposit_mode,'depositValue',v_offer.deposit_value,
      'dueAt',v_offer.balance_due_at,
      'overdueMode',coalesce(v_offer.overdue_mode,v_policy.overdue_mode,'keep_and_notify'),
      'graceMinutes',coalesce(v_offer.grace_minutes,v_policy.grace_minutes,0)),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'startsAt',s.starts_at,'endsAt',s.ends_at,
      'status',s.status,'priceMinor',os.individual_price_minor,'capacityRemaining',
        case when s.status::text='scheduled' and s.starts_at>now() then greatest(0,s.capacity-
          private.workshop_capacity_seats_taken(p_studio_id,s.id)) else 0 end)
      order by s.starts_at,s.id)
      from public.workshop_offer_sessions os join public.class_sessions s on s.id=os.session_id
      where os.offer_id=p_offer_id and s.studio_id=p_studio_id),'[]'::jsonb),
    'students',v_students,
    'paymentMethods',coalesce((select jsonb_agg(code order by code) from public.studio_payment_methods
      where studio_id=p_studio_id and active and code in ('cash','bank_transfer')),'[]'::jsonb));
end $function$
