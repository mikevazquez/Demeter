-- A matching transfer receipt creates a provisional reservation, not a paid one.
-- Keep the reservation's commercial state aligned with the transfer intent lifecycle.
create or replace function private.sync_trial_transfer_commercial_status()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.intent_kind <> 'trial_class'
     or old.status is not distinct from new.status
     or new.reservation_id is null then
    return new;
  end if;

  if new.status = 'provisional_active' then
    update public.reservations
    set commercial_status = 'payment_pending',
        updated_at = clock_timestamp()
    where id = new.reservation_id
      and studio_id = new.studio_id
      and status = 'reserved';
  elsif new.status = 'validated' then
    update public.reservations
    set commercial_status = 'paid',
        updated_at = clock_timestamp()
    where id = new.reservation_id
      and studio_id = new.studio_id
      and status = 'reserved';
  end if;

  return new;
end;
$function$;

revoke all on function private.sync_trial_transfer_commercial_status()
from public, anon, authenticated;

drop trigger if exists sync_trial_transfer_commercial_status
on public.assistant_transfer_purchase_intents;

create trigger sync_trial_transfer_commercial_status
after update of status on public.assistant_transfer_purchase_intents
for each row
execute function private.sync_trial_transfer_commercial_status();
