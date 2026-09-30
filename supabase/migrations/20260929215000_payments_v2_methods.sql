create table if not exists public.studio_payment_methods (
  studio_id uuid not null references public.studios(id) on delete cascade,
  code text not null,
  name text not null,
  category text not null default 'other',
  active boolean not null default true,
  requires_reference boolean not null default false,
  allow_refunds boolean not null default true,
  sort_order integer not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (studio_id, code),
  constraint studio_payment_methods_code_chk
    check (code ~ '^[a-z0-9_]{2,60}$'),
  constraint studio_payment_methods_name_chk
    check (length(btrim(name)) between 2 and 60),
  constraint studio_payment_methods_category_chk
    check (category in ('cash','transfer','card','digital','other')),
  constraint studio_payment_methods_sort_chk
    check (sort_order between 0 and 1000)
);

alter table public.studio_payment_methods enable row level security;

grant select, insert, update, delete on public.studio_payment_methods to authenticated;
revoke all on public.studio_payment_methods from anon;

drop policy if exists studio_payment_methods_read on public.studio_payment_methods;
create policy studio_payment_methods_read
on public.studio_payment_methods
for select
to authenticated
using (
  private.has_capability(studio_id,'sales.read')
  or private.has_capability(studio_id,'settings.write')
);

drop policy if exists studio_payment_methods_write on public.studio_payment_methods;
create policy studio_payment_methods_write
on public.studio_payment_methods
for all
to authenticated
using (private.has_capability(studio_id,'settings.write'))
with check (private.has_capability(studio_id,'settings.write'));

insert into public.studio_payment_methods(
  studio_id, code, name, category, active, requires_reference, allow_refunds, sort_order, is_system
)
select id, seed.code, seed.name, seed.category, true, seed.requires_reference, true, seed.sort_order, true
from public.studios
cross join (
  values
    ('cash','Efectivo','cash',false,10),
    ('bank_transfer','Transferencia','transfer',true,20),
    ('card','Tarjeta','card',false,30),
    ('other','Otro','other',true,90)
) as seed(code,name,category,requires_reference,sort_order)
on conflict (studio_id,code) do nothing;

comment on table public.studio_payment_methods is
  'Métodos de pago manuales configurables por estudio. payments.method conserva el code canónico en movimientos nuevos.';
