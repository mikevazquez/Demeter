
create table if not exists public.reward_challenge_student_archives (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_id uuid not null references public.reward_rules(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  archived_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint reward_challenge_student_archives_rule_student_unique unique(rule_id, student_id)
);

alter table public.reward_challenge_student_archives enable row level security;

revoke all on table public.reward_challenge_student_archives
from public, anon, authenticated, service_role;
grant select, insert, update on table public.reward_challenge_student_archives
to service_role;


create or replace function public.student_list_reward_challenges(
  p_studio_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required';
  end if;

  select * into v_student
  from public.students
  where studio_id = p_studio_id
    and user_id = (select auth.uid())
  order by created_at
  limit 1;

  if not found then
    raise exception 'student_portal_forbidden';
  end if;

  select coalesce(jsonb_agg(item order by sort_order, starts_at nulls first, title), '[]'::jsonb)
    into v_result
  from (
    select
      case r.status
        when 'active' then 1
        when 'scheduled' then 2
        when 'finished' then 3
        else 4
      end as sort_order,
      r.scheduled_start_at as starts_at,
      coalesce(c.title, rv.name) as title,
      jsonb_build_object(
        'rule_id', r.id,
        'status', r.status,
        'title', coalesce(c.title, rv.name),
        'description', coalesce(c.description, rv.description),
        'cover_url', coalesce(c.cover_url, nullif(rv.presentation_definition->>'cover_url','')),
        'competition_mode', coalesce(nullif(rv.presentation_definition->>'competition_mode',''), 'individual'),
        'tie_breaker', coalesce(nullif(rv.presentation_definition->>'tie_breaker',''), 'first_to_reach'),
        'ranking_metric', coalesce(
          nullif(rv.presentation_definition->>'ranking_metric',''),
          rv.condition_definition->'conditions'->0->>'metric',
          'attendance.count'
        ),
        'scheduled_start_at', r.scheduled_start_at,
        'scheduled_end_at', r.scheduled_end_at,
        'finished_at', r.finished_at,
        'archived', a.id is not null,
        'archived_at', a.archived_at,
        'reward_visibility', coalesce(rv.presentation_definition->>'reward_visibility','visible'),
        'reward_definition', case
          when coalesce(rv.presentation_definition->>'reward_visibility','visible') = 'surprise'
            then null
          when coalesce(nullif(rv.presentation_definition->>'competition_mode',''), 'individual') = 'leaderboard'
            then coalesce(rv.presentation_definition->'competition_reward_definition','{"rewards":[]}'::jsonb)
          else rv.reward_definition
        end,
        'condition_definition', rv.condition_definition,
        'participation_id', p.id,
        'participation_status', p.status,
        'is_enrolled', case
          when coalesce(nullif(rv.presentation_definition->>'competition_mode',''), 'individual') = 'leaderboard'
            then e.id is not null and e.status = 'active'
          else p.id is not null
        end,
        'participant_count', case
          when coalesce(nullif(rv.presentation_definition->>'competition_mode',''), 'individual') = 'leaderboard'
            then (
              select count(*)
              from public.reward_challenge_enrollments ce
              where ce.rule_id = r.id and ce.status = 'active'
            )
          else null
        end,
        'current_value', coalesce((
          case
            when s.progress is null then 0::numeric
            when jsonb_typeof(
              s.progress -> coalesce(
                nullif(rv.presentation_definition->>'ranking_metric',''),
                rv.condition_definition->'conditions'->0->>'metric',
                'attendance.count'
              )
            ) = 'number'
              then (
                s.progress ->> coalesce(
                  nullif(rv.presentation_definition->>'ranking_metric',''),
                  rv.condition_definition->'conditions'->0->>'metric',
                  'attendance.count'
                )
              )::numeric
            else 0::numeric
          end
        ), 0::numeric),
        'cycle_status', cy.status,
        'completed_at', coalesce(cy.fulfilled_at, p.fulfilled_at)
      ) as item
    from public.reward_rules r
    join public.reward_rule_versions rv
      on rv.rule_id = r.id
     and rv.version_number = r.current_version_number
     and rv.studio_id = r.studio_id
    left join public.reward_rule_copy_overrides c
      on c.rule_id = r.id
     and c.studio_id = r.studio_id
    left join public.reward_participations p
      on p.rule_id = r.id
     and p.student_id = v_student.id
     and p.studio_id = r.studio_id
    left join public.reward_challenge_enrollments e
      on e.rule_id = r.id
     and e.student_id = v_student.id
     and e.studio_id = r.studio_id
    left join public.reward_challenge_student_archives a
      on a.rule_id = r.id
     and a.student_id = v_student.id
     and a.studio_id = r.studio_id
    left join lateral (
      select rc.*
      from public.reward_cycles rc
      where rc.participation_id = p.id
      order by rc.updated_at desc, rc.created_at desc, rc.id desc
      limit 1
    ) cy on true
    left join lateral (
      select rs.*
      from public.reward_progress_snapshots rs
      where rs.cycle_id = cy.id
      order by rs.calculated_at desc, rs.id desc
      limit 1
    ) s on true
    where r.studio_id = p_studio_id
      and rv.family = 'challenge'
      and r.status in ('active','scheduled','finished')
      and (
        coalesce(rv.audience_definition->>'scope','all_active_students') = 'all_students'
        or (
          v_student.active = true
          and v_student.lifecycle_status = 'active'
        )
      )
      and (
        r.status <> 'finished'
        or p.id is not null
        or e.id is not null
      )
  ) q;

  return v_result;
end;
$$;

revoke all on function public.student_list_reward_challenges(uuid)
from public, anon;
grant execute on function public.student_list_reward_challenges(uuid)
to authenticated;


create or replace function public.student_archive_reward_challenge(
  p_rule_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_student public.students%rowtype;
  v_archived_at timestamptz := clock_timestamp();
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required';
  end if;

  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then
    raise exception 'challenge_not_found';
  end if;

  if v_rule.status <> 'finished' then
    raise exception 'challenge_not_finished';
  end if;

  select * into v_student
  from public.students
  where studio_id = v_rule.studio_id
    and user_id = (select auth.uid())
  order by created_at
  limit 1;

  if not found then
    raise exception 'student_portal_forbidden';
  end if;

  if not exists (
    select 1
    from public.reward_participations p
    where p.rule_id = v_rule.id
      and p.student_id = v_student.id
      and p.studio_id = v_rule.studio_id
  ) and not exists (
    select 1
    from public.reward_challenge_enrollments e
    where e.rule_id = v_rule.id
      and e.student_id = v_student.id
      and e.studio_id = v_rule.studio_id
  ) then
    raise exception 'challenge_not_available';
  end if;

  insert into public.reward_challenge_student_archives (
    studio_id,
    rule_id,
    student_id,
    archived_at,
    created_at,
    updated_at
  ) values (
    v_rule.studio_id,
    v_rule.id,
    v_student.id,
    v_archived_at,
    v_archived_at,
    v_archived_at
  )
  on conflict (rule_id, student_id)
  do update set
    archived_at = excluded.archived_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'rule_id', v_rule.id,
    'archived', true,
    'archived_at', v_archived_at
  );
end;
$$;

revoke all on function public.student_archive_reward_challenge(uuid)
from public, anon;
grant execute on function public.student_archive_reward_challenge(uuid)
to authenticated;
