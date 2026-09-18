create type public.required_action_status as enum (
  'pending',
  'in_progress',
  'resolved',
  'discarded'
);

create type public.required_action_priority as enum (
  'high',
  'medium',
  'low'
);

insert into public.capabilities(key, description) values
  ('required_actions.read', 'Consultar acciones requeridas del estudio'),
  ('required_actions.manage', 'Crear, asignar, tomar, resolver y descartar acciones requeridas')
on conflict (key) do update set description = excluded.description;

insert into public.role_capabilities(role, capability_key) values
  ('owner', 'required_actions.read'),
  ('owner', 'required_actions.manage'),
  ('admin', 'required_actions.read'),
  ('admin', 'required_actions.manage')
on conflict do nothing;

create table public.required_actions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  incident_key text not null check (length(trim(incident_key)) > 0),
  priority public.required_action_priority not null,
  status public.required_action_status not null default 'pending',
  source_event_id uuid not null,
  student_id uuid references public.students(id) on delete set null,
  class_session_id uuid references public.class_sessions(id) on delete set null,
  assignee_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (length(trim(reason)) > 0),
  result text,
  discard_reason text,
  auto_closed boolean not null default false,
  created_by_user_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  started_at timestamptz,
  resolved_at timestamptz,
  discarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint required_actions_studio_id_unique unique (studio_id, id),
  constraint required_actions_source_event_tenant_fkey
    foreign key (studio_id, source_event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict,
  constraint required_actions_discard_reason_chk check (
    status <> 'discarded'
    or (discard_reason is not null and length(trim(discard_reason)) > 0)
  ),
  constraint required_actions_resolved_at_chk check (
    status <> 'resolved' or resolved_at is not null
  ),
  constraint required_actions_discarded_at_chk check (
    status <> 'discarded' or discarded_at is not null
  ),
  constraint required_actions_started_at_chk check (
    status <> 'in_progress' or started_at is not null
  )
);

create unique index required_actions_open_incident_unique
  on public.required_actions(studio_id, incident_key)
  where status in ('pending', 'in_progress');

create index required_actions_studio_status_priority_idx
  on public.required_actions(studio_id, status, priority, created_at desc);
create index required_actions_assignee_open_idx
  on public.required_actions(studio_id, assignee_user_id, status)
  where assignee_user_id is not null and status in ('pending', 'in_progress');
create index required_actions_student_idx
  on public.required_actions(studio_id, student_id, created_at desc)
  where student_id is not null;
create index required_actions_class_session_idx
  on public.required_actions(studio_id, class_session_id, created_at desc)
  where class_session_id is not null;
create index required_actions_source_event_idx
  on public.required_actions(studio_id, source_event_id);

create table public.required_action_audit (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  required_action_id uuid not null,
  operation text not null check (
    operation in ('created','assigned','taken','resolved','discarded','auto_closed')
  ),
  from_status public.required_action_status,
  to_status public.required_action_status not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  assignee_user_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint required_action_audit_action_tenant_fkey
    foreign key (studio_id, required_action_id)
    references public.required_actions(studio_id, id)
    on delete restrict
);

create index required_action_audit_action_created_idx
  on public.required_action_audit(studio_id, required_action_id, created_at);
create index required_action_audit_actor_idx
  on public.required_action_audit(actor_user_id)
  where actor_user_id is not null;
create index required_action_audit_assignee_idx
  on public.required_action_audit(assignee_user_id)
  where assignee_user_id is not null;

alter table public.required_actions enable row level security;
alter table public.required_action_audit enable row level security;

create policy required_actions_read
on public.required_actions
for select
to authenticated
using (private.has_capability(studio_id, 'required_actions.read'));

create policy required_action_audit_read
on public.required_action_audit
for select
to authenticated
using (private.has_capability(studio_id, 'required_actions.read'));

revoke all on table public.required_actions from anon, authenticated;
revoke all on table public.required_action_audit from anon, authenticated;
grant select on table public.required_actions to authenticated;
grant select on table public.required_action_audit to authenticated;
grant select, insert, update on table public.required_actions to service_role;
grant select, insert on table public.required_action_audit to service_role;

create or replace function private.reject_required_action_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'required_action_audit_immutable';
end;
$$;

revoke all on function private.reject_required_action_audit_mutation() from public, anon, authenticated;

create trigger required_action_audit_immutable
before update or delete on public.required_action_audit
for each row execute function private.reject_required_action_audit_mutation();

create or replace function private.required_action_assert_scope(
  p_studio_id uuid,
  p_student_id uuid,
  p_class_session_id uuid,
  p_assignee_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_student_id is not null and not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.studio_id = p_studio_id
  ) then
    raise exception 'required_action_student_scope_mismatch';
  end if;

  if p_class_session_id is not null and not exists (
    select 1
    from public.class_sessions cs
    where cs.id = p_class_session_id
      and cs.studio_id = p_studio_id
  ) then
    raise exception 'required_action_class_scope_mismatch';
  end if;

  if p_assignee_user_id is not null and not exists (
    select 1
    from public.studio_memberships sm
    join public.role_capabilities rc
      on rc.role = sm.role
     and rc.capability_key = 'required_actions.read'
    where sm.studio_id = p_studio_id
      and sm.user_id = p_assignee_user_id
      and sm.active = true
  ) then
    raise exception 'required_action_assignee_not_eligible';
  end if;
