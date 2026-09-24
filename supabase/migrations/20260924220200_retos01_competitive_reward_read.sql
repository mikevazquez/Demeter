
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


-- RETOS-01 · winner credit claims.
-- Credit prizes are claimed into an independent acquisition/wallet so they do
-- not mutate the student's current package. The wallet uses the normal credit
-- ledger and booking flow, including reservation holds and cancellation returns.

alter table public.product_templates
add column if not exists reward_credit_wallet boolean not null default false;

create index if not exists product_templates_reward_credit_wallet_idx
on public.product_templates(studio_id)
where reward_credit_wallet;

create table if not exists public.reward_credit_claims (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  reward_instance_id uuid not null references public.reward_instances(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete cascade,
  acquisition_id uuid not null references public.product_acquisitions(id) on delete restrict,
  credits integer not null check (credits > 0),
  claimed_at timestamptz not null default clock_timestamp(),
  expires_on date not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint reward_credit_claims_reward_unique unique(reward_instance_id),
  constraint reward_credit_claims_acquisition_unique unique(acquisition_id)
);

alter table public.reward_credit_claims enable row level security;

drop policy if exists reward_credit_claims_student_read
on public.reward_credit_claims;

create policy reward_credit_claims_student_read
on public.reward_credit_claims
for select
to authenticated
using (
  exists (
    select 1
    from public.students s
    where s.id = reward_credit_claims.student_id
      and s.studio_id = reward_credit_claims.studio_id
      and s.user_id = (select auth.uid())
      and private.has_capability(reward_credit_claims.studio_id, 'student.portal')
  )
);

revoke all on table public.reward_credit_claims
from public, anon, authenticated, service_role;
grant select on table public.reward_credit_claims to authenticated, service_role;
grant insert, update on table public.reward_credit_claims to service_role;

create or replace function private.link_reward_credit_wallet_to_new_discipline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_template_disciplines(
    studio_id,
    product_template_id,
    discipline_id
  )
  select
    new.studio_id,
    pt.id,
    new.id
  from public.product_templates pt
  where pt.studio_id = new.studio_id
    and pt.reward_credit_wallet
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists disciplines_link_reward_credit_wallet
on public.disciplines;

create trigger disciplines_link_reward_credit_wallet
after insert on public.disciplines
for each row execute function private.link_reward_credit_wallet_to_new_discipline();

create or replace function public.student_claim_reward_credits(
  p_reward_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_student public.students%rowtype;
  v_existing public.reward_credit_claims%rowtype;
  v_template_id uuid;
  v_template_name text;
  v_acquisition_id uuid;
  v_credits integer;
  v_validity_days integer;
  v_timezone text;
  v_now timestamptz := clock_timestamp();
  v_starts_on date;
  v_expires_on date;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required';
  end if;

  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then
    raise exception 'reward_instance_not_found';
  end if;

  select *
    into v_student
  from public.students
  where id = v_reward.student_id
    and studio_id = v_reward.studio_id
    and user_id = (select auth.uid())
  order by created_at
  limit 1;

  if not found then
    raise exception 'reward_not_owned';
  end if;

  if not private.has_capability(v_reward.studio_id, 'student.portal') then
    raise exception 'forbidden';
  end if;

  select *
    into v_existing
  from public.reward_credit_claims
  where reward_instance_id = v_reward.id;

  if found then
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'claim_id', v_existing.id,
      'acquisition_id', v_existing.acquisition_id,
      'credits', v_existing.credits,
      'expires_on', v_existing.expires_on
    );
  end if;

  if v_reward.kind <> 'credits' then
    raise exception 'reward_not_credit';
  end if;

  if v_reward.delivery_mode <> 'redeem' then
    raise exception 'reward_claim_delivery_invalid';
  end if;

  if v_reward.status <> 'available' then
    raise exception 'reward_not_claimable';
  end if;

  if v_reward.available_from is not null and v_reward.available_from > v_now then
    raise exception 'reward_not_available_yet';
  end if;

  if v_reward.expires_at is not null and v_reward.expires_at < v_now then
    raise exception 'reward_expired';
  end if;

  v_credits := private.reward_nonnegative_integer(v_reward.benefit_definition, 'credits');
  if v_credits is null or v_credits <= 0 then
    raise exception 'reward_credit_amount_invalid';
  end if;

  v_validity_days := greatest(
    1,
    coalesce(
      private.reward_nonnegative_integer(v_reward.benefit_definition, 'validity_days'),
      30
    )
  );

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_reward.studio_id;

  v_starts_on := (v_now at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;
  v_expires_on := v_starts_on + v_validity_days;
  v_template_name := format(
    'Créditos de recompensa · %s · %s días',
    v_credits,
    v_validity_days
  );

  insert into public.product_templates(
    studio_id,
    name,
    description,
    product_type,
    price_minor,
    currency,
    credit_limit,
    validity_days,
    unlimited,
    active,
    package_term,
    online_purchasable,
    reward_discount_eligible,
    reward_credit_wallet
  ) values (
    v_reward.studio_id,
    v_template_name,
    'Saldo independiente obtenido por retos y recompensas.',
    'other',
    0,
    'MXN',
    v_credits,
    v_validity_days,
    false,
    true,
    null,
    false,
    false,
    true
  )
  on conflict (studio_id, name)
  do nothing;

  select id
    into v_template_id
  from public.product_templates
  where studio_id = v_reward.studio_id
    and name = v_template_name
    and reward_credit_wallet
    and credit_limit = v_credits
    and validity_days = v_validity_days
  limit 1;

  if v_template_id is null then
    raise exception 'reward_credit_template_missing';
  end if;

  insert into public.product_template_disciplines(
    studio_id,
    product_template_id,
    discipline_id
  )
  select
    v_reward.studio_id,
    v_template_id,
    d.id
  from public.disciplines d
  where d.studio_id = v_reward.studio_id
  on conflict do nothing;

  insert into public.product_acquisitions(
    studio_id,
    student_id,
    product_template_id,
    status,
    starts_on,
    expires_on,
    credit_limit,
    unlimited,
    activation_mode,
    access_blocked,
    validity_days_snapshot,
    created_at,
    updated_at
  ) values (
    v_reward.studio_id,
    v_reward.student_id,
    v_template_id,
    'active',
    v_starts_on,
    v_expires_on,
    v_credits,
    false,
    'fixed_date',
    false,
    v_validity_days,
    v_now,
    v_now
  )
  returning id into v_acquisition_id;

  insert into public.credit_ledger(
    studio_id,
    acquisition_id,
    movement_type,
    quantity,
    reservation_id,
    note,
    created_by,
    created_at
  ) values (
    v_reward.studio_id,
    v_acquisition_id,
    'grant',
    v_credits,
    null,
    format('%s crédito(s) reclamados desde una recompensa', v_credits),
    (select auth.uid()),
    v_now
  );

  insert into public.reward_credit_claims(
    studio_id,
    reward_instance_id,
    student_id,
    acquisition_id,
    credits,
    claimed_at,
    expires_on,
    created_at
  ) values (
    v_reward.studio_id,
    v_reward.id,
    v_reward.student_id,
    v_acquisition_id,
    v_credits,
    v_now,
    v_expires_on,
    v_now
  )
  returning * into v_existing;

  perform public.system_redeem_reward(
    v_reward.id,
    jsonb_build_object(
      'source', 'reward_credit_claim',
      'acquisition_id', v_acquisition_id,
      'credits', v_credits,
      'starts_on', v_starts_on,
      'expires_on', v_expires_on
    ),
    true
  );

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'claim_id', v_existing.id,
    'acquisition_id', v_acquisition_id,
    'credits', v_credits,
    'expires_on', v_expires_on
  );
end;
$$;

revoke all on function public.student_claim_reward_credits(uuid)
from public, anon;
grant execute on function public.student_claim_reward_credits(uuid)
to authenticated;
