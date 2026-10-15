-- Reduced host schema for isolated PostgreSQL integration tests ONLY.
-- No workshop tables or RPCs are mocked: the runner installs their recovered
-- migrations. External Demeter/Auth tables below remain reduced dependencies.
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
create table public.studios (id uuid primary key, currency text not null default 'MXN', status text not null default 'active');
create table public.disciplines (id uuid primary key);
create table public.user_accounts (id uuid primary key references auth.users(id), status text not null default 'active');
create table public.students (
  id uuid primary key, studio_id uuid not null references public.studios(id), user_id uuid,
  full_name text not null default 'Local student', active boolean not null default true,
  lifecycle_status text not null default 'active'
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
  ends_at timestamptz not null default (now()+interval '21 days'),
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
create table public.studio_payment_methods (
  studio_id uuid references public.studios(id), code text,
  active boolean not null default true, primary key(studio_id,code)
);
-- Match Supabase public-schema service-role defaults for newly migrated tables.
alter default privileges in schema public grant all on tables to service_role;
grant select,insert,update,delete on all tables in schema public to service_role;

insert into public.studios(id) values
  ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into auth.users values
  ('00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000012'),
  ('00000000-0000-4000-8000-000000000013');
insert into public.user_accounts(id) select id from auth.users;
insert into public.role_capabilities values ('admin','sales.write'),('admin','schedule.write'),
  ('admin','sales.read'),('admin','schedule.read'),('admin','students.read'),
  ('sales_only','sales.write'),('reader','schedule.read'),('reader','sales.read');
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

-- Explicit external-domain contract doubles; NOT the actual documents/enrollment engines.
create table private.local_booking_gate_fixture (
  student_id uuid, session_id uuid, blocked boolean not null default false,
  enrollment_missing boolean not null default false, primary key(student_id,session_id)
);
create function private.student_booking_blockers(p_student_id uuid,p_session_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select case when exists(select 1 from private.local_booking_gate_fixture
    where student_id=p_student_id and session_id=p_session_id and blocked)
    then '["local_booking_block"]'::jsonb else '[]'::jsonb end;
$$;
create function private.student_enrollment_requirement_for_booking(p_student_id uuid,p_session_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('missing',exists(select 1 from private.local_booking_gate_fixture
    where student_id=p_student_id and session_id=p_session_id and enrollment_missing));
$$;
revoke all on function private.student_booking_blockers(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.student_enrollment_requirement_for_booking(uuid,uuid) from public,anon,authenticated,service_role;
