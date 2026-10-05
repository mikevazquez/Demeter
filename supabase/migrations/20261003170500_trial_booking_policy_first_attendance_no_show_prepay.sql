create table if not exists public.trial_booking_policies (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  enabled boolean not null default true,
  allow_without_enrollment_until_first_attendance boolean not null default true,
  max_active_trial_reservations integer not null default 1 check (max_active_trial_reservations >= 1),
  prepayment_after_no_shows integer not null default 2 check (prepayment_after_no_shows >= 0),
  require_payment_before_attendance boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trial_booking_policies enable row level security;
revoke all on public.trial_booking_policies from anon, authenticated;
grant all on public.trial_booking_policies to service_role;

-- Studio-specific trial policy is configured explicitly per environment after migration.

create or replace function public.assistant_trial_booking_preview(
  target_studio_id uuid,
  target_session_id uuid,
  target_student_id uuid default null,
  target_crm_contact_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_policy public.trial_booking_policies%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_student public.students%rowtype;
  v_contact public.crm_contacts%rowtype;
  v_attended integer := 0;
  v_no_shows integer := 0;
  v_active integer := 0;
  v_occupied integer := 0;
  v_student_id uuid;
begin
  if target_studio_id is null or target_session_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select * into v_policy
  from public.trial_booking_policies
  where studio_id=target_studio_id;

  if not found or not v_policy.enabled then
    return jsonb_build_object('ok',false,'reason_code','trial_booking_disabled');
  end if;

  select * into v_session
  from public.class_sessions
  where id=target_session_id
    and studio_id=target_studio_id;

  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=now() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;
  if coalesce(v_session.requires_resource,false) then
    return jsonb_build_object('ok',false,'reason_code','resource_selection_required');
  end if;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id
    and studio_id=target_studio_id
    and active=true;

  if not found then return jsonb_build_object('ok',false,'reason_code','activity_not_available'); end if;

  select count(*)::integer into v_occupied
  from public.reservations
  where session_id=v_session.id
    and status in ('reserved','attended');

  if v_occupied>=v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  if target_student_id is not null then
    select * into v_student
    from public.students
    where id=target_student_id
      and studio_id=target_studio_id;

    if not found then return jsonb_build_object('ok',false,'reason_code','student_not_found'); end if;
    if not v_student.active or v_student.lifecycle_status<>'active' then
      return jsonb_build_object('ok',false,'reason_code','student_not_operable');
    end if;

    v_student_id := v_student.id;
  elsif target_crm_contact_id is not null then
    select * into v_contact
    from public.crm_contacts
    where id=target_crm_contact_id
      and studio_id=target_studio_id;

    if not found then return jsonb_build_object('ok',false,'reason_code','crm_contact_not_found'); end if;

    if v_contact.converted_student_id is not null then
      select * into v_student
      from public.students
      where id=v_contact.converted_student_id
        and studio_id=target_studio_id;

      if found then
        if not v_student.active or v_student.lifecycle_status<>'active' then
          return jsonb_build_object('ok',false,'reason_code','student_not_operable');
        end if;
        v_student_id := v_student.id;
      end if;
    end if;
  else
    return jsonb_build_object('ok',false,'reason_code','identity_required');
  end if;

  if v_student_id is not null then
    select count(*)::integer into v_attended
    from public.reservations
    where studio_id=target_studio_id
      and student_id=v_student_id
      and status='attended';

    select count(*)::integer into v_no_shows
    from public.reservations
    where studio_id=target_studio_id
      and student_id=v_student_id
      and status='no_show';

    select count(*)::integer into v_active
    from public.reservations
    where studio_id=target_studio_id
      and student_id=v_student_id
      and status='reserved';

    if v_attended>0 then
      return jsonb_build_object(
        'ok',false,
        'reason_code','trial_completed_enrollment_required',
        'attended_count',v_attended,
        'no_show_count',v_no_shows
      );
    end if;

    if v_active>=v_policy.max_active_trial_reservations then
      return jsonb_build_object(
        'ok',false,
        'reason_code','trial_active_booking_exists',
        'active_reservations',v_active,
        'max_active_reservations',v_policy.max_active_trial_reservations
      );
    end if;
  end if;

  if v_no_shows>=v_policy.prepayment_after_no_shows then
    return jsonb_build_object(
      'ok',false,
      'reason_code','trial_prepayment_required',
      'prepayment_required',true,
      'no_show_count',v_no_shows,
      'prepayment_threshold',v_policy.prepayment_after_no_shows,
      'amount_minor',v_template.drop_in_price_minor,
      'currency',upper(coalesce((select currency from public.studios where id=target_studio_id),'MXN'))
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'eligible',true,
    'trial_exception',true,
    'student_id',v_student_id,
    'no_show_count',v_no_shows,
    'prepayment_threshold',v_policy.prepayment_after_no_shows,
    'prepayment_required',false,
    'max_active_reservations',v_policy.max_active_trial_reservations,
    'payment_pending',true,
    'require_payment_before_attendance',v_policy.require_payment_before_attendance,
    'allow_without_enrollment',v_policy.allow_without_enrollment_until_first_attendance,
    'amount_minor',v_template.drop_in_price_minor,
    'currency',upper(coalesce((select currency from public.studios where id=target_studio_id),'MXN'))
  );
end;
$function$;

create or replace function public.assistant_confirm_trial_booking(
  target_studio_id uuid,
  target_session_id uuid,
  target_student_id uuid default null,
  target_crm_contact_id uuid default null,
  target_assistant_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_preview jsonb;
  v_ensure jsonb;
  v_student_id uuid;
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_credit_cost integer := 1;
  v_reservation_id uuid;
begin
  if target_studio_id is null or target_session_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into v_session
  from public.class_sessions
  where id=target_session_id
    and studio_id=target_studio_id
  for update;

  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;

  v_preview := public.assistant_trial_booking_preview(
    target_studio_id,target_session_id,target_student_id,target_crm_contact_id
  );

  if coalesce((v_preview->>'ok')::boolean,false) is not true
     or coalesce((v_preview->>'eligible')::boolean,false) is not true then
    return v_preview;
  end if;

  v_student_id := target_student_id;

  if v_student_id is null then
    v_ensure := public.assistant_ensure_trial_student(target_studio_id,target_crm_contact_id);

    if coalesce((v_ensure->>'ok')::boolean,false) is not true then
      raise exception 'trial_identity_create_failed:%',coalesce(v_ensure->>'reason_code','unknown');
    end if;

    v_student_id := nullif(v_ensure->>'student_id','')::uuid;
  end if;

  if v_student_id is null then raise exception 'trial_identity_create_failed'; end if;

  v_preview := public.assistant_trial_booking_preview(
    target_studio_id,target_session_id,v_student_id,null
  );

  if coalesce((v_preview->>'ok')::boolean,false) is not true
     or coalesce((v_preview->>'eligible')::boolean,false) is not true then
    raise exception 'trial_booking_changed:%',coalesce(v_preview->>'reason_code','unknown');
  end if;

  select * into v_student
  from public.students
  where id=v_student_id
    and studio_id=target_studio_id
  for update;

  select greatest(coalesce(ct.credit_cost,1),1)
    into v_credit_cost
  from public.class_templates ct
  where ct.id=v_session.template_id
    and ct.studio_id=target_studio_id;

  insert into public.reservations(
    studio_id,session_id,student_id,student_user_id,acquisition_id,
    status,credits_held,commercial_status
  )
  values(
    target_studio_id,target_session_id,v_student_id,v_student.user_id,null,
    'reserved',v_credit_cost,'payment_pending'
  )
  returning id into v_reservation_id;

  insert into public.assistant_reservation_links(
    studio_id,reservation_id,assistant_conversation_id,source
  )
  values(
    target_studio_id,v_reservation_id,target_assistant_conversation_id,'assistant_trial'
  )
  on conflict(studio_id,reservation_id) do nothing;

  perform public.emit_domain_event(
    p_studio_id=>target_studio_id,
    p_event_type=>'walkin.commercial_pending',
    p_source_entity_type=>'reservation',
    p_source_entity_id=>v_reservation_id,
    p_deduplication_key=>'walkin.commercial_pending:assistant-trial:'||v_reservation_id::text,
    p_actor_user_id=>(select auth.uid()),
    p_payload=>jsonb_build_object(
      'student_id',v_student_id,'session_id',target_session_id,
      'reason_code','trial_payment_pending','credit_cost',v_credit_cost,
      'walkin',false,'source','assistant_trial','commercial_pending',true
    )
  );

  perform public.emit_domain_event(
    p_studio_id=>target_studio_id,
    p_event_type=>'booking.created',
    p_source_entity_type=>'reservation',
    p_source_entity_id=>v_reservation_id,
    p_deduplication_key=>'booking.created:assistant-trial:'||v_reservation_id::text,
    p_actor_user_id=>(select auth.uid()),
    p_payload=>jsonb_build_object(
      'reservation_id',v_reservation_id,'session_id',target_session_id,
      'student_id',v_student_id,'acquisition_id',null,
      'credit_cost',v_credit_cost,'unlimited',false,
      'source','assistant_trial','commercial_status','payment_pending'
    )
  );

  return jsonb_build_object(
    'ok',true,
    'reservation_id',v_reservation_id,
    'student_id',v_student_id,
    'session_id',target_session_id,
    'student_created',target_student_id is null,
    'commercial_status','payment_pending',
    'payment_pending',true,
    'no_show_count',coalesce((v_preview->>'no_show_count')::integer,0),
    'prepayment_threshold',coalesce((v_preview->>'prepayment_threshold')::integer,2),
    'amount_minor',v_preview->'amount_minor',
    'currency',v_preview->>'currency'
  );
end;
$function$;

revoke all on function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid) from public;
revoke all on function public.assistant_confirm_trial_booking(uuid,uuid,uuid,uuid,uuid) from public;
grant execute on function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.assistant_confirm_trial_booking(uuid,uuid,uuid,uuid,uuid) to authenticated,service_role;
