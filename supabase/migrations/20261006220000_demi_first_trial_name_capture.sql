-- Ensure the first-trial policy exists for Demeter without overwriting any configured policy.
insert into public.trial_booking_policies (
  studio_id,
  enabled,
  allow_without_enrollment_until_first_attendance,
  max_active_trial_reservations,
  prepayment_after_no_shows,
  require_payment_before_attendance
)
select
  s.id,
  true,
  true,
  1,
  2,
  true
from public.studios s
where lower(trim(s.name)) = 'demeter fitness studio'
on conflict (studio_id) do nothing;

-- Require a verified name before a new WhatsApp contact can book a first trial.
-- First trial pricing is fixed at MXN $150.

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
      'amount_minor',15000,
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
    'amount_minor',15000,
    'currency',upper(coalesce((select currency from public.studios where id=target_studio_id),'MXN'))
  );
end;
$function$;


revoke all on function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid) from public;
grant execute on function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid) to authenticated,service_role;

create or replace function public.service_prepare_meta_whatsapp_message(
  target_studio_id uuid,
  target_event_id uuid,
  target_provider_message_id text,
  target_wa_id text,
  target_profile_name text,
  target_message_type text,
  target_message_text text,
  target_activity_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_message_id text := trim(coalesce(target_provider_message_id, ''));
  v_wa_id text := regexp_replace(coalesce(target_wa_id, ''), '[^0-9]', '', 'g');
  v_match_digits text;
  v_phone text;
  v_profile_name text := nullif(trim(coalesce(target_profile_name, '')), '');
  v_message_type text := lower(trim(coalesce(target_message_type, '')));
  v_message_text text := trim(coalesce(target_message_text, ''));
  v_activity_at timestamptz := coalesce(target_activity_at, clock_timestamp());
  v_student_id uuid;
  v_student_matches integer := 0;
  v_person_id uuid;
  v_crm_contact_id uuid;
  v_crm_conversation_id uuid;
  v_assistant_conversation_id uuid;
  v_inbound_turn_id uuid;
  v_handoff_open boolean := false;
  v_existing_status text;
  v_name_parts text[];
  v_capture_name text;
  v_full_name text;
  v_assistant_context jsonb;
  v_new_contact boolean := false;
  v_identity_needs_name boolean := false;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if target_studio_id is null
     or target_event_id is null
     or v_provider_message_id = ''
     or v_wa_id !~ '^[1-9][0-9]{7,14}$'
     or v_message_type = ''
     or v_message_text = '' then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if not exists (
    select 1
    from public.assistant_whatsapp_events e
    where e.id = target_event_id
      and e.studio_id = target_studio_id
      and e.provider = 'meta_whatsapp'
      and e.provider_event_id = v_provider_message_id
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'source_event_invalid');
  end if;

  -- Meta historically returned 521XXXXXXXXXX for some Mexican numbers.
  -- Canonicalize that legacy representation to 52XXXXXXXXXX.
  v_match_digits :=
    case
      when v_wa_id ~ '^521[0-9]{10}$' then '52' || substring(v_wa_id from 4)
      else v_wa_id
    end;
  v_phone := '+' || v_match_digits;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_studio_id::text || ':meta-whatsapp:' || v_match_digits,
      0
    )
  );

  select count(distinct s.id)
    into v_student_matches
  from public.students s
  where s.studio_id = target_studio_id
    and (
      case
        when regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
          then '52' || substring(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') from 4)
        else regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
      end = v_match_digits
      or exists (
        select 1
        from public.person_contacts pc
        where pc.studio_id = target_studio_id
          and pc.person_id = s.person_id
          and pc.kind = 'phone'
          and (
            case
              when regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
                then '52' || substring(regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') from 4)
              else regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g')
            end
          ) = v_match_digits
      )
    );

  if v_student_matches = 1 then
    select s.id, s.person_id
      into v_student_id, v_person_id
    from public.students s
    where s.studio_id = target_studio_id
      and (
        case
          when regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
            then '52' || substring(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') from 4)
          else regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
        end = v_match_digits
        or exists (
          select 1
          from public.person_contacts pc
          where pc.studio_id = target_studio_id
            and pc.person_id = s.person_id
            and pc.kind = 'phone'
            and (
              case
                when regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
                  then '52' || substring(regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') from 4)
                else regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g')
              end
            ) = v_match_digits
        )
      )
    limit 1;

    if v_person_id is not null then
      select c.id
        into v_crm_contact_id
      from public.crm_contacts c
      where c.studio_id = target_studio_id
        and c.person_id = v_person_id
      order by c.created_at asc
      limit 1;
    end if;
  end if;

  if v_crm_contact_id is null then
    select c.crm_contact_id
      into v_crm_contact_id
    from public.crm_conversations c
    where c.studio_id = target_studio_id
      and c.provider = 'meta_whatsapp'
      and c.contact_phone = v_phone
      and c.crm_contact_id is not null
    order by c.last_activity_at desc
    limit 1;
  end if;

  if v_crm_contact_id is null then
    select c.id, c.person_id
      into v_crm_contact_id, v_person_id
    from public.crm_contacts c
    join public.person_contacts pc
      on pc.studio_id = c.studio_id
     and pc.person_id = c.person_id
     and pc.kind = 'phone'
    where c.studio_id = target_studio_id
      and (
        case
          when regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
            then '52' || substring(regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') from 4)
          else regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g')
        end
      ) = v_match_digits
    order by c.created_at asc
    limit 1;
  end if;

  if v_crm_contact_id is null then
    select pc.person_id
      into v_person_id
    from public.person_contacts pc
    where pc.studio_id = target_studio_id
      and pc.kind = 'phone'
      and (
        case
          when regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
            then '52' || substring(regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') from 4)
          else regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g')
        end
      ) = v_match_digits
    limit 1;

    if v_person_id is not null then
      insert into public.crm_contacts(studio_id, person_id, lifecycle_status, source)
      values (target_studio_id, v_person_id, 'prospect', 'meta_whatsapp')
      returning id into v_crm_contact_id;
      v_new_contact := true;
    end if;
  end if;

  if v_student_id is null and v_crm_contact_id is null then
    v_name_parts := regexp_split_to_array(
      coalesce(v_profile_name, 'Prospecto'),
      '\\s+'
    );

    insert into public.persons(
      studio_id,
      first_name,
      last_name
    )
    values (
      target_studio_id,
      left(coalesce(nullif(v_name_parts[1], ''), 'Prospecto'), 120),
      nullif(left(
        case
          when array_length(v_name_parts, 1) > 1
            then array_to_string(v_name_parts[2:array_length(v_name_parts, 1)], ' ')
          else ''
        end,
        180
      ), '')
    )
    returning id into v_person_id;

    insert into public.crm_contacts(
      studio_id,
      person_id,
      lifecycle_status,
      source
    )
    values (
      target_studio_id,
      v_person_id,
      'prospect',
      'meta_whatsapp'
    )
    returning id into v_crm_contact_id;
    insert into public.person_contacts(studio_id, person_id, kind, value, is_primary)
    values (target_studio_id, v_person_id, 'phone', v_phone, true)
    on conflict do nothing;
    v_new_contact := true;
  end if;

  if v_student_id is null and v_crm_contact_id is not null and not v_new_contact then
    select exists (
      select 1
      from public.crm_contacts c
      join public.persons p on p.id = c.person_id and p.studio_id = c.studio_id
      where c.id = v_crm_contact_id
        and c.studio_id = target_studio_id
        and lower(trim(coalesce(p.first_name, ''))) = 'prospecto'
        and nullif(trim(coalesce(p.last_name, '')), '') is null
    ) into v_identity_needs_name;
  end if;

  select c.id
    into v_crm_conversation_id
  from public.crm_conversations c
  where c.studio_id = target_studio_id
    and c.provider = 'meta_whatsapp'
    and c.provider_contact_id = v_wa_id
    and v_activity_at >= c.started_at
    and v_activity_at < c.started_at + interval '24 hours'
  order by c.started_at desc
  limit 1
  for update;

  if v_crm_conversation_id is null then
    insert into public.crm_conversations(
      studio_id,
      provider,
      provider_contact_id,
      contact_name,
      contact_phone,
      student_id,
      crm_contact_id,
      channel,
      started_at,
      last_activity_at,
      activity_count,
      source,
      campaign,
      first_source_event_id,
      last_source_event_id,
      metadata
    )
    values (
      target_studio_id,
      'meta_whatsapp',
      v_wa_id,
      v_profile_name,
      v_phone,
      v_student_id,
      v_crm_contact_id,
      'whatsapp',
      v_activity_at,
      v_activity_at,
      1,
      'meta_whatsapp',
      null,
      null,
      null,
      jsonb_build_object(
        'meta_first_event_id', target_event_id,
        'meta_last_event_id', target_event_id
      )
    )
    returning id into v_crm_conversation_id;

    perform public.emit_domain_event(
      p_studio_id => target_studio_id,
      p_event_type => 'conversation.started',
      p_source_entity_type => 'crm_conversation',
      p_source_entity_id => v_crm_conversation_id,
      p_deduplication_key => 'conversation.started:' || v_crm_conversation_id::text,
      p_occurred_at => v_activity_at,
      p_actor_user_id => null,
      p_payload => jsonb_build_object(
        'conversation_id', v_crm_conversation_id,
        'student_id', v_student_id,
        'provider', 'meta_whatsapp',
        'provider_contact_id', v_wa_id,
        'channel', 'whatsapp',
        'source', 'meta_whatsapp'
      )
    );
  else
    update public.crm_conversations
    set contact_name = coalesce(contact_name, v_profile_name),
        contact_phone = coalesce(contact_phone, v_phone),
        student_id = coalesce(student_id, v_student_id),
        crm_contact_id = coalesce(crm_contact_id, v_crm_contact_id),
        last_activity_at = greatest(last_activity_at, v_activity_at),
        activity_count = activity_count + 1,
        metadata = metadata || jsonb_build_object(
          'meta_last_event_id', target_event_id
        ),
        updated_at = clock_timestamp()
    where id = v_crm_conversation_id;
  end if;

  select ac.id, ac.status, ac.context
    into v_assistant_conversation_id, v_existing_status, v_assistant_context
  from public.assistant_conversations ac
  where ac.studio_id = target_studio_id
    and ac.channel = 'whatsapp'
    and ac.external_thread_ref = v_wa_id
  limit 1
  for update;

  if v_assistant_conversation_id is not null then
    v_identity_needs_name := coalesce((v_assistant_context->>'identity_needs_name')::boolean, false);
    if not v_identity_needs_name and v_student_id is null and v_crm_contact_id is not null then
      select exists (
        select 1
        from public.crm_contacts c
        join public.persons p on p.id = c.person_id and p.studio_id = c.studio_id
        where c.id = v_crm_contact_id
          and c.studio_id = target_studio_id
          and lower(trim(coalesce(p.first_name, ''))) = 'prospecto'
          and nullif(trim(coalesce(p.last_name, '')), '') is null
      ) into v_identity_needs_name;
    end if;

    if v_identity_needs_name and v_student_id is null and v_crm_contact_id is not null and not v_new_contact then
      if v_person_id is null then
        select c.person_id into v_person_id
        from public.crm_contacts c
        where c.id = v_crm_contact_id and c.studio_id = target_studio_id;
      end if;
      v_capture_name := trim(regexp_replace(v_message_text, '^(me llamo|mi nombre es|soy)[[:space:]]+', '', 'i'));
      if v_capture_name is not null
         and char_length(v_capture_name) between 2 and 180
         and v_capture_name ~ '^[[:alpha:]][[:alpha:] ''’.-]*$'
         and array_length(regexp_split_to_array(v_capture_name, '[[:space:]]+'), 1) between 1 and 6
         and lower(v_capture_name) !~ '(^|[[:space:]])(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|hoy|mañana|manana|ocho|nueve|diez|once|doce|clase|horario|reservar|reserva|pole|fitness|twerk|yoga|heels|espiral|flexibilidad|aérea|aerea)([[:space:]]|$)'
         and not exists (
           select 1 from public.class_templates ct
           where ct.studio_id = target_studio_id
             and lower(trim(ct.name)) = lower(trim(v_capture_name))
         ) then
        v_name_parts := regexp_split_to_array(trim(v_capture_name), '[[:space:]]+');
        v_full_name := trim(v_capture_name);
        update public.persons p
        set first_name = left(v_name_parts[1], 120),
            last_name = nullif(left(array_to_string(v_name_parts[2:array_length(v_name_parts, 1)], ' '), 180), ''),
            updated_at = clock_timestamp()
        where p.id = v_person_id and p.studio_id = target_studio_id;
        update public.crm_conversations
        set contact_name = v_full_name, updated_at = clock_timestamp()
        where studio_id = target_studio_id and id = v_crm_conversation_id;
        v_identity_needs_name := false;
      end if;
    end if;
  end if;

  v_identity_needs_name := case
    when v_student_id is not null then false
    else v_identity_needs_name or v_new_contact
  end;

  if v_assistant_conversation_id is null then
    insert into public.assistant_conversations(
      studio_id,
      channel,
      external_thread_ref,
      crm_conversation_id,
      student_id,
      status,
      context
    )
    values (
      target_studio_id,
      'whatsapp',
      v_wa_id,
      v_crm_conversation_id,
      v_student_id,
      'open',
      case
        when v_crm_contact_id is not null
          then jsonb_build_object(
            'crm_contact_id', v_crm_contact_id,
            'contact_phone', v_phone,
            'provider', 'meta_whatsapp',
            'identity_needs_name', v_identity_needs_name
          )
        else jsonb_build_object(
          'contact_phone', v_phone,
          'provider', 'meta_whatsapp'
        )
      end
    )
    returning id into v_assistant_conversation_id;
  else
    update public.assistant_conversations
    set crm_conversation_id = v_crm_conversation_id,
        student_id = coalesce(student_id, v_student_id),
        context = context || jsonb_build_object(
          'crm_contact_id', v_crm_contact_id,
          'contact_phone', v_phone,
          'provider', 'meta_whatsapp',
          'identity_needs_name', v_identity_needs_name
        ),
        last_activity_at = greatest(last_activity_at, v_activity_at),
        updated_at = clock_timestamp()
    where id = v_assistant_conversation_id;
  end if;

  select exists (
    select 1
    from public.assistant_handoffs h
    where h.studio_id = target_studio_id
      and h.conversation_id = v_assistant_conversation_id
      and h.status = 'open'
  ) into v_handoff_open;

  if not v_handoff_open and coalesce(v_existing_status, 'open') = 'closed' then
    update public.assistant_conversations
    set status = 'open',
        updated_at = clock_timestamp()
    where id = v_assistant_conversation_id;
  end if;

  insert into public.assistant_turns(
    studio_id,
    conversation_id,
    direction,
    role,
    content,
    sanitized,
    channel_message_ref,
    created_at
  )
  values (
    target_studio_id,
    v_assistant_conversation_id,
    'inbound',
    'user',
    left(v_message_text, 2000),
    true,
    v_provider_message_id,
    v_activity_at
  )
  on conflict (studio_id, channel_message_ref)
  where channel_message_ref is not null
  do nothing
  returning id into v_inbound_turn_id;

  if v_inbound_turn_id is null then
    select t.id
      into v_inbound_turn_id
    from public.assistant_turns t
    where t.studio_id = target_studio_id
      and t.channel_message_ref = v_provider_message_id
    limit 1;
  end if;

  update public.assistant_whatsapp_events
  set assistant_conversation_id = v_assistant_conversation_id,
      inbound_turn_id = v_inbound_turn_id,
      updated_at = clock_timestamp()
  where id = target_event_id
    and studio_id = target_studio_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', v_student_id,
    'crm_contact_id', v_crm_contact_id,
    'crm_conversation_id', v_crm_conversation_id,
    'assistant_conversation_id', v_assistant_conversation_id,
    'inbound_turn_id', v_inbound_turn_id,
    'handoff_open', v_handoff_open,
    'phone_e164', v_phone,
    'identity_needs_name', v_identity_needs_name
  );
end;
$function$;


revoke all on function public.service_prepare_meta_whatsapp_message(uuid,uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.service_prepare_meta_whatsapp_message(uuid,uuid,text,text,text,text,text,timestamptz) to service_role;
