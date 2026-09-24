create table if not exists public.person_notification_channel_preferences (
  studio_id uuid not null references public.studios(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  push_enabled boolean not null default true,
  whatsapp_enabled boolean not null default true,
  email_enabled boolean not null default true,
  updated_by_user_id uuid,
  updated_at timestamptz not null default now(),
  primary key (studio_id, person_id)
);

alter table public.person_notification_channel_preferences enable row level security;
revoke all on public.person_notification_channel_preferences from anon, authenticated;

create or replace function public.student_get_notification_channel_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_student public.students%rowtype;
  v_pref public.person_notification_channel_preferences%rowtype;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_student
  from public.students s
  where s.user_id = v_uid and s.active and s.lifecycle_status = 'active'
  order by s.created_at asc
  limit 1;

  if not found or v_student.person_id is null then raise exception 'student_context_not_found'; end if;

  select * into v_pref
  from public.person_notification_channel_preferences p
  where p.studio_id = v_student.studio_id and p.person_id = v_student.person_id;

  return jsonb_build_object(
    'push_enabled', coalesce(v_pref.push_enabled, true),
    'whatsapp_enabled', coalesce(v_pref.whatsapp_enabled, true),
    'email_enabled', coalesce(v_pref.email_enabled, true)
  );
end;
$function$;

create or replace function public.student_set_notification_channel_preference(
  p_channel_key text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_student public.students%rowtype;
  v_pref public.person_notification_channel_preferences%rowtype;
  v_channel text := lower(trim(coalesce(p_channel_key, '')));
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if v_channel not in ('push','whatsapp','email') then raise exception 'notification_channel_invalid'; end if;

  select * into v_student
  from public.students s
  where s.user_id = v_uid and s.active and s.lifecycle_status = 'active'
  order by s.created_at asc
  limit 1;

  if not found or v_student.person_id is null then raise exception 'student_context_not_found'; end if;

  insert into public.person_notification_channel_preferences (
    studio_id,person_id,push_enabled,whatsapp_enabled,email_enabled,updated_by_user_id,updated_at
  ) values (
    v_student.studio_id,
    v_student.person_id,
    case when v_channel = 'push' then p_enabled else true end,
    case when v_channel = 'whatsapp' then p_enabled else true end,
    case when v_channel = 'email' then p_enabled else true end,
    v_uid,
    clock_timestamp()
  )
  on conflict (studio_id, person_id)
  do update set
    push_enabled = case when v_channel = 'push' then excluded.push_enabled else public.person_notification_channel_preferences.push_enabled end,
    whatsapp_enabled = case when v_channel = 'whatsapp' then excluded.whatsapp_enabled else public.person_notification_channel_preferences.whatsapp_enabled end,
    email_enabled = case when v_channel = 'email' then excluded.email_enabled else public.person_notification_channel_preferences.email_enabled end,
    updated_by_user_id = v_uid,
    updated_at = clock_timestamp()
  returning * into v_pref;

  return jsonb_build_object(
    'push_enabled', v_pref.push_enabled,
    'whatsapp_enabled', v_pref.whatsapp_enabled,
    'email_enabled', v_pref.email_enabled
  );
end;
$function$;

create or replace function private.person_notification_channel_enabled(
  p_studio_id uuid,
  p_person_id uuid,
  p_channel_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case lower(trim(coalesce(p_channel_key,'')))
    when 'push' then coalesce((select p.push_enabled from public.person_notification_channel_preferences p where p.studio_id=p_studio_id and p.person_id=p_person_id), true)
    when 'whatsapp' then coalesce((select p.whatsapp_enabled from public.person_notification_channel_preferences p where p.studio_id=p_studio_id and p.person_id=p_person_id), true)
    when 'email' then coalesce((select p.email_enabled from public.person_notification_channel_preferences p where p.studio_id=p_studio_id and p.person_id=p_person_id), true)
    else true
  end;
$function$;

create or replace function public.system_materialize_notification(
  p_studio_id uuid,p_source_event_id uuid,p_rule_id uuid,p_rule_version_number integer,
  p_notification_type text,p_communication_class text,p_recipient_type text,
  p_recipient_entity_id uuid,p_recipient_user_id uuid,p_recipient_snapshot jsonb,
  p_priority text,p_scheduled_for timestamptz,p_expires_at timestamptz,
  p_template_key text,p_template_variables jsonb,p_deduplication_key text,
  p_channels jsonb,p_suppressed boolean default false,p_reason_code text default null,
  p_reason_detail text default null
)
returns table(notification_id uuid, created boolean, jobs_created integer)
language plpgsql
set search_path = ''
as $function$
declare
  v_notification_id uuid;
  v_created boolean := false;
  v_jobs_created integer := 0;
  v_channel jsonb;
  v_channel_key text;
  v_is_required boolean;
  v_max_attempts integer;
  v_scheduled_at timestamptz;
  v_person_id uuid;
begin
  if p_communication_class not in ('P0','P1','P2') then raise exception 'notification_communication_class_invalid'; end if;
  if p_recipient_snapshot is null or jsonb_typeof(p_recipient_snapshot) <> 'object' then raise exception 'notification_recipient_snapshot_must_be_object'; end if;
  if p_template_variables is null or jsonb_typeof(p_template_variables) <> 'object' then raise exception 'notification_template_variables_must_be_object'; end if;
  if p_channels is null or jsonb_typeof(p_channels) <> 'array' then raise exception 'notification_channels_must_be_array'; end if;
  if not coalesce(p_suppressed,false) and jsonb_array_length(p_channels)=0 then raise exception 'notification_channels_required'; end if;

  if trim(coalesce(p_recipient_type,''))='student' and p_recipient_entity_id is not null then
    select s.person_id into v_person_id
    from public.students s
    where s.id=p_recipient_entity_id and s.studio_id=p_studio_id;
  end if;

  insert into public.notifications (
    studio_id,source_event_id,rule_id,rule_version_number,notification_type,communication_class,
    recipient_type,recipient_entity_id,recipient_user_id,recipient_snapshot,priority,state,
    scheduled_for,expires_at,template_key,template_variables,deduplication_key,state_reason_code,
    state_reason_detail,state_actor_type,suppressed_at
  ) values (
    p_studio_id,p_source_event_id,p_rule_id,p_rule_version_number,trim(p_notification_type),
    p_communication_class,trim(p_recipient_type),p_recipient_entity_id,p_recipient_user_id,
    p_recipient_snapshot,p_priority,case when coalesce(p_suppressed,false) then 'suppressed' else 'active' end,
    p_scheduled_for,p_expires_at,trim(p_template_key),p_template_variables,trim(p_deduplication_key),
    case when coalesce(p_suppressed,false) then coalesce(nullif(trim(coalesce(p_reason_code,'')),''),'suppressed') else 'created' end,
    nullif(left(trim(coalesce(p_reason_detail,'')),1000),''),'system',
    case when coalesce(p_suppressed,false) then clock_timestamp() else null end
  )
  on conflict (studio_id,deduplication_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select n.id into v_notification_id
    from public.notifications n
    where n.studio_id=p_studio_id and n.deduplication_key=trim(p_deduplication_key);
    return query select v_notification_id,false,0;
    return;
  end if;

  v_created := true;

  if not coalesce(p_suppressed,false) then
    for v_channel in select value from jsonb_array_elements(p_channels)
    loop
      v_channel_key := nullif(trim(coalesce(v_channel->>'channel_key','')),'');
      if v_channel_key is null then raise exception 'notification_channel_key_required'; end if;
      if not exists(select 1 from public.notification_channels c where c.channel_key=v_channel_key and c.is_active) then
        raise exception 'notification_channel_inactive:%',v_channel_key;
      end if;

      if v_person_id is not null
         and v_channel_key in ('push','whatsapp','email')
         and not private.person_notification_channel_enabled(p_studio_id,v_person_id,v_channel_key) then
        continue;
      end if;

      v_is_required := coalesce((v_channel->>'is_required')::boolean,true);
      v_max_attempts := greatest(1,least(10,coalesce(nullif(v_channel#>>'{channel_policy,max_attempts}','')::integer,3)));
      v_scheduled_at := coalesce(p_scheduled_for,clock_timestamp());

      insert into public.notification_jobs (
        studio_id,notification_id,channel_key,is_required,state,scheduled_at,available_at,expires_at,
        max_attempts,channel_deduplication_key,state_reason_code,state_actor_type
      ) values (
        p_studio_id,v_notification_id,v_channel_key,v_is_required,
        case when v_scheduled_at > clock_timestamp() then 'scheduled' else 'ready' end,
        v_scheduled_at,v_scheduled_at,p_expires_at,v_max_attempts,
        v_notification_id::text||':'||v_channel_key,'created','system'
      );
      v_jobs_created := v_jobs_created + 1;
    end loop;
  end if;

  return query select v_notification_id,v_created,v_jobs_created;
end;
$function$;

revoke all on function public.student_get_notification_channel_preferences() from public;
revoke all on function public.student_set_notification_channel_preference(text, boolean) from public;
grant execute on function public.student_get_notification_channel_preferences() to authenticated;
grant execute on function public.student_set_notification_channel_preference(text, boolean) to authenticated;
