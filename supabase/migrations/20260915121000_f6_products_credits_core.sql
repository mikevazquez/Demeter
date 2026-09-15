create type public.product_type as enum ('package','membership','single_class','other');
create type public.product_acquisition_status as enum ('active','expired','cancelled');
create type public.credit_movement_type as enum ('grant','reserve','release','consume','adjustment');

create table public.product_templates (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  description text,
  product_type public.product_type not null,
  price_minor integer not null check (price_minor >= 0),
  currency text not null default 'MXN',
  credit_limit integer check (credit_limit is null or credit_limit > 0),
  validity_days integer not null check (validity_days > 0),
  unlimited boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((unlimited and credit_limit is null) or (not unlimited and credit_limit is not null)),
  unique (studio_id, name)
);

create table public.product_template_disciplines (
  studio_id uuid not null references public.studios(id) on delete cascade,
  product_template_id uuid not null references public.product_templates(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  primary key (product_template_id, discipline_id)
);

create table public.product_acquisitions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  product_template_id uuid not null references public.product_templates(id) on delete restrict,
  status public.product_acquisition_status not null default 'active',
  starts_on date not null,
  expires_on date not null,
  credit_limit integer check (credit_limit is null or credit_limit > 0),
  unlimited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on >= starts_on),
  check ((unlimited and credit_limit is null) or (not unlimited and credit_limit is not null))
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  acquisition_id uuid not null references public.product_acquisitions(id) on delete cascade,
  movement_type public.credit_movement_type not null,
  quantity integer not null check (quantity <> 0),
  reservation_id uuid references public.reservations(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index product_templates_studio_type_active_idx on public.product_templates(studio_id, product_type, active);
create index product_template_disciplines_studio_idx on public.product_template_disciplines(studio_id, discipline_id);
create index product_acquisitions_student_active_idx on public.product_acquisitions(studio_id, student_id, status, expires_on);
create index credit_ledger_acquisition_created_idx on public.credit_ledger(acquisition_id, created_at, id);
create index credit_ledger_reservation_idx on public.credit_ledger(reservation_id) where reservation_id is not null;

alter table public.product_templates enable row level security;
alter table public.product_template_disciplines enable row level security;
alter table public.product_acquisitions enable row level security;
alter table public.credit_ledger enable row level security;

grant select, insert, update on public.product_templates to authenticated;
grant select, insert, update, delete on public.product_template_disciplines to authenticated;
grant select, insert, update on public.product_acquisitions to authenticated;
grant select, insert on public.credit_ledger to authenticated;

create policy product_templates_read on public.product_templates for select to authenticated
  using ((select private.has_capability(studio_id, 'products.read')));
create policy product_templates_write_insert on public.product_templates for insert to authenticated
  with check ((select private.has_capability(studio_id, 'products.write')));
create policy product_templates_write_update on public.product_templates for update to authenticated
  using ((select private.has_capability(studio_id, 'products.write')))
  with check ((select private.has_capability(studio_id, 'products.write')));

create policy product_template_disciplines_read on public.product_template_disciplines for select to authenticated
  using ((select private.has_capability(studio_id, 'products.read')));
create policy product_template_disciplines_write_insert on public.product_template_disciplines for insert to authenticated
  with check ((select private.has_capability(studio_id, 'products.write')));
create policy product_template_disciplines_write_update on public.product_template_disciplines for update to authenticated
  using ((select private.has_capability(studio_id, 'products.write')))
  with check ((select private.has_capability(studio_id, 'products.write')));
create policy product_template_disciplines_write_delete on public.product_template_disciplines for delete to authenticated
  using ((select private.has_capability(studio_id, 'products.write')));

create policy product_acquisitions_read on public.product_acquisitions for select to authenticated
  using ((select private.has_capability(studio_id, 'products.read')));
create policy product_acquisitions_write_insert on public.product_acquisitions for insert to authenticated
  with check ((select private.has_capability(studio_id, 'products.write')));
create policy product_acquisitions_write_update on public.product_acquisitions for update to authenticated
  using ((select private.has_capability(studio_id, 'products.write')))
  with check ((select private.has_capability(studio_id, 'products.write')));

create policy credit_ledger_read on public.credit_ledger for select to authenticated
  using ((select private.has_capability(studio_id, 'products.read')));
create policy credit_ledger_write_insert on public.credit_ledger for insert to authenticated
  with check ((select private.has_capability(studio_id, 'products.write')));

create or replace function public.acquisition_credit_balance(p_acquisition_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cl.quantity), 0)::integer
  from public.credit_ledger cl
  where cl.acquisition_id = p_acquisition_id;
$$;

grant execute on function public.acquisition_credit_balance(uuid) to authenticated;
