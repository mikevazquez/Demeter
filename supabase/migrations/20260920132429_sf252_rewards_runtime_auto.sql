
-- SF-252 · Runtime automático para Progress & Rewards V1.

create or replace function private.reward_rule_student_eligible(
  p_rule_id uuid,
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
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_student public.students%rowtype;
  v_scope text;
  v_mode text;
begin
  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then return false; end if;

  select * into v_version
  from public.reward_rule_versions
  where rule_id = p_rule_id
    and version_number = p_version_number;

  if not found or v_version.studio_id <> v_rule.studio_id then
    return false;
  end if;

  select * into v_student
  from public.students
  where id = p_student_id
    and studio_id = v_rule.studio_id;

  if not found then return false; end if;

  v_scope := coalesce(
    nullif(v_version.audience_definition->>'scope',''),
    case
      when coalesce((v_version.audience_definition->>'only_active_students')::boolean, true)
        then 'all_active_students'
      else 'all_students'
    end
  );
  v_mode := coalesce(
    nullif(v_version.audience_definition->>'eligibility_mode',''),
    'continuous'
  );

  if v_scope not in ('all_students','all_active_students') then
    return false;
  end if;

  if v_mode not in ('continuous','lock_on_join') then
    return false;
  end if;

  if v_mode = 'lock_on_join'
     and exists (
       select 1
       from public.reward_participations p
       where p.rule_id = p_rule_id
         and p.student_id = p_student_id
     ) then
    return true;
  end if;

  if v_scope = 'all_students' then
    return true;
  end if;

  return v_student.active = true
     and v_student.lifecycle_status = 'active';
end;
$$;

create or replace function private.reward_rule_materialize_participation_internal(
  p_rule_id uuid,
  p_student_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_existing uuid;
  v_id uuid;
begin
  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found
     or v_rule.status <> 'active'
     or v_rule.current_version_number is null
     or (v_rule.scheduled_start_at is not null and clock_timestamp() < v_rule.scheduled_start_at)
     or (v_rule.scheduled_end_at is not null and clock_timestamp() > v_rule.scheduled_end_at) then
    return null;
  end if;

  select id into v_existing
  from public.reward_participations
  where rule_id = p_rule_id
    and student_id = p_student_id;

  if v_existing is not null then
    return v_existing;
  end if;

  if not private.reward_rule_student_eligible(
    p_rule_id,
    v_rule.current_version_number,
    p_student_id
  ) then
    return null;
  end if;

  insert into public.reward_participations(
    studio_id, rule_id, student_id, joined_version_number, status, joined_at
  )
  values(
    v_rule.studio_id, v_rule.id, p_student_id,
    v_rule.current_version_number, 'eligible', clock_timestamp()
  )
  on conflict (rule_id, student_id) do update
  set updated_at = public.reward_participations.updated_at
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.system_materialize_reward_runtime_for_student(
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_rule record;
  v_program record;
  v_rules integer := 0;
  v_programs integer := 0;
  v_id uuid;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'reward_student_not_found';
  end if;

  for v_rule in
    select id
    from public.reward_rules
    where studio_id = v_student.studio_id
      and status = 'active'
  loop
    v_id := private.reward_rule_materialize_participation_internal(
      v_rule.id, v_student.id
    );
    if v_id is not null then v_rules := v_rules + 1; end if;
  end loop;

  for v_program in
    select id
    from public.reward_programs
    where studio_id = v_student.studio_id
      and status = 'active'
      and published_version_number is not null
  loop
    v_id := private.reward_program_materialize_participation_internal(
      v_program.id, v_student.id
    );
    if v_id is not null then v_programs := v_programs + 1; end if;
  end loop;

  return jsonb_build_object(
    'rule_participations_seen', v_rules,
    'program_participations_seen', v_programs
  );
end;
$$;

create or replace function private.reward_rule_runtime_allowed(
  p_rule_id uuid,
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
  v_managed boolean;
begin
  select exists (
    select 1
    from public.reward_program_levels l
    join public.reward_programs p on p.id = l.program_id
    where l.rule_id = p_rule_id
      and l.rule_version_number = p_version_number
      and p.published_version_number = l.program_version_number
  ) into v_managed;

  if not v_managed then
    return private.reward_rule_student_eligible(
      p_rule_id, p_version_number, p_student_id
    );
  end if;

  return exists (
    select 1
    from public.reward_program_levels l
    join public.reward_programs p
      on p.id = l.program_id
     and p.published_version_number = l.program_version_number
    join public.reward_program_versions pv
      on pv.program_id = l.program_id
     and pv.version_number = l.program_version_number
    join public.reward_program_participations pp
      on pp.program_id = l.program_id
     and pp.student_id = p_student_id
     and pp.program_version_number = l.program_version_number
     and pp.status = 'active'
    where l.rule_id = p_rule_id
      and l.rule_version_number = p_version_number
      and p.status = 'active'
      and (
        coalesce(pv.audience_definition->>'eligibility_mode','continuous') = 'lock_on_join'
        or private.reward_program_student_eligible(
             l.program_id, l.program_version_number, p_student_id
           )
      )
      and (
        pv.progression_mode = 'cumulative'
        or pp.current_level_order = l.level_order
      )
  );
end;
$$;

create or replace function private.reward_rule_program_window_start_at(
  p_rule_id uuid,
  p_version_number integer,
  p_student_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(coalesce(ls.occurred_at, pp.joined_at))
  from public.reward_program_levels l
  join public.reward_programs p
    on p.id = l.program_id
   and p.published_version_number = l.program_version_number
   and p.status = 'active'
  join public.reward_program_versions pv
    on pv.program_id = l.program_id
   and pv.version_number = l.program_version_number
   and pv.progression_mode = 'sequential'
  join public.reward_program_participations pp
    on pp.program_id = l.program_id
   and pp.student_id = p_student_id
   and pp.program_version_number = l.program_version_number
   and pp.status = 'active'
   and pp.current_level_order = l.level_order
  left join lateral (
    select e.occurred_at
    from public.reward_program_events e
    where e.program_id = l.program_id
      and e.participation_id = pp.id
      and e.level_id = l.id
      and e.event_type = 'level_started'
    order by e.occurred_at desc, e.id desc
    limit 1
  ) ls on true
  where l.rule_id = p_rule_id
    and l.rule_version_number = p_version_number;
$$;

create or replace function private.reward_trim_loyalty_state_from(
  p_state jsonb,
  p_window_start date
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_filtered jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_current integer := 0;
  v_best integer := 0;
  v_grace integer := coalesce((p_state->>'grace_days')::integer,0);
  v_first date;
  v_last date;
begin
  if p_window_start is null then return p_state; end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_state->'counted_periods','[]'::jsonb))
  loop
    if coalesce(
      nullif(v_item->>'effective_start','')::date,
      nullif(v_item->>'starts_on','')::date
    ) < p_window_start then
      continue;
    end if;

    v_total := v_total + 1;
    if v_total = 1 then
      v_current := 1;
      v_first := coalesce(
        nullif(v_item->>'effective_start','')::date,
        nullif(v_item->>'starts_on','')::date
      );
    elsif coalesce((v_item->>'gap_days')::integer,0) <= v_grace then
      v_current := v_current + 1;
    else
      v_current := 1;
    end if;

    v_best := greatest(v_best, v_current);
    v_last := nullif(v_item->>'expires_on','')::date;
    v_filtered := v_filtered || jsonb_build_array(v_item);
  end loop;

  if v_total = 0 then
    return p_state || jsonb_build_object(
      'total_paid_periods',0,
      'current_consecutive_periods',0,
      'best_consecutive_periods',0,
      'current_coverage_start',null,
      'current_coverage_end',null,
      'active_coverage',false,
      'in_grace',false,
      'counted_periods','[]'::jsonb,
      'program_window_start',p_window_start
    );
  end if;

  if coalesce((p_state->>'current_consecutive_periods')::integer,0) = 0 then
    v_current := 0;
  end if;

  return p_state || jsonb_build_object(
    'total_paid_periods',v_total,
    'current_consecutive_periods',v_current,
    'best_consecutive_periods',v_best,
    'current_coverage_start',v_first,
    'current_coverage_end',v_last,
    'counted_periods',v_filtered,
    'program_window_start',p_window_start
  );
end;
$$;

create or replace function public.reward_rules_for_domain_event(p_event_id uuid)
returns table(
  rule_id uuid,
  version_number integer,
  family public.reward_rule_family,
  event_type text,
  metric_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.domain_events%rowtype;
  v_student_id uuid;
begin
  select * into v_event
  from public.domain_events
  where event_id = p_event_id;

  if not found then
    raise exception 'domain_event_not_found';
  end if;

  v_student_id := nullif(v_event.payload->>'student_id','')::uuid;
  if v_student_id is null then return; end if;

  return query
  select
    b.rule_id,
    b.version_number,
    v.family,
    b.event_type,
    b.metric_key
  from public.reward_rule_event_bindings b
  join public.reward_rules r
    on r.studio_id = b.studio_id
   and r.id = b.rule_id
  join public.reward_rule_versions v
    on v.rule_id = b.rule_id
   and v.version_number = b.version_number
  where b.studio_id = v_event.studio_id
    and b.event_type = v_event.event_type
    and r.status = 'active'
    and r.current_version_number = b.version_number
    and (r.scheduled_start_at is null or v_event.occurred_at >= r.scheduled_start_at)
    and (r.scheduled_end_at is null or v_event.occurred_at <= r.scheduled_end_at)
    and (
      coalesce((v.evaluation_definition->>'allow_historical')::boolean,false)
      or r.first_activated_at is null
      or v_event.occurred_at >= r.first_activated_at
    )
    and private.reward_rule_runtime_allowed(
      b.rule_id, b.version_number, v_student_id
    )
  order by b.rule_id, b.metric_key;
end;
$$;

create or replace function private.reward_progress_program_completion_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfilled then
    begin
      perform public.system_record_reward_program_level_completion(new.id);
    exception when others then
      begin
        perform public.system_open_reward_incident(
          new.studio_id,
          new.student_id,
          new.rule_id,
          null,
          'program_level_runtime_error',
          'high',
          'No se pudo aplicar el avance automático de un programa',
          jsonb_build_object(
            'evaluation_id',new.id,
            'error',sqlerrm
          ),
          'sf252:program-evaluation:' || new.id::text
        );
      exception when others then
        null;
      end;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists reward_progress_program_completion
on public.reward_progress_evaluations;

create trigger reward_progress_program_completion
after insert on public.reward_progress_evaluations
for each row
execute function private.reward_progress_program_completion_trigger();

create or replace function private.reward_materialize_student_runtime_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.system_materialize_reward_runtime_for_student(new.id);
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists reward_materialize_student_runtime on public.students;
create trigger reward_materialize_student_runtime
after insert or update of active, lifecycle_status on public.students
for each row
execute function private.reward_materialize_student_runtime_trigger();

create or replace function private.reward_materialize_rule_runtime_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
begin
  if new.status = 'active' then
    for v_student in
      select id from public.students
      where studio_id = new.studio_id
    loop
      begin
        perform private.reward_rule_materialize_participation_internal(
          new.id, v_student.id
        );
      exception when others then
        null;
      end;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists reward_materialize_rule_runtime on public.reward_rules;
create trigger reward_materialize_rule_runtime
after insert or update of status, current_version_number,
  scheduled_start_at, scheduled_end_at
on public.reward_rules
for each row
execute function private.reward_materialize_rule_runtime_trigger();

create or replace function private.reward_materialize_program_runtime_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
begin
  if new.status = 'active' and new.published_version_number is not null then
    for v_student in
      select id from public.students
      where studio_id = new.studio_id
    loop
      begin
        perform private.reward_program_materialize_participation_internal(
          new.id, v_student.id
        );
      exception when others then
        null;
      end;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists reward_materialize_program_runtime on public.reward_programs;
create trigger reward_materialize_program_runtime
after insert or update of status, published_version_number
on public.reward_programs
for each row
execute function private.reward_materialize_program_runtime_trigger();

create or replace function private.reward_try_process_domain_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type in (
    'attendance.finalized',
    'attendance.corrected',
    'attendance.cancelled',
    'loyalty.changed'
  ) then
    begin
      perform public.system_process_reward_domain_event(new.event_id);
    exception when others then
      begin
        perform public.system_open_reward_incident(
          new.studio_id,
          nullif(new.payload->>'student_id','')::uuid,
          null,
          null,
          'runtime_processing_error',
          'high',
          'Rewards no pudo procesar un evento de dominio',
          jsonb_build_object(
            'event_id',new.event_id,
            'event_type',new.event_type,
            'error',sqlerrm
          ),
          'sf252:event:' || new.event_id::text
        );
      exception when others then
        null;
      end;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.reward_rule_student_eligible(uuid,integer,uuid)
from public, anon, authenticated;
revoke all on function private.reward_rule_materialize_participation_internal(uuid,uuid)
from public, anon, authenticated;
revoke all on function private.reward_rule_runtime_allowed(uuid,integer,uuid)
from public, anon, authenticated;
revoke all on function private.reward_rule_program_window_start_at(uuid,integer,uuid)
from public, anon, authenticated;
revoke all on function private.reward_trim_loyalty_state_from(jsonb,date)
from public, anon, authenticated;
revoke all on function private.reward_progress_program_completion_trigger()
from public, anon, authenticated, service_role;
revoke all on function private.reward_materialize_student_runtime_trigger()
from public, anon, authenticated, service_role;
revoke all on function private.reward_materialize_rule_runtime_trigger()
from public, anon, authenticated, service_role;
revoke all on function private.reward_materialize_program_runtime_trigger()
from public, anon, authenticated, service_role;

revoke all on function public.system_materialize_reward_runtime_for_student(uuid)
from public, anon, authenticated;
grant execute on function public.system_materialize_reward_runtime_for_student(uuid)
to service_role;

CREATE OR REPLACE FUNCTION private.reward_program_materialize_participation_internal(p_program_id uuid, p_student_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_program.status <> 'active' then
    return null;
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
$function$
;

CREATE OR REPLACE FUNCTION public.system_record_reward_program_level_completion(p_source_evaluation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      pv.audience_definition,
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

    if coalesce(v_level.audience_definition->>'eligibility_mode', 'continuous') = 'continuous'
       and not private.reward_program_student_eligible(
         v_level.program_id,
         v_level.program_version_number,
         v_evaluation.student_id
       ) then
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
$function$
;

CREATE OR REPLACE FUNCTION public.system_process_reward_domain_event(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.domain_events%rowtype;
  v_student_id uuid;
  v_binding record;
  v_version public.reward_rule_versions%rowtype;
  v_timezone text;
  v_state jsonb;
  v_metrics jsonb;
  v_eval jsonb;
  v_progress jsonb;
  v_evaluation_id uuid;
  v_cycle_key text;
  v_supersedes uuid;
  v_reward jsonb;
  v_reward_item jsonb;
  v_reward_key text;
  v_processed integer := 0;
  v_granted integer := 0;
  v_achievements integer := 0;
  v_is_correction boolean;
  v_program_window_start timestamptz;
begin
  select * into v_event
  from public.domain_events
  where event_id = p_event_id;

  if not found then
    raise exception 'domain_event_not_found';
  end if;

  v_student_id := nullif(v_event.payload->>'student_id', '')::uuid;
  if v_student_id is null then
    perform public.claim_domain_event(v_event.event_id, 'rewards.v1');
    return jsonb_build_object('processed', 0, 'reason', 'student_missing');
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = v_student_id
      and s.studio_id = v_event.studio_id
  ) then
    perform public.claim_domain_event(v_event.event_id, 'rewards.v1');
    return jsonb_build_object('processed', 0, 'reason', 'student_not_found');
  end if;

  perform public.system_materialize_reward_runtime_for_student(v_student_id);

  v_is_correction := v_event.event_type = 'attendance.corrected';

  for v_binding in
    select distinct x.rule_id, x.version_number, x.family
    from public.reward_rules_for_domain_event(v_event.event_id) x
  loop
    select * into v_version
    from public.reward_rule_versions
    where rule_id = v_binding.rule_id
      and version_number = v_binding.version_number;

    if not found then
      continue;
    end if;

    v_program_window_start :=
      private.reward_rule_program_window_start_at(
        v_binding.rule_id,
        v_binding.version_number,
        v_student_id
      );

    select timezone into v_timezone
    from public.studios
    where id = v_version.studio_id;

    if v_binding.family = 'loyalty' then
      v_state := public.system_compute_reward_loyalty_state(
        v_binding.rule_id,
        v_binding.version_number,
        v_student_id,
        (v_event.occurred_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
      );

      if v_program_window_start is not null then
        v_state := private.reward_trim_loyalty_state_from(
          v_state,
          (v_program_window_start at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
        );
      end if;
    else
      v_state := public.system_compute_reward_attendance_state(
        v_binding.rule_id,
        v_binding.version_number,
        v_student_id,
        (v_event.occurred_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date,
        case
          when v_program_window_start is null then null
          else (v_program_window_start at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
        end,
        null
      );
    end if;

    v_metrics := private.reward_metrics_from_state(v_binding.family, v_state);
    v_eval := private.reward_evaluate_conditions(v_version.condition_definition, v_metrics);
    v_cycle_key := private.reward_cycle_key_for_event(
      v_binding.rule_id,
      v_student_id,
      v_binding.version_number,
      v_version.cycle_definition,
      v_event.occurred_at,
      v_timezone
    );

    v_supersedes := null;
    if v_is_correction then
      select e.id into v_supersedes
      from public.reward_progress_evaluations e
      join public.reward_cycles c on c.id = e.cycle_id
      where e.rule_id = v_binding.rule_id
        and e.student_id = v_student_id
        and c.cycle_key = v_cycle_key
      order by e.evaluated_at desc, e.id desc
      limit 1;
    end if;

    v_progress := public.system_record_reward_progress_evaluation(
      v_binding.rule_id,
      v_binding.version_number,
      v_student_id,
      v_cycle_key,
      'rewards:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text,
      case when v_is_correction then 'recalculation'::public.reward_progress_evaluation_kind
           else 'event'::public.reward_progress_evaluation_kind end,
      case when v_is_correction then 'recalculated'::public.reward_progress_evaluation_outcome
           else 'counted'::public.reward_progress_evaluation_outcome end,
      v_event.occurred_at,
      v_eval->'conditions',
      v_metrics,
      jsonb_build_object(
        'domain_event_id', v_event.event_id,
        'event_type', v_event.event_type,
        'source_entity_type', v_event.source_entity_type,
        'source_entity_id', v_event.source_entity_id,
        'state', v_state
      ),
      v_event.event_id,
      coalesce((v_eval->>'fulfilled')::boolean, false),
      null,
      case when v_state ? 'window_start'
        then ((v_state->>'window_start')::date)::timestamptz else null end,
      case when v_state ? 'window_end'
        then (((v_state->>'window_end')::date + 1)::timestamptz - interval '1 millisecond') else null end,
      v_supersedes
    );

    v_evaluation_id := (v_progress->>'evaluation_id')::uuid;
    v_processed := v_processed + 1;

    if v_is_correction and v_supersedes is not null then
      perform public.system_reconcile_reward_correction(v_evaluation_id);
    end if;

    if jsonb_typeof(v_version.reward_definition->'rewards') = 'array' then
      for v_reward_item in
        select value from jsonb_array_elements(v_version.reward_definition->'rewards')
      loop
        v_reward_key := coalesce(nullif(v_reward_item->>'key', ''), 'primary');

        if coalesce((v_eval->>'fulfilled')::boolean, false)
           or exists (
             select 1
             from jsonb_array_elements(v_eval->'conditions') c
             where c->>'key' = v_reward_key
               and coalesce((c->>'passed')::boolean, false)
           ) then
          if coalesce(v_reward_item->>'delivery', 'redeem') = 'achievement'
             or v_reward_item->>'kind' = 'badge' then
            if coalesce((v_eval->>'fulfilled')::boolean, false) then
              perform public.system_unlock_reward_achievement(
                v_evaluation_id,
                v_reward_key,
                coalesce(v_reward_item->>'title', v_version.name),
                v_reward_item,
                v_reward_item->>'level_key',
                'achievement:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text || ':key:' || v_reward_key,
                v_event.occurred_at
              );
              v_achievements := v_achievements + 1;
            end if;
          else
            v_reward := public.system_generate_reward_instance(
              v_evaluation_id,
              v_reward_key,
              'reward:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text || ':key:' || v_reward_key,
              jsonb_build_object('domain_event_id', v_event.event_id, 'event_type', v_event.event_type),
              null,
              null
            );
            if coalesce((v_reward->>'created')::boolean, false) then
              v_granted := v_granted + 1;
            end if;
          end if;
        end if;
      end loop;
    elsif jsonb_typeof(v_version.reward_definition) = 'object'
          and (
            v_version.reward_definition ? 'kind'
            or v_version.reward_definition ? 'delivery'
          ) then
      v_reward_item := v_version.reward_definition;
      v_reward_key := coalesce(nullif(v_reward_item->>'key', ''), 'primary');

      if coalesce((v_eval->>'fulfilled')::boolean, false)
         or exists (
           select 1
           from jsonb_array_elements(v_eval->'conditions') c
           where c->>'key' = v_reward_key
             and coalesce((c->>'passed')::boolean, false)
         ) then
        if coalesce(v_reward_item->>'delivery', 'redeem') = 'achievement'
           or v_reward_item->>'kind' = 'badge' then
          if coalesce((v_eval->>'fulfilled')::boolean, false) then
            perform public.system_unlock_reward_achievement(
              v_evaluation_id,
              v_reward_key,
              coalesce(v_reward_item->>'title', v_version.name),
              v_reward_item,
              v_reward_item->>'level_key',
              'achievement:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text || ':key:' || v_reward_key,
              v_event.occurred_at
            );
            v_achievements := v_achievements + 1;
          end if;
        else
          v_reward := public.system_generate_reward_instance(
            v_evaluation_id,
            v_reward_key,
            'reward:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text || ':key:' || v_reward_key,
            jsonb_build_object('domain_event_id', v_event.event_id, 'event_type', v_event.event_type),
            null,
            null
          );
          if coalesce((v_reward->>'created')::boolean, false) then
            v_granted := v_granted + 1;
          end if;
        end if;
      end if;
    end if;
  end loop;

  perform public.claim_domain_event(v_event.event_id, 'rewards.v1');

  return jsonb_build_object(
    'processed', v_processed,
    'granted', v_granted,
    'achievements', v_achievements
  );
end;
$function$
;


do $$
declare
  v_student record;
begin
  for v_student in select id from public.students order by created_at,id
  loop
    perform public.system_materialize_reward_runtime_for_student(v_student.id);
  end loop;
end
$$;
