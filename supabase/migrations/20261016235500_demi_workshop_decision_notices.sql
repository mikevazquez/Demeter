-- Sandbox only: reuse Demi's existing deduplicated delivery queue for workshop decisions.
alter table public.demi_receipt_review_notices
 drop constraint if exists demi_receipt_review_notices_source_kind_check;
alter table public.demi_receipt_review_notices
 add constraint demi_receipt_review_notices_source_kind_check
 check (source_kind in ('enrollment','transfer','workshop'));

create or replace function private.queue_demi_workshop_decision_notice()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_link public.demi_workshop_hold_links%rowtype; v_decision text; v_message text;
begin
 if new.state is not distinct from old.state
 or new.state not in ('confirmed','rejected','expired') then return new; end if;
 select * into v_link from public.demi_workshop_hold_links
 where hold_id=new.id and studio_id=new.studio_id;
 if not found then return new; end if;
 if not exists(select 1 from public.assistant_conversations
 where id=v_link.conversation_id and studio_id=new.studio_id and student_id=new.student_id)
 then raise exception 'workshop_conversation_mismatch'; end if;
 v_decision:=case when new.state='confirmed' then 'approved' else 'rejected' end;
 v_message:=case
 when new.state='confirmed' then
  'El equipo verificó tu transferencia del taller y confirmó tu inscripción. Tu reserva ya está registrada.'
 when new.state='expired' then
  'El plazo de revisión de tu comprobante del taller venció y el apartado provisional se liberó. No se confirmó ningún pago. Contáctanos para revisar disponibilidad.'
 else
  'El equipo rechazó el comprobante del taller. El apartado provisional se liberó y no se registró ningún pago. Motivo: '||
  coalesce(nullif(new.rejection_reason,''),'no fue posible validar el ingreso') end;
 insert into public.demi_receipt_review_notices(
 studio_id,conversation_id,source_kind,source_id,decision,notification_text,amount_minor,currency)
 values(new.studio_id,v_link.conversation_id,'workshop',new.id,v_decision,v_message,new.amount_minor,new.currency)
 on conflict do nothing;
 return new;
end $$;
revoke all on function private.queue_demi_workshop_decision_notice() from public,anon,authenticated,service_role;
drop trigger if exists demi_workshop_decision_notice on public.workshop_provisional_holds;
create trigger demi_workshop_decision_notice after update of state on public.workshop_provisional_holds
for each row execute function private.queue_demi_workshop_decision_notice();