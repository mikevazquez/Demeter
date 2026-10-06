-- Version the studio payment-method catalog used by Demi transfer purchases.
-- Sandbox already had this table from earlier UAT; Production did not.
-- Keep existing tenant choices intact and only seed missing default methods.

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

revoke all on table public.studio_payment_methods from public, anon;
grant select, insert, update, delete on table public.studio_payment_methods
to authenticated, service_role;

drop policy if exists studio_payment_methods_read
on public.studio_payment_methods;
create policy studio_payment_methods_read
on public.studio_payment_methods
for select
to authenticated
using (
  private.has_capability(studio_id, 'sales.read')
  or private.has_capability(studio_id, 'settings.write')
);

drop policy if exists studio_payment_methods_write
on public.studio_payment_methods;
create policy studio_payment_methods_write
on public.studio_payment_methods
for all
to authenticated
using (private.has_studio_role(studio_id, array['owner'::public.studio_role]))
with check (private.has_studio_role(studio_id, array['owner'::public.studio_role]));

insert into public.studio_payment_methods (
  studio_id, code, name, category, active, requires_reference,
  allow_refunds, sort_order, is_system
)
select s.id, defaults.code, defaults.name, defaults.category, true,
       defaults.requires_reference, true, defaults.sort_order, true
from public.studios s
cross join (
  values
    ('cash'::text, 'Efectivo'::text, 'cash'::text, false, 10),
    ('bank_transfer'::text, 'Transferencia'::text, 'transfer'::text, true, 20),
    ('card'::text, 'Tarjeta'::text, 'card'::text, false, 30),
    ('other'::text, 'Otro'::text, 'other'::text, false, 90)
) as defaults(code, name, category, requires_reference, sort_order)
on conflict (studio_id, code) do nothing;

comment on table public.studio_payment_methods is
  'Tenant payment-method catalog used by sales and Demi commercial flows.';
