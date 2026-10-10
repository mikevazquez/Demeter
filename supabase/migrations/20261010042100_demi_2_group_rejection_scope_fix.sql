-- An individual receipt rejection must also retire its parent payment context.
create or replace function private.sync_demi_group_receipt_rejection() returns trigger language plpgsql security definer set search_path='' as $$
declare v_group uuid; remaining integer;
begin
 if new.status<>'rejected' or old.status is not distinct from new.status then return new; end if;
 for v_group in select gp.group_id from public.demi_group_participants gp join public.demi_group_bookings g on g.id=gp.group_id and g.studio_id=new.studio_id where gp.transfer_intent_id=new.id loop
  perform 1 from public.demi_group_bookings where id=v_group and studio_id=new.studio_id for update;
  select count(*) into remaining from public.demi_group_participants gp join public.assistant_transfer_purchase_intents i on i.id=gp.transfer_intent_id and i.studio_id=new.studio_id where gp.group_id=v_group and i.status not in ('rejected','cancelled','expired');
  update public.demi_group_bookings set status=case when remaining=0 then 'rejected' else 'partial' end where id=v_group and studio_id=new.studio_id;
 end loop;
 return new;
end $$;
