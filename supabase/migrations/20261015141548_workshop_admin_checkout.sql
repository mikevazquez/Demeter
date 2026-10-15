-- Pending LOCAL implementation only; no remote application or UAT implied.
-- Authenticated read/checkout APIs. No service credential is needed by the UI.
create function private.admin_workshop_context(p_studio_id uuid, p_offer_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
          (select count(*) from public.reservations r where r.session_id=s.id and r.studio_id=p_studio_id
            and r.status::text in ('reserved','attended'))) else 0 end)
      order by s.starts_at,s.id)
      from public.workshop_offer_sessions os join public.class_sessions s on s.id=os.session_id
      where os.offer_id=p_offer_id and s.studio_id=p_studio_id),'[]'::jsonb),
    'students',v_students,
    'paymentMethods',coalesce((select jsonb_agg(code order by code) from public.studio_payment_methods
      where studio_id=p_studio_id and active and code in ('cash','bank_transfer')),'[]'::jsonb));
end $$;

create function public.admin_workshop_context(p_studio_id uuid, p_offer_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.admin_workshop_context(p_studio_id,p_offer_id)
$$;

create function private.admin_purchase_workshop(
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
      if coalesce((private.student_enrollment_requirement_for_booking(p_student_id,v_session)->>'missing')::boolean,true) then
        raise exception 'enrollment_required';
      end if;
    end loop;
  end if;
  v_result := public.workshop_checkout_confirm_authorized(
    p_studio_id,(v_authorization->>'authorization_id')::uuid,p_request_id);
  return v_result || jsonb_build_object('authorization_id',v_authorization->>'authorization_id');
end $$;

create function public.admin_purchase_workshop(
  p_studio_id uuid, p_offer_id uuid, p_student_id uuid, p_session_ids uuid[],
  p_purchase_mode text, p_request_id uuid, p_received_amount_minor integer,
  p_payment_method text, p_reference text, p_received boolean
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.admin_purchase_workshop(p_studio_id,p_offer_id,p_student_id,p_session_ids,
    p_purchase_mode,p_request_id,p_received_amount_minor,p_payment_method,p_reference,p_received)
$$;

revoke all on function private.admin_workshop_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_workshop_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_purchase_workshop(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean)
from public,anon,authenticated,service_role;
revoke all on function public.admin_purchase_workshop(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean)
from public,anon,authenticated,service_role;
grant execute on function private.admin_workshop_context(uuid,uuid) to authenticated;
grant execute on function public.admin_workshop_context(uuid,uuid) to authenticated;
grant execute on function private.admin_purchase_workshop(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean) to authenticated;
grant execute on function public.admin_purchase_workshop(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean) to authenticated;