end;
$$;

revoke all on function private.required_action_assert_scope(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;

create or replace function private.create_required_action_internal(
  p_studio_id uuid,
  p_incident_key text,
  p_priority public.required_action_priority,
  p_source_event_id uuid,
  p_reason text,
  p_student_id uuid default null,
  p_class_session_id uuid default null,
  p_assignee_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_id uuid;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is not null
     and not private.has_capability(p_studio_id, 'required_actions.manage') then
    raise exception 'required_actions_manage_denied';
  end if;

  if trim(coalesce(p_incident_key, '')) = '' then
    raise exception 'required_action_incident_key_required';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'required_action_reason_required';
  end if;
  if p_source_event_id is null then
    raise exception 'required_action_source_event_required';
  end if;

  perform private.required_action_assert_scope(
    p_studio_id,
    p_student_id,
    p_class_session_id,
    p_assignee_user_id
  );

  insert into public.required_actions (
    studio_id,
    incident_key,
    priority,
    source_event_id,
    student_id,
    class_session_id,
    assignee_user_id,
    reason,
    created_by_user_id,
    assigned_at
  ) values (
    p_studio_id,
    trim(p_incident_key),
    p_priority,
    p_source_event_id,
    p_student_id,
    p_class_session_id,
    p_assignee_user_id,
    trim(p_reason),
    v_actor,
    case when p_assignee_user_id is not null then now() else null end
  )
  on conflict (studio_id, incident_key)
    where status in ('pending','in_progress')
  do nothing
  returning id into v_action_id;

  if v_action_id is null then
    select ra.id into v_action_id
    from public.required_actions ra
    where ra.studio_id = p_studio_id
      and ra.incident_key = trim(p_incident_key)
      and ra.status in ('pending','in_progress');
    return v_action_id;
  end if;

  insert into public.required_action_audit (
    studio_id,
    required_action_id,
    operation,
    from_status,
    to_status,
    actor_user_id,
    assignee_user_id,
    note
  ) values (
    p_studio_id,
    v_action_id,
    'created',
    null,
    'pending',
    v_actor,
    p_assignee_user_id,
    trim(p_reason)
  );

  return v_action_id;
end;
$$;

revoke all on function private.create_required_action_internal(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
) from public, anon;
grant execute on function private.create_required_action_internal(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
) to authenticated;

create or replace function private.transition_required_action_internal(
  p_action_id uuid,
  p_operation text,
  p_assignee_user_id uuid default null,
  p_result text default null,
  p_discard_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.required_actions%rowtype;
  v_actor uuid := (select auth.uid());
  v_to_status public.required_action_status;
  v_effective_assignee uuid;
  v_note text;
begin
  select * into v_action
  from public.required_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'required_action_not_found';
  end if;

  if v_actor is not null
     and not private.has_capability(v_action.studio_id, 'required_actions.manage') then
    raise exception 'required_actions_manage_denied';
  end if;

  if v_action.status not in ('pending','in_progress') then
    raise exception 'required_action_not_open';
  end if;

  case p_operation
    when 'assigned' then
      if p_assignee_user_id is null then
        raise exception 'required_action_assignee_required';
      end if;
      perform private.required_action_assert_scope(
        v_action.studio_id,
        v_action.student_id,
        v_action.class_session_id,
        p_assignee_user_id
      );
      v_to_status := v_action.status;
      v_effective_assignee := p_assignee_user_id;
      v_note := null;

      update public.required_actions
      set assignee_user_id = p_assignee_user_id,
          assigned_at = now(),
          updated_at = now()
      where id = p_action_id;

    when 'taken' then
      if v_actor is null then
        raise exception 'required_action_take_requires_actor';
      end if;
      perform private.required_action_assert_scope(
        v_action.studio_id,
        v_action.student_id,
        v_action.class_session_id,
        v_actor
      );
      v_to_status := 'in_progress';
      v_effective_assignee := v_actor;
      v_note := null;

      update public.required_actions
      set status = 'in_progress',
          assignee_user_id = v_actor,
          assigned_at = coalesce(assigned_at, now()),
          started_at = coalesce(started_at, now()),
          updated_at = now()
      where id = p_action_id;

    when 'resolved' then
      v_to_status := 'resolved';
      v_effective_assignee := v_action.assignee_user_id;
      v_note := nullif(trim(coalesce(p_result, '')), '');

      update public.required_actions
      set status = 'resolved',
          result = nullif(trim(coalesce(p_result, '')), ''),
          resolved_at = now(),
          auto_closed = false,
          updated_at = now()
      where id = p_action_id;

    when 'discarded' then
      if trim(coalesce(p_discard_reason, '')) = '' then
        raise exception 'required_action_discard_reason_required';
      end if;
      v_to_status := 'discarded';
      v_effective_assignee := v_action.assignee_user_id;
      v_note := trim(p_discard_reason);

      update public.required_actions
      set status = 'discarded',
          discard_reason = trim(p_discard_reason),
          discarded_at = now(),
          auto_closed = false,
          updated_at = now()
      where id = p_action_id;

    when 'auto_closed' then
      v_to_status := 'resolved';
      v_effective_assignee := v_action.assignee_user_id;
      v_note := nullif(trim(coalesce(p_result, '')), '');

      update public.required_actions
      set status = 'resolved',
          result = nullif(trim(coalesce(p_result, '')), ''),
          resolved_at = now(),
          auto_closed = true,
          updated_at = now()
      where id = p_action_id;

    else
      raise exception 'required_action_operation_invalid';
  end case;

  insert into public.required_action_audit (
    studio_id,
    required_action_id,
    operation,
    from_status,
    to_status,
    actor_user_id,
    assignee_user_id,
    note
  ) values (
    v_action.studio_id,
    p_action_id,
    p_operation,
    v_action.status,
    v_to_status,
    v_actor,
    v_effective_assignee,
    v_note
  );
end;
$$;

revoke all on function private.transition_required_action_internal(
  uuid,text,uuid,text,text
) from public, anon;
grant execute on function private.transition_required_action_internal(
  uuid,text,uuid,text,text
) to authenticated;

create or replace function public.admin_create_required_action(
  p_studio_id uuid,
  p_incident_key text,
  p_priority public.required_action_priority,
  p_source_event_id uuid,
  p_reason text,
  p_student_id uuid default null,
  p_class_session_id uuid default null,
  p_assignee_user_id uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_required_action_internal(
    p_studio_id,
    p_incident_key,
    p_priority,
    p_source_event_id,
    p_reason,
    p_student_id,
    p_class_session_id,
    p_assignee_user_id
  );
$$;

revoke all on function public.admin_create_required_action(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
) from public, anon;
grant execute on function public.admin_create_required_action(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
) to authenticated;

create or replace function public.system_create_required_action(
  p_studio_id uuid,
  p_incident_key text,
  p_priority public.required_action_priority,
  p_source_event_id uuid,
  p_reason text,
  p_student_id uuid default null,
  p_class_session_id uuid default null,
  p_assignee_user_id uuid default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.create_required_action_internal(
    p_studio_id,
    p_incident_key,
    p_priority,
    p_source_event_id,
    p_reason,
    p_student_id,
    p_class_session_id,
    p_assignee_user_id
  );
$$;

revoke all on function public.system_create_required_action(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
) from public, anon, authenticated;
grant execute on function public.system_create_required_action(
  uuid,text,public.required_action_priority,uuid,text,uuid,uuid,uuid
) to service_role;

create or replace function public.admin_assign_required_action(
  p_action_id uuid,
  p_assignee_user_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_required_action_internal(
    p_action_id, 'assigned', p_assignee_user_id, null, null
  );
$$;

create or replace function public.admin_take_required_action(
  p_action_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_required_action_internal(
    p_action_id, 'taken', null, null, null
  );
$$;

create or replace function public.admin_resolve_required_action(
  p_action_id uuid,
  p_result text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_required_action_internal(
    p_action_id, 'resolved', null, p_result, null
  );
$$;

create or replace function public.admin_discard_required_action(
  p_action_id uuid,
  p_reason text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_required_action_internal(
    p_action_id, 'discarded', null, null, p_reason
  );
$$;

revoke all on function public.admin_assign_required_action(uuid,uuid) from public, anon;
revoke all on function public.admin_take_required_action(uuid) from public, anon;
revoke all on function public.admin_resolve_required_action(uuid,text) from public, anon;
revoke all on function public.admin_discard_required_action(uuid,text) from public, anon;
grant execute on function public.admin_assign_required_action(uuid,uuid) to authenticated;
grant execute on function public.admin_take_required_action(uuid) to authenticated;
grant execute on function public.admin_resolve_required_action(uuid,text) to authenticated;
grant execute on function public.admin_discard_required_action(uuid,text) to authenticated;

create or replace function public.system_auto_close_required_action(
  p_studio_id uuid,
  p_incident_key text,
  p_result text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_id uuid;
begin
  select ra.id into v_action_id
  from public.required_actions ra
  where ra.studio_id = p_studio_id
    and ra.incident_key = trim(p_incident_key)
    and ra.status in ('pending','in_progress')
  for update;

  if v_action_id is null then
    return null;
  end if;

  perform private.transition_required_action_internal(
    v_action_id,
    'auto_closed',
    null,
    p_result,
    null
  );

  return v_action_id;
end;
$$;

revoke all on function public.system_auto_close_required_action(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.system_auto_close_required_action(uuid,text,text)
  to service_role;
