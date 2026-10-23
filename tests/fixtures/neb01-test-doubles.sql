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

create table public.studios (id uuid primary key default gen_random_uuid(), name text not null, slug text unique, timezone text not null default 'America/Mexico_City');
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

-- NEB-01-35 · stand-in for payments (only what the local-date trigger touches).
create table public.payments (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), amount_minor integer not null default 0, effective_on date not null default current_date);

-- NEB-01-38/39/40 · stand-ins for booking windows (only what the rules and patches touch).
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
grant execute on function auth.role() to anon, authenticated, service_role;
insert into public.role_capabilities values ('owner', 'schedule.write'), ('owner', 'schedule.read'), ('coach', 'attendance.write');
create table public.class_templates (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), name text not null default 'Clase');
alter table public.class_sessions add column template_id uuid references public.class_templates(id);
alter table public.reservations add column student_id uuid references public.students(id), add column session_id uuid references public.class_sessions(id);
create table public.studio_operating_policies (
  studio_id uuid primary key references public.studios(id),
  cancellation_cutoff_minutes integer not null default 300,
  late_cancellation_consumes_credit boolean not null default true,
  no_show_consumes_credit boolean not null default true,
  default_minimum_reservations_enabled boolean not null default false,
  default_minimum_reservations integer not null default 2,
  default_minimum_review_minutes_before integer not null default 120,
  default_minimum_override_allowed boolean not null default true,
  unlimited_late_cancellation_penalty_minor integer not null default 0,
  unlimited_no_show_penalty_minor integer not null default 0,
  updated_by_user_id uuid,
  updated_at timestamptz not null default now());
create table public.class_waitlist_entries (id uuid primary key default gen_random_uuid(), studio_id uuid not null, session_id uuid not null, student_id uuid not null, status text not null default 'active');
create type public.reservation_status as enum ('reserved','attended','cancelled_on_time','cancelled_late','no_show','cancelled_by_studio');

-- Old-style functions with the exact fixed texts the migration replaces.
create function private.reservation_cancellation_outcome(target_studio_id uuid, target_starts_at timestamptz)
returns public.reservation_status language sql stable as $$ select 'cancelled_late'::public.reservation_status $$;
create function public.cancel_reservation(target_reservation_id uuid, target_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_new_status public.reservation_status;
begin
  select * into v_reservation from public.reservations where id = target_reservation_id;
  select * into v_session from public.class_sessions where id = v_reservation.session_id;
  v_new_status := private.reservation_cancellation_outcome(v_reservation.studio_id, v_session.starts_at);
  return v_new_status::text;
end;
$$;
create function public.check_in_reservation(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.class_sessions%rowtype;
begin
  select * into v_session from public.class_sessions where id = p_token::uuid;
  if clock_timestamp() < v_session.starts_at - interval '20 minutes' then
    return jsonb_build_object('status', 'too_early', 'available_at', v_session.starts_at - interval '20 minutes');
  end if;
  if clock_timestamp() >= v_session.starts_at + interval '30 minutes' then
    return jsonb_build_object('status', 'closed');
  end if;
  return jsonb_build_object('status', 'checked_in');
end;
$$;
create function private.booking_eligibility_core(target_session_id uuid, target_student_id uuid, p_allow_started_session boolean default false)
returns jsonb language sql stable as $$ select jsonb_build_object('eligible', true, 'reason_code', null) $$;
create function private.booking_eligibility_regular_program_baseline(target_session_id uuid, target_student_id uuid)
returns jsonb language sql stable as $$ select jsonb_build_object('eligible', true, 'reason_code', null) $$;
create function public.booking_eligibility(target_session_id uuid,target_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_program uuid;
begin
 if v_program is null then return private.booking_eligibility_regular_program_baseline(target_session_id,target_student_id); end if;
 return private.booking_eligibility_core(target_session_id,target_student_id,false);
end;
$$;
grant execute on function public.booking_eligibility(uuid,uuid), public.cancel_reservation(uuid,text), public.check_in_reservation(text) to authenticated;
alter table public.students add column user_id uuid;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1');
