
-- RETOS-01 · competitive settlement. Prizes are awarded from final leaderboard,
-- never from per-student threshold fulfillment during the competition.

create table if not exists public.reward_challenge_settlements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_id uuid not null references public.reward_rules(id) on delete cascade,
  status text not null check (status in ('settled','no_winner')),
  winners jsonb not null default '[]'::jsonb check (jsonb_typeof(winners) = 'array'),
  settled_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint reward_challenge_settlements_rule_unique unique(rule_id)
);

alter table public.reward_challenge_settlements enable row level security;

drop policy if exists reward_challenge_settlements_admin_read on public.reward_challenge_settlements;
create policy reward_challenge_settlements_admin_read
on public.reward_challenge_settlements
for select
to authenticated
using (private.has_capability(studio_id, 'rewards.read'));

revoke all on table public.reward_challenge_settlements from public, anon, authenticated, service_role;
grant select on table public.reward_challenge_settlements to authenticated, service_role;
grant insert, update on table public.reward_challenge_settlements to service_role;

create or replace function private.reward_challenge_rank(
  p_rule_id uuid
)
returns table (
  student_id uuid,
  score numeric,
  reached_at timestamptz,
  rank_position integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      order by ps.calculated_at desc, ps.id desc
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
$$;

revoke all on function private.reward_challenge_rank(uuid)
from public, anon, authenticated;

create or replace function private.settle_reward_challenge_internal(
  p_rule_id uuid,
  p_force boolean default false,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_existing public.reward_challenge_settlements%rowtype;
  v_item jsonb;
  v_kind public.reward_kind;
  v_delivery public.reward_delivery_mode;
  v_winner_count integer;
  v_tie_breaker text;
  v_winners jsonb := '[]'::jsonb;
  v_winner record;
  v_reward_id uuid;
  v_reward_status public.reward_instance_status;
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_validity_days integer;
  v_reward_key text;
begin
  select * into v_rule
  from public.reward_rules
  where id = p_rule_id
  for update;

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

  select * into v_existing
  from public.reward_challenge_settlements
  where rule_id = v_rule.id;

  if found then
    return jsonb_build_object(
      'settlement_id', v_existing.id,
      'status', v_existing.status,
      'winners', v_existing.winners,
      'created', false
    );
  end if;

  if not p_force
     and (v_rule.scheduled_end_at is null or v_rule.scheduled_end_at > v_now) then
    raise exception 'challenge_not_due';
  end if;

  v_winner_count := least(
    3,
    greatest(1, coalesce((v_version.presentation_definition->>'winner_count')::integer, 1))
  );
  v_tie_breaker := coalesce(
    nullif(v_version.presentation_definition->>'tie_breaker',''),
    'first_to_reach'
  );

  if jsonb_typeof(v_version.presentation_definition->'competition_reward_definition'->'rewards') = 'array' then
    select value
      into v_item
    from jsonb_array_elements(
      v_version.presentation_definition->'competition_reward_definition'->'rewards'
    )
    where jsonb_typeof(value) = 'object'
      and value->>'kind' <> 'badge'
    limit 1;
  end if;

  if v_item is not null then
    v_kind := private.reward_kind_from_definition(v_item);
    v_delivery := private.reward_delivery_from_definition(v_item);
    v_validity_days := private.reward_nonnegative_integer(v_item, 'validity_days');
    v_reward_key := coalesce(nullif(v_item->>'key',''), 'benefit');
  end if;

  for v_winner in
    select rank.student_id, rank.score, rank.rank_position
    from private.reward_challenge_rank(v_rule.id) rank
    where rank.rank_position <= v_winner_count
      and rank.score > 0
    order by rank.rank_position, rank.student_id
  loop
    v_winners := v_winners || jsonb_build_array(
      jsonb_build_object(
        'student_id', v_winner.student_id,
        'position', v_winner.rank_position,
        'score', v_winner.score
      )
    );

    if v_item is not null then
      v_expires_at := case
        when v_validity_days is null then null
        else v_now + make_interval(days => v_validity_days)
      end;
      v_reward_status := case when v_delivery = 'redeem' then 'available' else 'blocked' end;
      v_reward_id := null;

      insert into public.reward_instances (
        studio_id,
        student_id,
        rule_id,
        version_number,
        cycle_id,
        kind,
        status,
        idempotency_key,
        benefit_definition,
        origin_snapshot,
        available_from,
        expires_at,
        manually_granted,
        reward_key,
        delivery_mode,
        source_evaluation_id
      )
      select
        v_rule.studio_id,
        v_winner.student_id,
        v_rule.id,
        v_rule.current_version_number,
        (
          select c.id
          from public.reward_cycles c
          join public.reward_participations p on p.id = c.participation_id
          where p.rule_id = v_rule.id
            and p.student_id = v_winner.student_id
          order by c.updated_at desc, c.created_at desc, c.id desc
          limit 1
        ),
        v_kind,
        v_reward_status,
        'challenge-settlement:' || v_rule.id::text || ':' || v_winner.student_id::text || ':' || v_reward_key,
        v_item,
        jsonb_build_object(
          'source', 'competitive_challenge_settlement',
          'position', v_winner.rank_position,
          'score', v_winner.score,
          'tie_breaker', v_tie_breaker
        ),
        v_now,
        v_expires_at,
        false,
        v_reward_key,
        v_delivery,
        null
      on conflict (studio_id, idempotency_key) do nothing
      returning id into v_reward_id;

      if v_reward_id is not null then
        insert into public.reward_instance_events(
          studio_id,
          reward_instance_id,
          event_type,
          from_status,
          to_status,
          actor_user_id,
          details,
          occurred_at
        ) values (
          v_rule.studio_id,
          v_reward_id,
          'created',
          null,
          v_reward_status,
          p_actor_user_id,
          jsonb_build_object(
            'source', 'competitive_challenge_settlement',
            'position', v_winner.rank_position,
            'score', v_winner.score
          ),
          v_now
        );

        if v_reward_status = 'available' then
          insert into public.reward_instance_events(
            studio_id,
            reward_instance_id,
            event_type,
            from_status,
            to_status,
            actor_user_id,
            details,
            occurred_at
          ) values (
            v_rule.studio_id,
            v_reward_id,
            'unlocked',
            'blocked',
            'available',
            p_actor_user_id,
            jsonb_build_object('reason','competitive_challenge_winner'),
            v_now
          );
        end if;
      end if;
    end if;
  end loop;

  insert into public.reward_challenge_settlements(
    studio_id, rule_id, status, winners, settled_at
  ) values (
    v_rule.studio_id,
    v_rule.id,
    case when jsonb_array_length(v_winners) > 0 then 'settled' else 'no_winner' end,
    v_winners,
    v_now
  )
  returning * into v_existing;

  if v_rule.status in ('active','paused','scheduled') then
    update public.reward_rules
    set status = 'finished',
        finished_at = v_now,
        updated_by_user_id = p_actor_user_id,
        updated_at = v_now
    where id = v_rule.id;

    insert into public.reward_rule_lifecycle(
      studio_id, rule_id, operation, from_status, to_status,
      version_number, actor_user_id, note, created_at
    ) values (
      v_rule.studio_id,
      v_rule.id,
      'finished',
      v_rule.status,
      'finished',
      v_rule.current_version_number,
      p_actor_user_id,
      case when p_force then 'competitive_challenge_manual_settlement' else 'competitive_challenge_period_ended' end,
      v_now
    );
  end if;

  return jsonb_build_object(
    'settlement_id', v_existing.id,
    'status', v_existing.status,
    'winners', v_winners,
    'created', true
  );
end;
$$;

revoke all on function private.settle_reward_challenge_internal(uuid,boolean,uuid)
from public, anon, authenticated, service_role;

create or replace function public.admin_settle_reward_challenge(
  p_rule_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;

  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then raise exception 'challenge_not_found'; end if;
  if not private.has_capability(v_rule.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;

  return private.settle_reward_challenge_internal(p_rule_id, true, v_user_id);
end;
$$;

revoke all on function public.admin_settle_reward_challenge(uuid)
from public, anon;
grant execute on function public.admin_settle_reward_challenge(uuid)
to authenticated;

create or replace function public.system_settle_due_reward_challenges()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_count integer := 0;
begin
  for v_rule in
    select r.id
    from public.reward_rules r
    join public.reward_rule_versions v
      on v.rule_id = r.id
     and v.version_number = r.current_version_number
    where r.status in ('active','paused','scheduled')
      and r.scheduled_end_at is not null
      and r.scheduled_end_at <= clock_timestamp()
      and v.family = 'challenge'
      and coalesce(v.presentation_definition->>'competition_mode','individual') = 'leaderboard'
      and not exists (
        select 1
        from public.reward_challenge_settlements s
        where s.rule_id = r.id
      )
  loop
    begin
      perform private.settle_reward_challenge_internal(v_rule.id, false, null);
      v_count := v_count + 1;
    exception when others then
      null;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.system_settle_due_reward_challenges()
from public, anon, authenticated;
grant execute on function public.system_settle_due_reward_challenges()
to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('retos01-settle-competitive');
    exception when others then null;
    end;
    perform cron.schedule(
      'retos01-settle-competitive',
      '*/10 * * * *',
      'select public.system_settle_due_reward_challenges();'
    );
  end if;
end
$$;
