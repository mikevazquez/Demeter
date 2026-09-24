
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
