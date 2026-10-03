create or replace function private.resolve_transfer_review_handoff_after_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'provisional_active'
     and new.status in ('validated','rejected') then
    update public.assistant_handoffs
    set status='resolved',
        resolved_at=coalesce(resolved_at,clock_timestamp())
    where studio_id=new.studio_id
      and conversation_id=new.conversation_id
      and reason_code='transfer_receipt_review'
      and status='open';

    update public.assistant_conversations
    set status='open',
        updated_at=clock_timestamp()
    where id=new.conversation_id
      and studio_id=new.studio_id;
  end if;

  return new;
end;
$function$;

revoke all on function private.resolve_transfer_review_handoff_after_status()
from public, anon, authenticated, service_role;

drop trigger if exists assistant_transfer_purchase_resolve_handoff
on public.assistant_transfer_purchase_intents;

create trigger assistant_transfer_purchase_resolve_handoff
after update of status on public.assistant_transfer_purchase_intents
for each row
execute function private.resolve_transfer_review_handoff_after_status();
