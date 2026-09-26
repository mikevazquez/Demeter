-- INTEL-05 · Fuente estructurada de gastos para inteligencia financiera.
-- Sandbox first. Production remains untouched until explicitly authorized.

create table if not exists public.studio_expenses (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  category text not null,
  description text not null,
  vendor text,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'MXN',
  effective_on date not null,
  discipline_id uuid references public.disciplines(id) on delete set null,
  class_template_id uuid references public.class_templates(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_expenses_category_valid check (
    category in (
      'rent',
      'payroll',
      'utilities',
      'advertising',
      'maintenance',
      'software',
      'supplies',
      'fees',
      'taxes',
      'other'
    )
  ),
  constraint studio_expenses_currency_valid check (currency ~ '^[A-Z]{3}$')
);

create index if not exists studio_expenses_studio_effective_idx
  on public.studio_expenses(studio_id, effective_on desc);

create index if not exists studio_expenses_studio_category_idx
  on public.studio_expenses(studio_id, category, effective_on desc);

create index if not exists studio_expenses_discipline_idx
  on public.studio_expenses(studio_id, discipline_id, effective_on desc)
  where discipline_id is not null;

alter table public.studio_expenses enable row level security;

revoke all on table public.studio_expenses from public, anon;
grant select, insert, update, delete on table public.studio_expenses to authenticated;
grant select, insert, update, delete on table public.studio_expenses to service_role;

drop policy if exists studio_expenses_read on public.studio_expenses;
create policy studio_expenses_read
on public.studio_expenses
for select
to authenticated
using (
  private.has_capability(studio_id, 'reports.read')
  or private.has_capability(studio_id, 'sales.read')
);

drop policy if exists studio_expenses_insert on public.studio_expenses;
create policy studio_expenses_insert
on public.studio_expenses
for insert
to authenticated
with check (
  private.has_capability(studio_id, 'sales.write')
  and created_by = (select auth.uid())
);

drop policy if exists studio_expenses_update on public.studio_expenses;
create policy studio_expenses_update
on public.studio_expenses
for update
to authenticated
using (private.has_capability(studio_id, 'sales.write'))
with check (private.has_capability(studio_id, 'sales.write'));

drop policy if exists studio_expenses_delete on public.studio_expenses;
create policy studio_expenses_delete
on public.studio_expenses
for delete
to authenticated
using (private.has_capability(studio_id, 'sales.write'));
