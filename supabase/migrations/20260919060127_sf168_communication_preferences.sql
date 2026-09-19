create type public.communication_preference_origin as enum (
  'admin',
  'student',
  'system',
  'integration'
);

create table public.person_communication_preferences (
  studio_id uuid not null,
  person_id uuid not null,
  operational_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  retention_enabled boolean not null default true,
  promotions_enabled boolean not null default true,
  whatsapp_blocked boolean not null default false,
  updated_origin public.communication_preference_origin not null default 'system',
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (studio_id, person_id),
  constraint person_communication_preferences_person_tenant_fkey
    foreign key (studio_id, person_id)
    references public.persons(studio_id, id)
    on delete cascade
);

comment on table public.person_communication_preferences is
  'SF-168 current communication preferences per person. Absence of a row means all categories enabled and WhatsApp not blocked.';

create table public.person_communication_preference_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  person_id uuid not null,
  origin public.communication_preference_origin not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  previous_preferences jsonb not null check (jsonb_typeof(previous_preferences) = 'object'),
  new_preferences jsonb not null check (jsonb_typeof(new_preferences) = 'object'),
  changed_fields text[] not null check (cardinality(changed_fields) > 0),
  reason text,
  created_at timestamptz not null default now(),
  constraint person_communication_preference_events_person_tenant_fkey
    foreign key (studio_id, person_id)
    references public.persons(studio_id, id)
    on delete restrict,
  constraint person_communication_preference_events_reason_chk
    check (reason is null or length(reason) <= 1000)
);

comment on table public.person_communication_preference_events is
  'SF-168 append-only audit history for person communication preference changes.';

create index person_communication_preference_events_person_idx
  on public.person_communication_preference_events(studio_id, person_id, created_at desc);

alter table public.person_communication_preferences enable row level security;
alter table public.person_communication_preference_events enable row level security;

create policy person_communication_preferences_read
on public.person_communication_preferences
for select
to authenticated
using (
  private.has_capability(studio_id, 'students.read')
  or private.has_capability(studio_id, 'automations.read')
);

create policy person_communication_preference_events_read
on public.person_communication_preference_events
for select
to authenticated
using (
  private.has_capability(studio_id, 'students.read')
  or private.has_capability(studio_id, 'automations.read')
);

revoke all on table public.person_communication_preferences
  from anon, authenticated, service_role;
revoke all on table public.person_communication_preference_events
  from anon, authenticated, service_role;

grant select on table public.person_communication_preferences
  to authenticated, service_role;
grant select on table public.person_communication_preference_events
  to authenticated, service_role;

create or replace function private.reject_person_communication_preference_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'communication_preference_history_immutable';
end;
$$;

revoke all on function private.reject_person_communication_preference_event_mutation()
from public, anon, authenticated, service_role;

create trigger person_communication_preference_events_immutable
before update or delete on public.person_communication_preference_events
for each row
execute function private.reject_person_communication_preference_event_mutation();

