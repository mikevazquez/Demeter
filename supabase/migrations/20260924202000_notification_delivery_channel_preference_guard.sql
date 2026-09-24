create or replace function public.service_notification_channel_allowed(
  p_studio_id uuid,
  p_recipient_type text,
  p_recipient_entity_id uuid,
  p_channel_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_person_id uuid;
  v_channel text := lower(trim(coalesce(p_channel_key,'')));
begin
  if v_channel not in ('push','whatsapp','email') then
    return true;
  end if;

  if trim(coalesce(p_recipient_type,'')) <> 'student'
     or p_recipient_entity_id is null then
    return true;
  end if;

  select s.person_id into v_person_id
  from public.students s
  where s.id=p_recipient_entity_id
    and s.studio_id=p_studio_id;

  if v_person_id is null then
    return true;
  end if;

  return private.person_notification_channel_enabled(p_studio_id,v_person_id,v_channel);
end;
$function$;

revoke all on function public.service_notification_channel_allowed(uuid,text,uuid,text) from public;
grant execute on function public.service_notification_channel_allowed(uuid,text,uuid,text) to service_role;
