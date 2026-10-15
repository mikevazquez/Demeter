-- Reduced host schema for isolated PostgreSQL integration tests ONLY.
-- Workshop columns and v1 functions were reconciled read-only with Sandbox on
-- 2026-10-15. This is not a full Demeter migration replay or Supabase/PostgREST.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role';
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
create table public.studios (id uuid primary key, currency text not null default 'MXN');
create table public.students (
  id uuid primary key, studio_id uuid not null references public.studios(id), user_id uuid
);
create table public.studio_memberships (
  studio_id uuid references public.studios(id), user_id uuid references auth.users(id),
  role text, active boolean not null default true, primary key(studio_id, user_id)
);
create table public.role_capabilities (role text, capability_key text);
-- Same capability join used by the repository capability-model migration.
create function private.has_capability(p_studio_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.studio_memberships m
    join public.role_capabilities rc on rc.role = m.role
    where m.studio_id = p_studio_id and m.user_id = (select auth.uid())
      and m.active = true and rc.capability_key = p_capability
  );
$$;
revoke all on function private.has_capability(uuid,text) from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.has_capability(uuid,text) to authenticated;

create table public.class_sessions (
  id uuid primary key, studio_id uuid not null references public.studios(id),
  starts_at timestamptz not null, capacity integer not null check(capacity>0),
  status text not null default 'scheduled'
);
create table public.sales (
  id uuid primary key default gen_random_uuid(), studio_id uuid references public.studios(id),
  student_id uuid references public.students(id), folio text not null, status text not null,
  currency text not null, total_minor integer not null check(total_minor>=0),
  idempotency_key uuid, payment_due_on date, unique(studio_id,folio)
);
create table public.payments (
  id uuid primary key default gen_random_uuid(), studio_id uuid references public.studios(id),
  sale_id uuid not null references public.sales(id), kind text not null,
  amount_minor integer not null check(amount_minor>0), method text not null, reference text
);
create table public.reservations (
  id uuid primary key default gen_random_uuid(), studio_id uuid references public.studios(id),
  session_id uuid not null references public.class_sessions(id),
  student_id uuid not null references public.students(id), student_user_id uuid,
  status text not null, credits_held integer not null
);
create table public.workshop_studio_policies (
  studio_id uuid primary key references public.studios(id),
  requires_enrollment boolean not null default false,
  overdue_mode text not null default 'keep_and_notify', grace_minutes integer not null default 0
);
create table public.workshop_offers (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
  title text not null, full_price_minor integer not null check(full_price_minor>=0),
  allow_individual_sessions boolean not null default false, requires_enrollment boolean,
  overdue_mode text, grace_minutes integer, deposit_mode text not null default 'full',
  deposit_value numeric(12,2), balance_due_at timestamptz,
  check(deposit_mode in ('full','fixed','percent')),
  check(deposit_value>=0),
  check((deposit_mode='full' and deposit_value is null)
    or (deposit_mode='fixed' and deposit_value is not null and deposit_value<=full_price_minor)
    or (deposit_mode='percent' and deposit_value is not null and deposit_value<=100))
);
create table public.workshop_offer_sessions (
  offer_id uuid references public.workshop_offers(id),
  session_id uuid references public.class_sessions(id),
  individual_price_minor integer check(individual_price_minor>=0), primary key(offer_id,session_id)
);
create table public.workshop_purchases (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
  offer_id uuid not null references public.workshop_offers(id),
  student_id uuid not null references public.students(id), sale_id uuid references public.sales(id),
  total_minor integer not null check(total_minor>=0), paid_minor integer not null check(paid_minor>=0),
  balance_due_at timestamptz, overdue_mode text not null, grace_minutes integer not null,
  status text not null default 'pending_payment', idempotency_key uuid not null,
  unique(studio_id,idempotency_key), check(paid_minor<=total_minor),
  check(status<>'reserved' or paid_minor>=total_minor or balance_due_at is not null)
);
create table public.workshop_purchase_sessions (
  purchase_id uuid references public.workshop_purchases(id),
  session_id uuid references public.class_sessions(id),
  reservation_id uuid unique references public.reservations(id), primary key(purchase_id,session_id)
);
create table public.studio_payment_methods (
  studio_id uuid references public.studios(id), code text,
  active boolean not null default true, primary key(studio_id,code)
);
grant select,insert,update,delete on all tables in schema public to service_role;

insert into public.studios(id) values
  ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into auth.users values
  ('00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000012'),
  ('00000000-0000-4000-8000-000000000013');
insert into public.role_capabilities values ('admin','sales.write');
insert into public.studio_memberships(studio_id,user_id,role) values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','admin'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012','student'),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000013','admin');
insert into public.students(id,studio_id) values
  ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000002');
insert into public.studio_payment_methods(studio_id,code)
select id,code from public.studios cross join (values ('cash'),('bank_transfer')) methods(code);
