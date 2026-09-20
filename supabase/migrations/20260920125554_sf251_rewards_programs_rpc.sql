
create or replace function private.reward_program_normalize_audience(
  p_value jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb;
  v_scope text;
  v_eligibility text;
begin
  v_value :=
    jsonb_build_object(
      'scope', 'all_active_students',
      'eligibility_mode', 'continuous'
    )
    || coalesce(p_value, '{}'::jsonb);

  if jsonb_typeof(v_value) <> 'object' then
    raise exception 'reward_program_audience_must_be_object';
  end if;

  v_scope := coalesce(v_value->>'scope', 'all_active_students');
  v_eligibility := coalesce(v_value->>'eligibility_mode', 'continuous');

  if v_scope not in ('all_students', 'all_active_students') then
    raise exception 'reward_program_audience_scope_invalid';
  end if;

  if v_eligibility not in ('continuous', 'lock_on_join') then
    raise exception 'reward_program_eligibility_mode_invalid';
  end if;

  return v_value
    || jsonb_build_object(
      'scope', v_scope,
      'eligibility_mode', v_eligibility
    );
end;
$$;

create or replace function private.reward_program_student_eligible(
  p_program_id uuid,
  p_version_number integer,
  p_student_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_version public.reward_program_versions%rowtype;
  v_student public.students%rowtype;
  v_scope text;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id;

  if not found then
    return false;
  end if;

  select * into v_version
  from public.reward_program_versions
  where program_id = p_program_id
    and version_number = p_version_number;

  if not found or v_version.studio_id <> v_program.studio_id then
    return false;
  end if;

  select * into v_student
  from public.students
  where id = p_student_id
    and studio_id = v_program.studio_id;

  if not found then
    return false;
  end if;

  v_scope := coalesce(v_version.audience_definition->>'scope', 'all_active_students');

  if v_scope = 'all_students' then
    return true;
  end if;

  return v_student.active = true
    and v_student.lifecycle_status = 'active';
end;
$$;

revoke all on function private.reward_program_normalize_audience(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.reward_program_student_eligible(uuid,integer,uuid)
from public, anon, authenticated;

grant execute on function private.reward_program_student_eligible(uuid,integer,uuid)
to service_role;

create or replace function private.admin_create_reward_program_internal(
  p_studio_id uuid,
  p_name text,
  p_description text,
  p_progression_mode text,
  p_audience_definition jsonb default null,
  p_presentation_definition jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program_id uuid;
  v_mode public.reward_program_progression_mode;
  v_audience jsonb;
  v_presentation jsonb;
begin
  if not private.has_capability(p_studio_id, 'rewards.manage') then
    raise exception 'reward_program_manage_forbidden';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'reward_program_name_required';
  end if;

  begin
    v_mode := p_progression_mode::public.reward_program_progression_mode;
  exception when invalid_text_representation then
    raise exception 'reward_program_progression_mode_invalid';
  end;

  v_audience := private.reward_program_normalize_audience(p_audience_definition);
  v_presentation := coalesce(p_presentation_definition, '{}'::jsonb);

  if jsonb_typeof(v_presentation) <> 'object' then
    raise exception 'reward_program_presentation_must_be_object';
  end if;

  insert into public.reward_programs (
    studio_id,
    status,
    latest_version_number,
    created_by_user_id,
    updated_by_user_id
  ) values (
    p_studio_id,
    'draft',
    1,
    auth.uid(),
    auth.uid()
  )
  returning id into v_program_id;

  insert into public.reward_program_versions (
    studio_id,
    program_id,
    version_number,
    name,
    description,
    progression_mode,
    audience_definition,
    presentation_definition,
    created_by_user_id
  ) values (
    p_studio_id,
    v_program_id,
    1,
    trim(p_name),
    nullif(trim(coalesce(p_description, '')), ''),
    v_mode,
    v_audience,
    v_presentation,
    auth.uid()
  );

  insert into public.reward_program_lifecycle (
    studio_id,
    program_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    p_studio_id,
    v_program_id,
    'created',
    null,
    'draft',
    1,
    auth.uid(),
    'program_created'
  );

  return v_program_id;
end;
$$;

create or replace function private.admin_create_reward_program_version_internal(
  p_program_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_source public.reward_program_versions%rowtype;
  v_next integer;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'reward_program_not_found';
  end if;

  if not private.has_capability(v_program.studio_id, 'rewards.manage') then
    raise exception 'reward_program_manage_forbidden';
  end if;

  if v_program.status = 'archived' then
    raise exception 'reward_program_archived';
  end if;

  if v_program.published_version_number is null then
    raise exception 'reward_program_initial_draft_already_exists';
  end if;

  if v_program.latest_version_number <> v_program.published_version_number then
    raise exception 'reward_program_draft_version_already_exists';
  end if;

  select * into v_source
  from public.reward_program_versions
  where program_id = p_program_id
    and version_number = v_program.published_version_number;

  if not found then
    raise exception 'reward_program_published_version_not_found';
  end if;

  v_next := v_program.latest_version_number + 1;

  insert into public.reward_program_versions (
    studio_id,
    program_id,
    version_number,
    name,
    description,
    progression_mode,
    audience_definition,
    presentation_definition,
    created_by_user_id
  ) values (
    v_program.studio_id,
    v_program.id,
    v_next,
    v_source.name,
    v_source.description,
    v_source.progression_mode,
    v_source.audience_definition,
    v_source.presentation_definition,
    auth.uid()
  );

  insert into public.reward_program_levels (
    studio_id,
    program_id,
    program_version_number,
    level_key,
    level_order,
    title,
    description,
    rule_id,
    rule_version_number,
    level_visibility,
    reward_visibility,
    presentation_definition
  )
  select
    studio_id,
    program_id,
    v_next,
    level_key,
    level_order,
    title,
    description,
    rule_id,
    rule_version_number,
    level_visibility,
    reward_visibility,
    presentation_definition
  from public.reward_program_levels
  where program_id = v_program.id
    and program_version_number = v_program.published_version_number
  order by level_order;

  update public.reward_programs
  set latest_version_number = v_next,
      updated_by_user_id = auth.uid(),
      updated_at = now()
  where id = v_program.id;

  insert into public.reward_program_lifecycle (
    studio_id,
    program_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_program.studio_id,
    v_program.id,
    'version_created',
    v_program.status,
    v_program.status,
    v_next,
    auth.uid(),
    'draft_version_created'
  );

  return v_next;
end;
$$;

create or replace function private.admin_update_reward_program_draft_internal(
  p_program_id uuid,
  p_name text,
  p_description text,
  p_progression_mode text,
  p_audience_definition jsonb default null,
  p_presentation_definition jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_mode public.reward_program_progression_mode;
  v_audience jsonb;
  v_presentation jsonb;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'reward_program_not_found';
  end if;

  if not private.has_capability(v_program.studio_id, 'rewards.manage') then
    raise exception 'reward_program_manage_forbidden';
  end if;

  if v_program.status = 'archived' then
    raise exception 'reward_program_archived';
  end if;

  if v_program.published_version_number = v_program.latest_version_number then
    raise exception 'reward_program_no_editable_draft';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'reward_program_name_required';
  end if;

  begin
    v_mode := p_progression_mode::public.reward_program_progression_mode;
  exception when invalid_text_representation then
    raise exception 'reward_program_progression_mode_invalid';
  end;

  v_audience := private.reward_program_normalize_audience(p_audience_definition);
  v_presentation := coalesce(p_presentation_definition, '{}'::jsonb);

  if jsonb_typeof(v_presentation) <> 'object' then
    raise exception 'reward_program_presentation_must_be_object';
  end if;

  update public.reward_program_versions
  set name = trim(p_name),
      description = nullif(trim(coalesce(p_description, '')), ''),
      progression_mode = v_mode,
      audience_definition = v_audience,
      presentation_definition = v_presentation
  where program_id = v_program.id
    and version_number = v_program.latest_version_number;

  update public.reward_programs
  set updated_by_user_id = auth.uid(),
      updated_at = now()
  where id = v_program.id;

  return v_program.latest_version_number;
end;
$$;

create or replace function private.admin_replace_reward_program_levels_internal(
  p_program_id uuid,
  p_levels jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_item jsonb;
  v_rule_id uuid;
  v_rule_version integer;
  v_level_key text;
  v_level_order integer;
  v_title text;
  v_level_visibility public.reward_program_level_visibility;
  v_reward_visibility public.reward_program_reward_visibility;
  v_presentation jsonb;
  v_count integer := 0;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'reward_program_not_found';
  end if;

  if not private.has_capability(v_program.studio_id, 'rewards.manage') then
    raise exception 'reward_program_manage_forbidden';
  end if;

  if v_program.status = 'archived' then
    raise exception 'reward_program_archived';
  end if;

  if v_program.published_version_number = v_program.latest_version_number then
    raise exception 'reward_program_no_editable_draft';
  end if;

  if p_levels is null or jsonb_typeof(p_levels) <> 'array' then
    raise exception 'reward_program_levels_must_be_array';
  end if;

  delete from public.reward_program_levels
  where program_id = v_program.id
    and program_version_number = v_program.latest_version_number;

  for v_item in
    select value
    from jsonb_array_elements(p_levels)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'reward_program_level_must_be_object';
    end if;

    v_level_key := trim(coalesce(v_item->>'key', ''));
    v_title := trim(coalesce(v_item->>'title', ''));

    begin
      v_level_order := (v_item->>'order')::integer;
      v_rule_id := (v_item->>'rule_id')::uuid;
      v_rule_version := (v_item->>'rule_version_number')::integer;
      v_level_visibility :=
        coalesce(v_item->>'level_visibility', 'visible')
        ::public.reward_program_level_visibility;
      v_reward_visibility :=
        coalesce(v_item->>'reward_visibility', 'visible')
        ::public.reward_program_reward_visibility;
    exception when others then
      raise exception 'reward_program_level_definition_invalid';
    end;

    if v_level_key = '' or v_title = '' or v_level_order < 1 or v_rule_version < 1 then
      raise exception 'reward_program_level_definition_invalid';
    end if;

    if not exists (
      select 1
      from public.reward_rule_versions rv
      where rv.rule_id = v_rule_id
        and rv.version_number = v_rule_version
        and rv.studio_id = v_program.studio_id
    ) then
      raise exception 'reward_program_level_rule_version_invalid';
    end if;

    v_presentation := coalesce(v_item->'presentation_definition', '{}'::jsonb);
    if jsonb_typeof(v_presentation) <> 'object' then
      raise exception 'reward_program_level_presentation_must_be_object';
    end if;

    insert into public.reward_program_levels (
      studio_id,
      program_id,
      program_version_number,
      level_key,
      level_order,
      title,
      description,
      rule_id,
      rule_version_number,
      level_visibility,
      reward_visibility,
      presentation_definition
    ) values (
      v_program.studio_id,
      v_program.id,
      v_program.latest_version_number,
      v_level_key,
      v_level_order,
      v_title,
      nullif(trim(coalesce(v_item->>'description', '')), ''),
      v_rule_id,
      v_rule_version,
      v_level_visibility,
      v_reward_visibility,
      v_presentation
    );

    v_count := v_count + 1;
  end loop;

  update public.reward_programs
  set updated_by_user_id = auth.uid(),
      updated_at = now()
  where id = v_program.id;

  return v_count;
end;
$$;

create or replace function private.reward_program_materialize_participation_internal(
  p_program_id uuid,
  p_student_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_existing public.reward_program_participations%rowtype;
  v_first_level integer;
  v_participation_id uuid;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id;

  if not found
     or v_program.status not in ('active', 'paused')
     or v_program.published_version_number is null then
    return null;
  end if;

  select * into v_existing
  from public.reward_program_participations
  where program_id = v_program.id
    and student_id = p_student_id;

  if found then
    return v_existing.id;
  end if;

  if not private.reward_program_student_eligible(
    v_program.id,
    v_program.published_version_number,
    p_student_id
  ) then
    return null;
  end if;

  select min(level_order)
    into v_first_level
  from public.reward_program_levels
  where program_id = v_program.id
    and program_version_number = v_program.published_version_number;

  if v_first_level is null then
    return null;
  end if;

  insert into public.reward_program_participations (
    studio_id,
    program_id,
    student_id,
    program_version_number,
    status,
    current_level_order,
    joined_at
  ) values (
    v_program.studio_id,
    v_program.id,
    p_student_id,
    v_program.published_version_number,
    'active',
    v_first_level,
    now()
  )
  returning id into v_participation_id;

  insert into public.reward_program_events (
    studio_id,
    program_id,
    participation_id,
    student_id,
    program_version_number,
    event_type,
    details
  ) values (
    v_program.studio_id,
    v_program.id,
    v_participation_id,
    p_student_id,
    v_program.published_version_number,
    'joined',
    jsonb_build_object('current_level_order', v_first_level)
  );

  insert into public.reward_program_events (
    studio_id,
    program_id,
    participation_id,
    student_id,
    program_version_number,
    level_id,
    event_type,
    details
  )
  select
    v_program.studio_id,
    v_program.id,
    v_participation_id,
    p_student_id,
    v_program.published_version_number,
    l.id,
    'level_started',
    jsonb_build_object('level_key', l.level_key, 'level_order', l.level_order)
  from public.reward_program_levels l
  where l.program_id = v_program.id
    and l.program_version_number = v_program.published_version_number
    and l.level_order = v_first_level;

  return v_participation_id;
end;
$$;

create or replace function private.reward_program_reassign_participations_internal(
  p_program_id uuid,
  p_version_number integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_participation public.reward_program_participations%rowtype;
  v_next_level integer;
  v_changed integer := 0;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id;

  if not found then
    raise exception 'reward_program_not_found';
  end if;

  for v_participation in
    select *
    from public.reward_program_participations
    where program_id = v_program.id
      and status <> 'closed'
    order by joined_at, id
  loop
    select min(l.level_order)
      into v_next_level
    from public.reward_program_levels l
    where l.program_id = v_program.id
      and l.program_version_number = p_version_number
      and not exists (
        select 1
        from public.reward_program_level_unlocks u
        where u.program_id = v_program.id
          and u.student_id = v_participation.student_id
          and u.level_key_snapshot = l.level_key
      );

    update public.reward_program_participations
    set program_version_number = p_version_number,
        current_level_order = v_next_level,
        status = case
          when v_next_level is null then 'completed'::public.reward_program_participation_status
          else 'active'::public.reward_program_participation_status
        end,
        completed_at = case
          when v_next_level is null then coalesce(completed_at, now())
          else null
        end,
        updated_at = now()
    where id = v_participation.id;

    insert into public.reward_program_events (
      studio_id,
      program_id,
      participation_id,
      student_id,
      program_version_number,
      event_type,
      details
    ) values (
      v_program.studio_id,
      v_program.id,
      v_participation.id,
      v_participation.student_id,
      p_version_number,
      'version_assigned',
      jsonb_build_object(
        'previous_version_number', v_participation.program_version_number,
        'current_level_order', v_next_level
      )
    );

    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;

create or replace function private.admin_publish_reward_program_internal(
  p_program_id uuid,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_target integer;
  v_count integer;
  v_max integer;
  v_min integer;
  v_to_status public.reward_program_status;
  v_student record;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'reward_program_not_found';
  end if;

  if not private.has_capability(v_program.studio_id, 'rewards.manage') then
    raise exception 'reward_program_manage_forbidden';
  end if;

  if v_program.status = 'archived' then
    raise exception 'reward_program_archived';
  end if;

  v_target := v_program.latest_version_number;

  if v_program.published_version_number = v_target then
    raise exception 'reward_program_version_already_published';
  end if;

  select count(*), max(level_order), min(level_order)
    into v_count, v_max, v_min
  from public.reward_program_levels
  where program_id = v_program.id
    and program_version_number = v_target;

  if v_count = 0 then
    raise exception 'reward_program_requires_levels';
  end if;

  if v_min <> 1 or v_max <> v_count then
    raise exception 'reward_program_level_order_must_be_contiguous';
  end if;

  if exists (
    select 1
    from public.reward_program_levels l
    join public.reward_rule_versions rv
      on rv.rule_id = l.rule_id
     and rv.version_number = l.rule_version_number
    where l.program_id = v_program.id
      and l.program_version_number = v_target
      and rv.studio_id <> v_program.studio_id
  ) then
    raise exception 'reward_program_level_rule_studio_mismatch';
  end if;

  v_to_status := case
    when v_program.status = 'paused' then 'paused'::public.reward_program_status
    else 'active'::public.reward_program_status
  end;

  update public.reward_programs
  set published_version_number = v_target,
      status = v_to_status,
      first_published_at = coalesce(first_published_at, now()),
      last_published_at = now(),
      updated_by_user_id = auth.uid(),
      updated_at = now()
  where id = v_program.id;

  insert into public.reward_program_lifecycle (
    studio_id,
    program_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_program.studio_id,
    v_program.id,
    'published',
    v_program.status,
    v_to_status,
    v_target,
    auth.uid(),
    nullif(trim(coalesce(p_note, '')), '')
  );

  perform private.reward_program_reassign_participations_internal(
    v_program.id,
    v_target
  );

  for v_student in
    select s.id
    from public.students s
    where s.studio_id = v_program.studio_id
    order by s.created_at, s.id
  loop
    perform private.reward_program_materialize_participation_internal(
      v_program.id,
      v_student.id
    );
  end loop;

  return v_target;
end;
$$;

create or replace function private.admin_transition_reward_program_internal(
  p_program_id uuid,
  p_action text,
  p_note text default null
)
returns public.reward_program_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_to public.reward_program_status;
  v_operation text;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'reward_program_not_found';
  end if;

  if not private.has_capability(v_program.studio_id, 'rewards.manage') then
    raise exception 'reward_program_manage_forbidden';
  end if;

  if p_action = 'pause' and v_program.status = 'active' then
    v_to := 'paused';
    v_operation := 'paused';
  elsif p_action = 'resume' and v_program.status = 'paused' then
    v_to := 'active';
    v_operation := 'resumed';
  elsif p_action = 'archive' and v_program.status <> 'archived' then
    v_to := 'archived';
    v_operation := 'archived';
  else
    raise exception 'reward_program_transition_invalid:%:%', v_program.status, p_action;
  end if;

  update public.reward_programs
  set status = v_to,
      paused_at = case when v_to = 'paused' then now() else null end,
      archived_at = case when v_to = 'archived' then now() else archived_at end,
      updated_by_user_id = auth.uid(),
      updated_at = now()
  where id = v_program.id;

  insert into public.reward_program_lifecycle (
    studio_id,
    program_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_program.studio_id,
    v_program.id,
    v_operation,
    v_program.status,
    v_to,
    v_program.published_version_number,
    auth.uid(),
    nullif(trim(coalesce(p_note, '')), '')
  );

  if v_to = 'archived' then
    insert into public.reward_program_events (
      studio_id,
      program_id,
      participation_id,
      student_id,
      program_version_number,
      event_type,
      details
    )
    select
      p.studio_id,
      p.program_id,
      p.id,
      p.student_id,
      p.program_version_number,
      'closed',
      jsonb_build_object('reason', 'program_archived')
    from public.reward_program_participations p
    where p.program_id = v_program.id
      and p.status <> 'closed';

    update public.reward_program_participations
    set status = 'closed',
        closed_at = now(),
        updated_at = now()
    where program_id = v_program.id
      and status <> 'closed';
  end if;

  return v_to;
end;
$$;

create or replace function public.system_materialize_reward_program_participation(
  p_program_id uuid,
  p_student_id uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.reward_program_materialize_participation_internal(
    p_program_id,
    p_student_id
  );
$$;

create or replace function public.system_materialize_reward_program_participations(
  p_program_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.reward_programs%rowtype;
  v_student record;
  v_before integer;
  v_after integer;
begin
  select * into v_program
  from public.reward_programs
  where id = p_program_id;

  if not found then
    raise exception 'reward_program_not_found';
  end if;

  select count(*) into v_before
  from public.reward_program_participations
  where program_id = v_program.id;

  for v_student in
    select s.id
    from public.students s
    where s.studio_id = v_program.studio_id
    order by s.created_at, s.id
  loop
    perform private.reward_program_materialize_participation_internal(
      v_program.id,
      v_student.id
    );
  end loop;

  select count(*) into v_after
  from public.reward_program_participations
  where program_id = v_program.id;

  return v_after - v_before;
end;
$$;

create or replace function public.system_record_reward_program_level_completion(
  p_source_evaluation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.reward_progress_evaluations%rowtype;
  v_level record;
  v_participation public.reward_program_participations%rowtype;
  v_participation_id uuid;
  v_unlock_id uuid;
  v_next_level integer;
  v_unlocked integer := 0;
  v_completed integer := 0;
begin
  select * into v_evaluation
  from public.reward_progress_evaluations
  where id = p_source_evaluation_id;

  if not found then
    raise exception 'reward_program_source_evaluation_not_found';
  end if;

  if not v_evaluation.fulfilled then
    return jsonb_build_object('unlocked', 0, 'completed_programs', 0);
  end if;

  for v_level in
    select
      l.*,
      pv.progression_mode,
      p.status as program_status
    from public.reward_program_levels l
    join public.reward_programs p
      on p.id = l.program_id
     and p.studio_id = l.studio_id
    join public.reward_program_versions pv
      on pv.program_id = l.program_id
     and pv.version_number = l.program_version_number
    where l.studio_id = v_evaluation.studio_id
      and l.rule_id = v_evaluation.rule_id
      and l.rule_version_number = v_evaluation.version_number
      and p.published_version_number = l.program_version_number
      and p.status = 'active'
    order by l.program_id, l.level_order
  loop
    v_participation_id :=
      private.reward_program_materialize_participation_internal(
        v_level.program_id,
        v_evaluation.student_id
      );

    if v_participation_id is null then
      continue;
    end if;

    select * into v_participation
    from public.reward_program_participations
    where id = v_participation_id
    for update;

    if v_participation.status = 'closed'
       or v_participation.program_version_number <> v_level.program_version_number then
      continue;
    end if;

    if v_level.progression_mode = 'sequential'
       and v_participation.current_level_order is distinct from v_level.level_order then
      continue;
    end if;

    v_unlock_id := null;

    insert into public.reward_program_level_unlocks (
      studio_id,
      participation_id,
      program_id,
      student_id,
      program_version_number,
      level_id,
      level_key_snapshot,
      level_order_snapshot,
      title_snapshot,
      source_evaluation_id,
      idempotency_key,
      unlocked_at
    ) values (
      v_evaluation.studio_id,
      v_participation.id,
      v_level.program_id,
      v_evaluation.student_id,
      v_level.program_version_number,
      v_level.id,
      v_level.level_key,
      v_level.level_order,
      v_level.title,
      v_evaluation.id,
      'program:' || v_level.program_id::text
        || ':student:' || v_evaluation.student_id::text
        || ':level:' || v_level.level_key,
      now()
    )
    on conflict (program_id, student_id, level_key_snapshot) do nothing
    returning id into v_unlock_id;

    if v_unlock_id is null then
      continue;
    end if;

    v_unlocked := v_unlocked + 1;

    insert into public.reward_program_events (
      studio_id,
      program_id,
      participation_id,
      student_id,
      program_version_number,
      level_id,
      event_type,
      source_evaluation_id,
      details
    ) values (
      v_evaluation.studio_id,
      v_level.program_id,
      v_participation.id,
      v_evaluation.student_id,
      v_level.program_version_number,
      v_level.id,
      'level_completed',
      v_evaluation.id,
      jsonb_build_object(
        'level_key', v_level.level_key,
        'level_order', v_level.level_order,
        'title', v_level.title
      )
    );

    select min(l.level_order)
      into v_next_level
    from public.reward_program_levels l
    where l.program_id = v_level.program_id
      and l.program_version_number = v_level.program_version_number
      and not exists (
        select 1
        from public.reward_program_level_unlocks u
        where u.program_id = v_level.program_id
          and u.student_id = v_evaluation.student_id
          and u.level_key_snapshot = l.level_key
      );

    if v_next_level is null then
      update public.reward_program_participations
      set status = 'completed',
          current_level_order = null,
          completed_at = coalesce(completed_at, now()),
          updated_at = now()
      where id = v_participation.id;

      insert into public.reward_program_events (
        studio_id,
        program_id,
        participation_id,
        student_id,
        program_version_number,
        event_type,
        source_evaluation_id,
        details
      ) values (
        v_evaluation.studio_id,
        v_level.program_id,
        v_participation.id,
        v_evaluation.student_id,
        v_level.program_version_number,
        'program_completed',
        v_evaluation.id,
        jsonb_build_object('final_level_key', v_level.level_key)
      );

      v_completed := v_completed + 1;
    else
      update public.reward_program_participations
      set status = 'active',
          current_level_order = v_next_level,
          completed_at = null,
          updated_at = now()
      where id = v_participation.id;

      if v_level.progression_mode = 'sequential' then
        insert into public.reward_program_events (
          studio_id,
          program_id,
          participation_id,
          student_id,
          program_version_number,
          level_id,
          event_type,
          source_evaluation_id,
          details
        )
        select
          v_evaluation.studio_id,
          v_level.program_id,
          v_participation.id,
          v_evaluation.student_id,
          v_level.program_version_number,
          l.id,
          'level_started',
          v_evaluation.id,
          jsonb_build_object(
            'level_key', l.level_key,
            'level_order', l.level_order
          )
        from public.reward_program_levels l
        where l.program_id = v_level.program_id
          and l.program_version_number = v_level.program_version_number
          and l.level_order = v_next_level;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'unlocked', v_unlocked,
    'completed_programs', v_completed
  );
end;
$$;

create or replace function public.admin_create_reward_program(
  p_studio_id uuid,
  p_name text,
  p_description text,
  p_progression_mode text,
  p_audience_definition jsonb default null,
  p_presentation_definition jsonb default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_create_reward_program_internal(
    p_studio_id,
    p_name,
    p_description,
    p_progression_mode,
    p_audience_definition,
    p_presentation_definition
  );
$$;

create or replace function public.admin_create_reward_program_version(
  p_program_id uuid
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.admin_create_reward_program_version_internal(p_program_id);
$$;

create or replace function public.admin_update_reward_program_draft(
  p_program_id uuid,
  p_name text,
  p_description text,
  p_progression_mode text,
  p_audience_definition jsonb default null,
  p_presentation_definition jsonb default null
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.admin_update_reward_program_draft_internal(
    p_program_id,
    p_name,
    p_description,
    p_progression_mode,
    p_audience_definition,
    p_presentation_definition
  );
$$;

create or replace function public.admin_replace_reward_program_levels(
  p_program_id uuid,
  p_levels jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.admin_replace_reward_program_levels_internal(
    p_program_id,
    p_levels
  );
$$;

create or replace function public.admin_publish_reward_program(
  p_program_id uuid,
  p_note text default null
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.admin_publish_reward_program_internal(
    p_program_id,
    p_note
  );
$$;

create or replace function public.admin_transition_reward_program(
  p_program_id uuid,
  p_action text,
  p_note text default null
)
returns public.reward_program_status
language sql
security invoker
set search_path = ''
as $$
  select private.admin_transition_reward_program_internal(
    p_program_id,
    p_action,
    p_note
  );
$$;

revoke all on function private.admin_create_reward_program_internal(
  uuid,text,text,text,jsonb,jsonb
) from public, anon;
revoke all on function private.admin_create_reward_program_version_internal(uuid)
from public, anon;
revoke all on function private.admin_update_reward_program_draft_internal(
  uuid,text,text,text,jsonb,jsonb
) from public, anon;
revoke all on function private.admin_replace_reward_program_levels_internal(uuid,jsonb)
from public, anon;
revoke all on function private.admin_publish_reward_program_internal(uuid,text)
from public, anon;
revoke all on function private.admin_transition_reward_program_internal(uuid,text,text)
from public, anon;
revoke all on function private.reward_program_materialize_participation_internal(uuid,uuid)
from public, anon, authenticated;
revoke all on function private.reward_program_reassign_participations_internal(uuid,integer)
from public, anon, authenticated;

grant execute on function private.admin_create_reward_program_internal(
  uuid,text,text,text,jsonb,jsonb
) to authenticated;
grant execute on function private.admin_create_reward_program_version_internal(uuid)
to authenticated;
grant execute on function private.admin_update_reward_program_draft_internal(
  uuid,text,text,text,jsonb,jsonb
) to authenticated;
grant execute on function private.admin_replace_reward_program_levels_internal(uuid,jsonb)
to authenticated;
grant execute on function private.admin_publish_reward_program_internal(uuid,text)
to authenticated;
grant execute on function private.admin_transition_reward_program_internal(uuid,text,text)
to authenticated;
grant execute on function private.reward_program_materialize_participation_internal(uuid,uuid)
to service_role;
grant execute on function private.reward_program_reassign_participations_internal(uuid,integer)
to service_role;

revoke all on function public.admin_create_reward_program(
  uuid,text,text,text,jsonb,jsonb
) from public, anon;
revoke all on function public.admin_create_reward_program_version(uuid)
from public, anon;
revoke all on function public.admin_update_reward_program_draft(
  uuid,text,text,text,jsonb,jsonb
) from public, anon;
revoke all on function public.admin_replace_reward_program_levels(uuid,jsonb)
from public, anon;
revoke all on function public.admin_publish_reward_program(uuid,text)
from public, anon;
revoke all on function public.admin_transition_reward_program(uuid,text,text)
from public, anon;

grant execute on function public.admin_create_reward_program(
  uuid,text,text,text,jsonb,jsonb
) to authenticated;
grant execute on function public.admin_create_reward_program_version(uuid)
to authenticated;
grant execute on function public.admin_update_reward_program_draft(
  uuid,text,text,text,jsonb,jsonb
) to authenticated;
grant execute on function public.admin_replace_reward_program_levels(uuid,jsonb)
to authenticated;
grant execute on function public.admin_publish_reward_program(uuid,text)
to authenticated;
grant execute on function public.admin_transition_reward_program(uuid,text,text)
to authenticated;

revoke all on function public.system_materialize_reward_program_participation(uuid,uuid)
from public, anon, authenticated;
revoke all on function public.system_materialize_reward_program_participations(uuid)
from public, anon, authenticated;
revoke all on function public.system_record_reward_program_level_completion(uuid)
from public, anon, authenticated;

grant execute on function public.system_materialize_reward_program_participation(uuid,uuid)
to service_role;
grant execute on function public.system_materialize_reward_program_participations(uuid)
to service_role;
grant execute on function public.system_record_reward_program_level_completion(uuid)
to service_role;