create or replace function private.set_person_communication_preferences_internal(
  p_studio_id uuid,
  p_person_id uuid,
  p_operational_enabled boolean,
  p_reminders_enabled boolean,
  p_retention_enabled boolean,
  p_promotions_enabled boolean,
  p_whatsapp_blocked boolean,
  p_origin public.communication_preference_origin,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.person_communication_preferences%rowtype;
  v_person_exists boolean;
  v_previous jsonb;
  v_next jsonb;
  v_changed_fields text[];
  v_now timestamptz := clock_timestamp();
begin
  if p_studio_id is null or p_person_id is null then
    raise exception 'communication_preference_person_required';
  end if;

  if p_operational_enabled is null
     or p_reminders_enabled is null
     or p_retention_enabled is null
     or p_promotions_enabled is null
     or p_whatsapp_blocked is null
     or p_origin is null then
    raise exception 'communication_preference_values_required';
  end if;

  if p_reason is not null and length(trim(p_reason)) > 1000 then
    raise exception 'communication_preference_reason_too_long';
  end if;

  select exists (
    select 1
    from public.persons p
    where p.id = p_person_id
      and p.studio_id = p_studio_id
  )
  into v_person_exists;

  if not v_person_exists then
    raise exception 'communication_preference_person_not_found';
  end if;

  select *
  into v_current
  from public.person_communication_preferences
  where studio_id = p_studio_id
    and person_id = p_person_id
  for update;

  v_previous := jsonb_build_object(
    'operational', coalesce(v_current.operational_enabled, true),
    'reminders', coalesce(v_current.reminders_enabled, true),
    'retention', coalesce(v_current.retention_enabled, true),
    'promotions', coalesce(v_current.promotions_enabled, true),
    'whatsapp_blocked', coalesce(v_current.whatsapp_blocked, false)
  );

  v_next := jsonb_build_object(
    'operational', p_operational_enabled,
    'reminders', p_reminders_enabled,
    'retention', p_retention_enabled,
    'promotions', p_promotions_enabled,
    'whatsapp_blocked', p_whatsapp_blocked
  );

  v_changed_fields := array_remove(array[
    case when (v_previous->>'operational')::boolean is distinct from p_operational_enabled then 'operational' end,
    case when (v_previous->>'reminders')::boolean is distinct from p_reminders_enabled then 'reminders' end,
    case when (v_previous->>'retention')::boolean is distinct from p_retention_enabled then 'retention' end,
    case when (v_previous->>'promotions')::boolean is distinct from p_promotions_enabled then 'promotions' end,
    case when (v_previous->>'whatsapp_blocked')::boolean is distinct from p_whatsapp_blocked then 'whatsapp_blocked' end
  ]::text[], null);

  if cardinality(v_changed_fields) = 0 then
    return jsonb_build_object(
      'changed', false,
      'preferences', v_next,
      'changed_fields', '[]'::jsonb
    );
  end if;

  insert into public.person_communication_preferences (
    studio_id,
    person_id,
    operational_enabled,
    reminders_enabled,
    retention_enabled,
    promotions_enabled,
    whatsapp_blocked,
    updated_origin,
    updated_by_user_id,
    updated_at
  ) values (
    p_studio_id,
    p_person_id,
    p_operational_enabled,
    p_reminders_enabled,
    p_retention_enabled,
    p_promotions_enabled,
    p_whatsapp_blocked,
    p_origin,
    p_actor_user_id,
    v_now
  )
  on conflict (studio_id, person_id)
  do update set
    operational_enabled = excluded.operational_enabled,
    reminders_enabled = excluded.reminders_enabled,
    retention_enabled = excluded.retention_enabled,
    promotions_enabled = excluded.promotions_enabled,
    whatsapp_blocked = excluded.whatsapp_blocked,
    updated_origin = excluded.updated_origin,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = excluded.updated_at;

  insert into public.person_communication_preference_events (
    studio_id,
    person_id,
    origin,
    actor_user_id,
    previous_preferences,
    new_preferences,
    changed_fields,
    reason,
    created_at
  ) values (
    p_studio_id,
    p_person_id,
    p_origin,
    p_actor_user_id,
    v_previous,
    v_next,
    v_changed_fields,
    nullif(trim(coalesce(p_reason, '')), ''),
    v_now
  );

  return jsonb_build_object(
    'changed', true,
    'preferences', v_next,
    'changed_fields', to_jsonb(v_changed_fields)
  );
end;
$$;

revoke all on function private.set_person_communication_preferences_internal(
  uuid,uuid,boolean,boolean,boolean,boolean,boolean,
  public.communication_preference_origin,uuid,text
) from public, anon, authenticated, service_role;

create or replace function public.admin_set_student_communication_preferences(
  p_student_id uuid,
  p_operational_enabled boolean,
  p_reminders_enabled boolean,
  p_retention_enabled boolean,
  p_promotions_enabled boolean,
  p_whatsapp_blocked boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'communication_preference_admin_auth_required';
  end if;

  select *
  into v_student
  from public.students
  where id = p_student_id
    and lifecycle_status <> 'archived';

  if not found or v_student.person_id is null then
    raise exception 'communication_preference_student_not_found';
  end if;

  if not private.has_capability(v_student.studio_id, 'students.write') then
    raise exception 'communication_preference_manage_denied';
  end if;

  return private.set_person_communication_preferences_internal(
    v_student.studio_id,
    v_student.person_id,
    p_operational_enabled,
    p_reminders_enabled,
    p_retention_enabled,
    p_promotions_enabled,
    p_whatsapp_blocked,
    'admin'::public.communication_preference_origin,
    v_actor,
    p_reason
  );
end;
$$;

revoke all on function public.admin_set_student_communication_preferences(
  uuid,boolean,boolean,boolean,boolean,boolean,text
) from public, anon, service_role;
grant execute on function public.admin_set_student_communication_preferences(
  uuid,boolean,boolean,boolean,boolean,boolean,text
) to authenticated;

create or replace function public.system_set_person_communication_preferences(
  p_studio_id uuid,
  p_person_id uuid,
  p_operational_enabled boolean,
  p_reminders_enabled boolean,
  p_retention_enabled boolean,
  p_promotions_enabled boolean,
  p_whatsapp_blocked boolean,
  p_origin public.communication_preference_origin default 'integration',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_origin not in (
    'system'::public.communication_preference_origin,
    'integration'::public.communication_preference_origin
  ) then
    raise exception 'communication_preference_system_origin_invalid';
  end if;

  return private.set_person_communication_preferences_internal(
    p_studio_id,
    p_person_id,
    p_operational_enabled,
    p_reminders_enabled,
    p_retention_enabled,
    p_promotions_enabled,
    p_whatsapp_blocked,
    p_origin,
    null,
    p_reason
  );
end;
$$;

revoke all on function public.system_set_person_communication_preferences(
  uuid,uuid,boolean,boolean,boolean,boolean,boolean,
  public.communication_preference_origin,text
) from public, anon, authenticated;
grant execute on function public.system_set_person_communication_preferences(
  uuid,uuid,boolean,boolean,boolean,boolean,boolean,
  public.communication_preference_origin,text
) to service_role;

create or replace function public.system_get_person_communication_preferences(
  p_studio_id uuid,
  p_person_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preferences public.person_communication_preferences%rowtype;
begin
  if not exists (
    select 1
    from public.persons p
    where p.id = p_person_id
      and p.studio_id = p_studio_id
  ) then
    raise exception 'communication_preference_person_not_found';
  end if;

  select *
  into v_preferences
  from public.person_communication_preferences
  where studio_id = p_studio_id
    and person_id = p_person_id;

  return jsonb_build_object(
    'operational', coalesce(v_preferences.operational_enabled, true),
    'reminders', coalesce(v_preferences.reminders_enabled, true),
    'retention', coalesce(v_preferences.retention_enabled, true),
    'promotions', coalesce(v_preferences.promotions_enabled, true),
    'whatsapp_blocked', coalesce(v_preferences.whatsapp_blocked, false),
    'source', case when v_preferences.person_id is null then 'defaults' else 'person' end,
    'updated_origin', v_preferences.updated_origin,
    'updated_at', v_preferences.updated_at
  );
end;
$$;

revoke all on function public.system_get_person_communication_preferences(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.system_get_person_communication_preferences(uuid,uuid)
to service_role;
