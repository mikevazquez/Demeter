-- NOTIFICACIONES-02 essential process guard

create or replace function public.admin_set_notification_rules_enabled(
  p_studio_id uuid,
  p_rule_keys text[],
  p_enabled boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.has_capability(p_studio_id, 'automations.manage') then
    raise exception 'forbidden';
  end if;

  if p_rule_keys is null or cardinality(p_rule_keys) = 0 then
    raise exception 'notification_rule_keys_required';
  end if;

  if p_enabled = false and (
    'p0.session.minimum_cancelled_students' = any(p_rule_keys)
    or 'p0.session.minimum_cancelled_coach' = any(p_rule_keys)
  ) then
    raise exception 'notification_process_essential';
  end if;

  update public.notification_rules
  set enabled = p_enabled,
      updated_by_user_id = auth.uid(),
      updated_at = clock_timestamp()
  where studio_id = p_studio_id
    and rule_key = any(p_rule_keys)
    and archived_at is null;

  get diagnostics v_count = row_count;

  if v_count <> cardinality(p_rule_keys) then
    raise exception 'notification_rule_set_incomplete';
  end if;

  return v_count;
end;
$$;

revoke all on function public.admin_set_notification_rules_enabled(uuid,text[],boolean)
from public, anon, authenticated;
grant execute on function public.admin_set_notification_rules_enabled(uuid,text[],boolean)
to authenticated;
