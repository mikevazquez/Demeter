-- SF-246 cancellation consumer coverage.

create or replace function private.reward_try_process_domain_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type in ('attendance.finalized', 'attendance.corrected', 'attendance.cancelled', 'loyalty.changed') then
    begin
      perform public.system_process_reward_domain_event(new.event_id);
    exception when others then
      -- Rewards is downstream. Never fail the source operation.
      null;
    end;
  end if;
  return new;
end;
$$;


revoke all on function private.reward_try_process_domain_event()
from public, anon, authenticated, service_role;
