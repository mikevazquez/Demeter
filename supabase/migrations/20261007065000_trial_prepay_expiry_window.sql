create or replace function private.set_trial_transfer_expiry()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.intent_kind='trial_class' and new.status='awaiting_receipt' then
    new.expires_at := clock_timestamp() + interval '30 minutes';
  end if;
  return new;
end;
$function$;

drop trigger if exists set_trial_transfer_expiry on public.assistant_transfer_purchase_intents;
create trigger set_trial_transfer_expiry
before insert on public.assistant_transfer_purchase_intents
for each row execute function private.set_trial_transfer_expiry();
