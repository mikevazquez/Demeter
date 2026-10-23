-- CUMP-01 · Test doubles for the birthday migrations; LOCAL database only, never Sandbox/production.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create schema private;
create schema cron;
create schema vault;
grant usage on schema auth, private, public to anon, authenticated, service_role;
create extension if not exists pgcrypto;

create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
language sql as $$ select 1::bigint $$;
create table vault.decrypted_secrets (id uuid, name text, decrypted_secret text);
create function vault.update_secret(uuid, text, text, text) returns void language sql as $$ select $$;

create table public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Mexico_City',
  status text not null default 'active');
create table public.studio_memberships (
  studio_id uuid references public.studios(id), user_id uuid references auth.users(id),
  role text, active boolean default true, primary key (studio_id, user_id));
create table public.role_capabilities (role text, capability_key text);
insert into public.role_capabilities values
  ('owner', 'settings.write'), ('owner', 'students.read'), ('owner', 'automations.read'),
  ('owner', 'schedule.write'), ('student', 'student.booking.self');
create function private.has_capability(p_studio_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studio_memberships m join public.role_capabilities rc on rc.role = m.role
    where m.studio_id = p_studio_id and m.user_id = (select auth.uid()) and m.active and rc.capability_key = p_capability);
$$;
grant execute on function private.has_capability(uuid, text) to authenticated;

create table public.persons (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
  first_name text, last_name text, created_at timestamptz not null default now());
create table public.person_contacts (
  id uuid primary key default gen_random_uuid(), person_id uuid not null references public.persons(id),
  studio_id uuid not null, kind text not null, value text not null, is_primary boolean default false);
create table public.crm_contacts (
  studio_id uuid not null, person_id uuid not null, lifecycle_status text, source text,
  primary key (studio_id, person_id));
create table public.students (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
  person_id uuid references public.persons(id), user_id uuid, full_name text,
  active boolean not null default true, lifecycle_status text not null default 'active',
  student_type text not null default 'regular', trial_status text,
  created_at timestamptz not null default now());
create function private.is_current_student(p_student_id uuid, p_studio_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.students s where s.id = p_student_id and s.studio_id = p_studio_id
    and s.active and s.lifecycle_status = 'active') $$;
create table public.profile_field_definitions (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, entity_type text not null,
  key text not null, active boolean not null default true);
create table public.profile_field_values (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, person_id uuid not null,
  definition_id uuid not null references public.profile_field_definitions(id), value jsonb);
create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(), student_id uuid not null, studio_id uuid not null,
  refunded_at timestamptz, status text not null default 'active', starts_on date not null, expires_on date);

create table public.class_templates (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, name text not null default 'Clase',
  workshop_offer_id uuid);
create table public.class_sessions (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, template_id uuid references public.class_templates(id),
  starts_at timestamptz not null, capacity integer not null default 10, status text not null default 'scheduled',
  requires_resource boolean not null default false);
create type public.reservation_status_v2 as enum
  ('reserved','attended','cancelled_on_time','cancelled_late','no_show','cancelled_by_studio');
create table public.reservations (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, session_id uuid not null references public.class_sessions(id),
  student_id uuid references public.students(id), student_user_id uuid, status public.reservation_status_v2 not null default 'reserved',
  credits_held integer, acquisition_id uuid, guest_person_id uuid references public.persons(id), host_reservation_id uuid,
  booked_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table public.domain_events (
  event_id uuid primary key default gen_random_uuid(), studio_id uuid not null, event_type text not null,
  source_entity_type text, source_entity_id uuid, deduplication_key text not null, payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(), actor_user_id uuid, unique (studio_id, deduplication_key));
create function public.emit_domain_event(p_studio_id uuid, p_event_type text, p_source_entity_type text,
  p_source_entity_id uuid, p_deduplication_key text, p_occurred_at timestamptz default now(),
  p_actor_user_id uuid default null, p_payload jsonb default '{}', p_correlation_id uuid default null,
  p_causation_event_id uuid default null, p_event_id uuid default null)
returns uuid language plpgsql set search_path = '' as $$
declare v uuid;
begin
  insert into public.domain_events(studio_id, event_type, source_entity_type, source_entity_id, deduplication_key, payload, occurred_at, actor_user_id)
  values (p_studio_id, p_event_type, p_source_entity_type, p_source_entity_id, p_deduplication_key, p_payload, p_occurred_at, p_actor_user_id)
  on conflict (studio_id, deduplication_key) do nothing returning event_id into v;
  return v;
end $$;
create function private.notification_try_emit_domain_event(p_studio_id uuid, p_event_type text, p_source_entity_type text,
  p_source_entity_id uuid, p_deduplication_key text, p_payload jsonb default '{}', p_actor_user_id uuid default null,
  p_occurred_at timestamptz default clock_timestamp())
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return public.emit_domain_event(p_studio_id => p_studio_id, p_event_type => p_event_type,
    p_source_entity_type => p_source_entity_type, p_source_entity_id => p_source_entity_id,
    p_deduplication_key => p_deduplication_key, p_occurred_at => p_occurred_at,
    p_actor_user_id => p_actor_user_id, p_payload => coalesce(p_payload, '{}'::jsonb));
end $$;

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, rule_key text not null, event_type text not null,
  enabled boolean not null default false, current_version_number integer not null default 1, archived_at timestamptz,
  updated_at timestamptz not null default now(), unique (studio_id, rule_key));
create table public.notification_rule_versions (
  studio_id uuid not null, rule_id uuid not null, version_number integer not null, notification_type text not null,
  communication_class text not null default 'P0', priority text not null, recipient_strategy_key text not null,
  conditions jsonb not null default '{}', timing_strategy_key text not null, timing_config jsonb not null default '{}',
  revalidation_strategy_key text, template_key text not null, expires_after_seconds integer, activated_at timestamptz,
  primary key (rule_id, version_number));
create table public.notification_rule_channels (
  studio_id uuid not null, rule_id uuid not null, version_number integer not null, channel_key text not null,
  is_required boolean not null default true, ordinal integer not null default 1, channel_policy jsonb not null default '{}');

-- Shape of the real template allowlist before CUMP-01 (only the allowlist text matters here).
create function public.admin_update_meta_whatsapp_templates(target_studio_id uuid, target_language_code text,
  target_country_calling_code text, target_templates jsonb)
returns boolean language plpgsql security definer set search_path to '' as $function$
begin
  if exists (select 1 from jsonb_each_text(target_templates) as template_entry
    where template_entry.key not in ('student_welcome','reservation_confirmed')) then
    raise exception 'meta_templates_invalid';
  end if;
  return true;
end;
$function$;
