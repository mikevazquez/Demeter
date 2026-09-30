create or replace function private.seed_studio_payment_methods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.studio_payment_methods(
    studio_id, code, name, category, active, requires_reference, allow_refunds, sort_order, is_system
  )
  values
    (new.id,'cash','Efectivo','cash',true,false,true,10,true),
    (new.id,'bank_transfer','Transferencia','transfer',true,true,true,20,true),
    (new.id,'card','Tarjeta','card',true,false,true,30,true),
    (new.id,'other','Otro','other',true,true,true,90,true)
  on conflict (studio_id,code) do nothing;

  return new;
end;
$$;

drop trigger if exists seed_studio_payment_methods on public.studios;
create trigger seed_studio_payment_methods
after insert on public.studios
for each row execute function private.seed_studio_payment_methods();

drop policy if exists studio_payment_methods_write on public.studio_payment_methods;
create policy studio_payment_methods_write
on public.studio_payment_methods
for all
to authenticated
using (
  private.has_studio_role(
    studio_id,
    array['owner'::public.studio_role]
  )
)
with check (
  private.has_studio_role(
    studio_id,
    array['owner'::public.studio_role]
  )
);

create index if not exists studio_payment_methods_active_sort_idx
  on public.studio_payment_methods(studio_id, active, sort_order);
