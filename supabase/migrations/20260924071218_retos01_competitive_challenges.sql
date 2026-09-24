
-- RETOS-01 · competitive challenges, opt-in enrollment and privacy-safe leaderboard.

create table if not exists public.reward_challenge_enrollments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_id uuid not null references public.reward_rules(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active','withdrawn')),
  enrolled_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint reward_challenge_enrollments_rule_student_unique unique (rule_id, student_id),
  constraint reward_challenge_enrollments_withdrawn_at_chk
    check (status <> 'withdrawn' or withdrawn_at is not null)
);

create index if not exists reward_challenge_enrollments_rule_rank_idx
  on public.reward_challenge_enrollments(studio_id, rule_id, status, enrolled_at, student_id);
create index if not exists reward_challenge_enrollments_student_idx
  on public.reward_challenge_enrollments(studio_id, student_id, status, updated_at desc);

alter table public.reward_challenge_enrollments enable row level security;

drop policy if exists reward_challenge_enrollments_read on public.reward_challenge_enrollments;
create policy reward_challenge_enrollments_read
on public.reward_challenge_enrollments
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or private.is_reward_student_self(studio_id, student_id)
);

revoke all on table public.reward_challenge_enrollments from public, anon, authenticated, service_role;
grant select on table public.reward_challenge_enrollments to authenticated, service_role;
grant insert, update, delete on table public.reward_challenge_enrollments to service_role;

comment on table public.reward_challenge_enrollments is
  'RETOS-01 explicit opt-in enrollment for competitive challenges. Only active enrollments are eligible for leaderboard progress.';

-- Existing individual challenges keep automatic materialization. Competitive
-- challenges only materialize after the student explicitly enrolls.
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
  v_competition_mode text;
  v_enrollment_required boolean;
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
  v_competition_mode := coalesce(
    nullif(v_version.presentation_definition->>'competition_mode',''),
    'individual'
  );
  v_enrollment_required := coalesce(
    (v_version.presentation_definition->>'enrollment_required')::boolean,
    v_competition_mode = 'leaderboard'
  );

  if v_scope not in ('all_students','all_active_students') then
    return false;
  end if;

  if v_mode not in ('continuous','lock_on_join') then
    return false;
  end if;

  if v_version.family = 'challenge'
     and v_competition_mode = 'leaderboard'
     and v_enrollment_required
     and not exists (
       select 1
       from public.reward_challenge_enrollments e
       where e.rule_id = p_rule_id
         and e.student_id = p_student_id
         and e.studio_id = v_rule.studio_id
         and e.status = 'active'
     ) then
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

revoke all on function private.reward_rule_student_eligible(uuid,integer,uuid)
from public, anon, authenticated;

create or replace function private.reward_challenge_masked_name(p_full_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when trim(coalesce(p_full_name,'')) = '' then 'Alumna'
    when cardinality(regexp_split_to_array(trim(p_full_name), E'\\s+')) = 1
      then split_part(trim(p_full_name), ' ', 1)
    else
      (regexp_split_to_array(trim(p_full_name), E'\\s+'))[1]
      || ' '
      || upper(left((regexp_split_to_array(trim(p_full_name), E'\\s+'))[2], 1))
      || '.'
  end;
$$;

revoke all on function private.reward_challenge_masked_name(text)
from public, anon, authenticated;

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

create or replace function public.student_enroll_reward_challenge(
  p_rule_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_student public.students%rowtype;
  v_scope text;
  v_participation_id uuid;
  v_enrollment_id uuid;
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
    raise exception 'challenge_enrollment_not_required';
  end if;

  if v_rule.status not in ('scheduled','active') then
    raise exception 'challenge_not_open';
  end if;

  if v_rule.scheduled_end_at is not null and clock_timestamp() > v_rule.scheduled_end_at then
    raise exception 'challenge_finished';
  end if;

  select * into v_student
  from public.students
  where studio_id = v_rule.studio_id
    and user_id = (select auth.uid())
  order by created_at
  limit 1;

  if not found then raise exception 'student_portal_forbidden'; end if;

  v_scope := coalesce(v_version.audience_definition->>'scope','all_active_students');
  if v_scope = 'all_active_students'
     and not (v_student.active = true and v_student.lifecycle_status = 'active') then
    raise exception 'challenge_not_eligible';
  end if;

  insert into public.reward_challenge_enrollments(
    studio_id, rule_id, student_id, status, enrolled_at, withdrawn_at
  ) values (
    v_rule.studio_id, v_rule.id, v_student.id, 'active', clock_timestamp(), null
  )
  on conflict (rule_id, student_id) do update
  set status = 'active',
      enrolled_at = case
        when public.reward_challenge_enrollments.status = 'active'
          then public.reward_challenge_enrollments.enrolled_at
        else clock_timestamp()
      end,
      withdrawn_at = null,
      updated_at = clock_timestamp()
  returning id into v_enrollment_id;

  if v_rule.status = 'active'
     and (v_rule.scheduled_start_at is null or clock_timestamp() >= v_rule.scheduled_start_at) then
    v_participation_id := private.reward_rule_materialize_participation_internal(
      v_rule.id,
      v_student.id
    );
  end if;

  return jsonb_build_object(
    'enrollment_id', v_enrollment_id,
    'participation_id', v_participation_id,
    'enrolled', true
  );
end;
$$;

revoke all on function public.student_enroll_reward_challenge(uuid)
from public, anon;
grant execute on function public.student_enroll_reward_challenge(uuid)
to authenticated;

create or replace function public.student_reward_challenge_leaderboard(
  p_rule_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      order by ps.calculated_at desc, ps.id desc
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
      order by ps.calculated_at desc, ps.id desc
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
$$;

revoke all on function public.student_reward_challenge_leaderboard(uuid)
from public, anon;
grant execute on function public.student_reward_challenge_leaderboard(uuid)
to authenticated;

-- Data API access remains least privilege: students use RPCs; admins may read
-- enrollment rows under RLS for participant counts and diagnostics.
