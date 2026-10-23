-- NEB-01 · Test doubles for base Supabase services; never apply this fixture to Sandbox/production.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create schema private;
grant usage on schema auth, private, public to anon, authenticated;
create table auth.users (id uuid primary key, email text, last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table public.studios (id uuid primary key default gen_random_uuid(), name text not null, slug text unique);
create table public.studio_memberships (studio_id uuid references public.studios(id), user_id uuid references auth.users(id), role text, active boolean default true, primary key (studio_id, user_id));
create table public.role_capabilities (role text, capability_key text);
insert into public.role_capabilities values ('owner', 'settings.write'), ('admin', 'settings.write');

create or replace function private.has_capability(p_studio_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studio_memberships m join public.role_capabilities rc on rc.role = m.role
    where m.studio_id = p_studio_id and m.user_id = (select auth.uid()) and m.active = true and rc.capability_key = p_capability);
$$;
grant execute on function private.has_capability(uuid, text) to authenticated;

-- Existing studio before Nébora (Demeter) must be backfilled as All Access.
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1'), -- Mike (platform admin)
  ('00000000-0000-0000-0000-0000000000b1'), -- owner of studio B
  ('00000000-0000-0000-0000-0000000000c1'); -- coach of studio B
insert into public.studios (id, name, slug) values ('10000000-0000-0000-0000-000000000001', 'Demeter Fitness', 'demeter-fitness');
grant select on public.studios, public.studio_memberships to authenticated;

-- Minimal stand-ins for the tables NEB-01-03 guards (only id + studio_id matter).
create table public.sales (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), status text not null default 'confirmed', total_minor bigint not null default 0, created_at timestamptz not null default now());
create table public.reservations (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), status text not null default 'reserved', booked_at timestamptz not null default now());
create table public.reward_programs (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.reward_challenge_enrollments (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.evaluation_templates (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.technical_evaluations (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.evaluation_invitations (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.resources (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.space_maps (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.reservation_resource_assignments (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));

-- NEB-01-10/11 · stand-ins for the console reads (only the columns they read).
create table public.students (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), active boolean not null default true, created_at timestamptz not null default now());
create table public.product_acquisitions (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), student_id uuid not null, status text not null default 'active', expires_on date);
create table public.class_sessions (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), starts_at timestamptz not null, status text not null default 'scheduled');
create table public.assistant_model_calls (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), input_tokens integer not null default 0, output_tokens integer not null default 0, estimated_cost_usd_micros bigint not null default 0, created_at timestamptz not null default now());
