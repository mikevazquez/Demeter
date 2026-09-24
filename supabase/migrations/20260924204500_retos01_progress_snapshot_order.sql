CREATE OR REPLACE FUNCTION private.reward_challenge_rank(p_rule_id uuid)
 RETURNS TABLE(student_id uuid, score numeric, reached_at timestamp with time zone, rank_position integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_metric text;
  v_tie_breaker text;
begin
  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then raise exception 'challenge_not_found'; end if;

  select * into v_version
  from public.reward_rule_versions
  where rule_id = v_rule.id
    and version_number = v_rule.current_version_number
    and family = 'challenge';

  if not found
     or coalesce(v_version.presentation_definition->>'competition_mode','individual') <> 'leaderboard' then
    raise exception 'challenge_not_competitive';
  end if;

  v_metric := coalesce(
    nullif(v_version.presentation_definition->>'ranking_metric',''),
    v_version.condition_definition->'conditions'->0->>'metric',
    'attendance.count'
  );
  v_tie_breaker := coalesce(
    nullif(v_version.presentation_definition->>'tie_breaker',''),
    'first_to_reach'
  );

  return query
  with metrics as (
    select
      e.student_id,
      e.enrolled_at,
      coalesce(
        case
          when snap.progress is not null
           and jsonb_typeof(snap.progress -> v_metric) = 'number'
            then (snap.progress ->> v_metric)::numeric
          else 0::numeric
        end,
        0::numeric
      ) as score,
      snap.source_through as reached_at
    from public.reward_challenge_enrollments e
    left join public.reward_participations p
      on p.rule_id = e.rule_id
     and p.student_id = e.student_id
     and p.studio_id = e.studio_id
    left join lateral (
      select c.*
      from public.reward_cycles c
      where c.participation_id = p.id
      order by c.updated_at desc, c.created_at desc, c.id desc
      limit 1
    ) cy on true
    left join lateral (
      select ps.*
      from public.reward_progress_snapshots ps
      where ps.cycle_id = cy.id
      order by ps.source_through desc nulls last, ps.calculated_at desc, ps.id desc
      limit 1
    ) snap on true
    where e.rule_id = v_rule.id
      and e.studio_id = v_rule.studio_id
      and e.status = 'active'
  )
  select
    m.student_id,
    m.score,
    m.reached_at,
    case
      when v_tie_breaker = 'shared'
        then rank() over (order by m.score desc)::integer
      else row_number() over (
        order by m.score desc, m.reached_at asc nulls last, m.enrolled_at asc, m.student_id
      )::integer
    end as rank_position
  from metrics m;
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_list_reward_challenges(p_studio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      order by rs.source_through desc nulls last, rs.calculated_at desc, rs.id desc
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
$function$;

CREATE OR REPLACE FUNCTION public.student_reward_challenge_leaderboard(p_rule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_student public.students%rowtype;
  v_metric text;
  v_tie_breaker text;
  v_viewer record;
  v_third_score numeric;
  v_top3 jsonb;
  v_gap numeric := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required';
  end if;

  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then raise exception 'challenge_not_found'; end if;

  select * into v_version
  from public.reward_rule_versions
  where rule_id = v_rule.id
    and version_number = v_rule.current_version_number
    and family = 'challenge';

  if not found then raise exception 'challenge_not_found'; end if;

  if coalesce(v_version.presentation_definition->>'competition_mode','individual') <> 'leaderboard' then
    raise exception 'challenge_not_competitive';
  end if;

  select * into v_student
  from public.students
  where studio_id = v_rule.studio_id
    and user_id = (select auth.uid())
  order by created_at
  limit 1;

  if not found then raise exception 'student_portal_forbidden'; end if;

  if not exists (
    select 1
    from public.reward_challenge_enrollments e
    where e.rule_id = v_rule.id
      and e.student_id = v_student.id
      and e.status = 'active'
  ) then
    raise exception 'challenge_enrollment_required';
  end if;

  v_metric := coalesce(
    nullif(v_version.presentation_definition->>'ranking_metric',''),
    v_version.condition_definition->'conditions'->0->>'metric',
    'attendance.count'
  );
  v_tie_breaker := coalesce(
    nullif(v_version.presentation_definition->>'tie_breaker',''),
    'first_to_reach'
  );

  with metrics as (
    select
      e.student_id,
      private.reward_challenge_masked_name(s.full_name) as display_name,
      e.enrolled_at,
      coalesce(
        case
          when snap.progress is not null
           and jsonb_typeof(snap.progress -> v_metric) = 'number'
            then (snap.progress ->> v_metric)::numeric
          else 0::numeric
        end,
        0::numeric
      ) as score,
      snap.source_through as reached_at
    from public.reward_challenge_enrollments e
    join public.students s
      on s.id = e.student_id
     and s.studio_id = e.studio_id
    left join public.reward_participations p
      on p.rule_id = e.rule_id
     and p.student_id = e.student_id
     and p.studio_id = e.studio_id
    left join lateral (
      select c.*
      from public.reward_cycles c
      where c.participation_id = p.id
      order by c.updated_at desc, c.created_at desc, c.id desc
      limit 1
    ) cy on true
    left join lateral (
      select ps.*
      from public.reward_progress_snapshots ps
      where ps.cycle_id = cy.id
      order by ps.source_through desc nulls last, ps.calculated_at desc, ps.id desc
      limit 1
    ) snap on true
    where e.rule_id = v_rule.id
      and e.studio_id = v_rule.studio_id
      and e.status = 'active'
  ),
  ranked as (
    select
      m.*,
      case
        when v_tie_breaker = 'shared'
          then rank() over (order by m.score desc)
        else row_number() over (
          order by m.score desc, m.reached_at asc nulls last, m.enrolled_at asc, m.student_id
        )
      end::integer as position
    from metrics m
  )
  select *
    into v_viewer
  from ranked
  where student_id = v_student.id;

  with metrics as (
    select
      e.student_id,
      private.reward_challenge_masked_name(s.full_name) as display_name,
      e.enrolled_at,
      coalesce(
        case
          when snap.progress is not null
           and jsonb_typeof(snap.progress -> v_metric) = 'number'
            then (snap.progress ->> v_metric)::numeric
          else 0::numeric
        end,
        0::numeric
      ) as score,
      snap.source_through as reached_at
    from public.reward_challenge_enrollments e
    join public.students s
      on s.id = e.student_id
     and s.studio_id = e.studio_id
    left join public.reward_participations p
      on p.rule_id = e.rule_id
     and p.student_id = e.student_id
     and p.studio_id = e.studio_id
    left join lateral (
      select c.*
      from public.reward_cycles c
      where c.participation_id = p.id
      order by c.updated_at desc, c.created_at desc, c.id desc
      limit 1
    ) cy on true
    left join lateral (
      select ps.*
      from public.reward_progress_snapshots ps
      where ps.cycle_id = cy.id
      order by ps.source_through desc nulls last, ps.calculated_at desc, ps.id desc
      limit 1
    ) snap on true
    where e.rule_id = v_rule.id
      and e.studio_id = v_rule.studio_id
      and e.status = 'active'
  ),
  ranked as (
    select
      m.*,
      case
        when v_tie_breaker = 'shared'
          then rank() over (order by m.score desc)
        else row_number() over (
          order by m.score desc, m.reached_at asc nulls last, m.enrolled_at asc, m.student_id
        )
      end::integer as position
    from metrics m
  ),
  top_rows as (
    select *
    from ranked
    order by position, score desc, reached_at asc nulls last, enrolled_at, student_id
    limit 3
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'position', position,
          'name', display_name,
          'value', score,
          'is_you', student_id = v_student.id
        )
        order by position, score desc, display_name
      ),
      '[]'::jsonb
    ),
    (select score from top_rows order by position, score desc offset 2 limit 1)
  into v_top3, v_third_score
  from top_rows;

  if v_viewer.position is null then
    raise exception 'challenge_enrollment_required';
  end if;

  if v_viewer.position > 3 and v_third_score is not null then
    v_gap := greatest(
      0::numeric,
      v_third_score - v_viewer.score
      + case
          when v_tie_breaker = 'first_to_reach' and v_viewer.score >= v_third_score
            then 1::numeric
          else 0::numeric
        end
    );
  end if;

  return jsonb_build_object(
    'rule_id', v_rule.id,
    'metric', v_metric,
    'tie_breaker', v_tie_breaker,
    'top3', v_top3,
    'you', jsonb_build_object(
      'position', v_viewer.position,
      'name', v_viewer.display_name,
      'value', v_viewer.score,
      'gap_to_top3', v_gap
    )
  );
end;
$function$;
