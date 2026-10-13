create index if not exists product_acquisitions_loyalty_source_idx
  on public.product_acquisitions(studio_id, student_id, starts_on, expires_on, created_at)
  where sale_line_id is not null;

create or replace function private.reward_loyalty_frozen_days(
  p_rule_id uuid,
  p_version_number integer,
  p_student_id uuid,
  p_from_date date,
  p_to_date date
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with loyalty_cycles as (
    select c.id
    from public.reward_cycles c
    join public.reward_participations p
      on p.studio_id = c.studio_id
     and p.id = c.participation_id
    where p.rule_id = p_rule_id
      and p.student_id = p_student_id
      and c.version_number = p_version_number
      and c.cycle_key = 'loyalty:v' || p_version_number::text
  ),
  transitions as (
    select
      e.operation,
      e.occurred_at,
      lead(e.operation) over (
        partition by e.cycle_id
        order by e.occurred_at, e.id
      ) as next_operation,
      lead(e.occurred_at) over (
        partition by e.cycle_id
        order by e.occurred_at, e.id
      ) as next_occurred_at
    from public.reward_cycle_events e
    join loyalty_cycles c on c.id = e.cycle_id
    where e.operation in ('frozen', 'resumed')
  ),
  ranges as (
    select
      occurred_at::date as freeze_start,
      case
        when next_operation = 'resumed' then next_occurred_at::date
        else p_to_date
      end as freeze_end
    from transitions
    where operation = 'frozen'
  )
  select coalesce(
    sum(
      greatest(
        least(freeze_end, p_to_date)
        - greatest(freeze_start, p_from_date)
        + 1,
        0
      )
    ),
    0
  )::integer
  from ranges
  where p_from_date is not null
    and p_to_date is not null
    and p_from_date <= p_to_date
    and freeze_end >= p_from_date
    and freeze_start <= p_to_date;
$$;

revoke all on function private.reward_loyalty_frozen_days(uuid,integer,uuid,date,date)
from public, anon, authenticated, service_role;

create or replace function public.system_compute_reward_loyalty_state(
  p_rule_id uuid,
  p_version_number integer,
  p_student_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_student_studio_id uuid;
  v_timezone text;
  v_as_of date;
  v_eligibility_start date;
  v_allow_historical boolean;
  v_count_zero_value boolean;
  v_count_unpaid boolean;
  v_grace_days integer := 0;
  v_candidate record;
  v_paid_minor integer;
  v_effective_start date;
  v_gap_calendar integer;
  v_gap_frozen integer;
  v_gap_effective integer;
  v_current_coverage_start date;
  v_current_coverage_end date;
  v_total_paid_periods integer := 0;
  v_current_streak integer := 0;
  v_best_streak integer := 0;
  v_days_since_coverage integer := 0;
  v_frozen_since_coverage integer := 0;
  v_effective_days_since_coverage integer := 0;
  v_active_coverage boolean := false;
  v_in_grace boolean := false;
  v_counted jsonb := '[]'::jsonb;
  v_excluded jsonb := '[]'::jsonb;
begin
  if p_rule_id is null
     or p_version_number is null
     or p_version_number < 1 then
    raise exception 'reward_loyalty_rule_version_required';
  end if;

  if p_student_id is null then
    raise exception 'reward_loyalty_student_required';
  end if;

  select *
    into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then
    raise exception 'reward_rule_not_found';
  end if;

  if v_rule.status <> 'active' then
    raise exception 'reward_loyalty_rule_not_active';
  end if;

  select *
    into v_version
  from public.reward_rule_versions
  where rule_id = p_rule_id
    and version_number = p_version_number;

  if not found then
    raise exception 'reward_rule_version_not_found';
  end if;

  if v_version.studio_id <> v_rule.studio_id then
    raise exception 'reward_rule_version_studio_mismatch';
  end if;

  if v_version.family <> 'loyalty' then
    raise exception 'reward_loyalty_family_required';
  end if;

  select s.studio_id
    into v_student_studio_id
  from public.students s
  where s.id = p_student_id;

  if v_student_studio_id is null then
    raise exception 'reward_student_not_found';
  end if;

  if v_student_studio_id <> v_rule.studio_id then
    raise exception 'reward_student_studio_mismatch';
  end if;

  select timezone
    into v_timezone
  from public.studios
  where id = v_rule.studio_id;

  v_as_of := coalesce(
    p_as_of_date,
    (clock_timestamp() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
  );

  begin
    v_grace_days := coalesce(
      nullif(v_version.evaluation_definition->>'grace_days', '')::integer,
      0
    );
  exception when invalid_text_representation then
    raise exception 'reward_loyalty_grace_days_invalid';
  end;

  if v_grace_days < 0 then
    raise exception 'reward_loyalty_grace_days_invalid';
  end if;

  begin
    v_allow_historical := coalesce(
      nullif(v_version.evaluation_definition->>'allow_historical', '')::boolean,
      false
    );
    v_count_zero_value := coalesce(
      nullif(v_version.evaluation_definition->>'count_zero_value_periods', '')::boolean,
      false
    );
    v_count_unpaid := coalesce(
      nullif(v_version.evaluation_definition->>'count_unpaid_periods', '')::boolean,
      false
    );
  exception when invalid_text_representation then
    raise exception 'reward_loyalty_configuration_invalid';
  end;

  if not v_allow_historical then
    v_eligibility_start := greatest(
      coalesce(
        (v_rule.first_activated_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date,
        (v_version.effective_from at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
      ),
      (v_version.effective_from at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
    );
  end if;

  for v_candidate in
    select
      pa.id as acquisition_id,
      pa.starts_on,
      pa.expires_on,
      pa.status::text as acquisition_status,
      pa.access_blocked,
      pa.refunded_at as acquisition_refunded_at,
      pa.sale_line_id,
      pa.created_at,
      pt.id as product_template_id,
      pt.name as product_name,
      pt.product_type::text as product_type,
      sl.id as source_sale_line_id,
      sl.line_total_minor,
      sl.discount_kind,
      sl.refunded_at as line_refunded_at,
      s.id as sale_id,
      s.status::text as sale_status,
      coalesce(pay.has_line_allocations, false) as has_line_allocations,
      coalesce(pay.line_net_paid_minor, 0) as line_net_paid_minor,
      coalesce(pay.sale_net_paid_minor, 0) as sale_net_paid_minor
    from public.product_acquisitions pa
    join public.product_templates pt
      on pt.id = pa.product_template_id
     and pt.studio_id = pa.studio_id
    left join public.sale_lines sl
      on sl.id = pa.sale_line_id
     and sl.studio_id = pa.studio_id
    left join public.sales s
      on s.id = sl.sale_id
     and s.studio_id = pa.studio_id
    left join lateral (
      select
        coalesce(bool_or(p.sale_line_id = sl.id), false) as has_line_allocations,
        coalesce(sum(
          case
            when p.sale_line_id = sl.id and p.kind = 'payment' then p.amount_minor
            when p.sale_line_id = sl.id and p.kind = 'refund' then -p.amount_minor
            else 0
          end
        ), 0)::integer as line_net_paid_minor,
        coalesce(sum(
          case
            when p.kind = 'payment' then p.amount_minor
            when p.kind = 'refund' then -p.amount_minor
            else 0
          end
        ), 0)::integer as sale_net_paid_minor
      from public.payments p
      where p.sale_id = s.id
        and p.effective_on <= v_as_of
    ) pay on true
    where pa.studio_id = v_rule.studio_id
      and pa.student_id = p_student_id
      and pt.product_type in ('package', 'membership')
    order by pa.starts_on nulls last, pa.expires_on nulls last, pa.created_at, pa.id
  loop
    v_paid_minor := case
      when v_candidate.has_line_allocations then v_candidate.line_net_paid_minor
      else v_candidate.sale_net_paid_minor
    end;

    if v_candidate.starts_on is null or v_candidate.expires_on is null then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'not_in_force'
      ));
      continue;
    end if;

    if v_candidate.acquisition_status = 'cancelled'
       or v_candidate.acquisition_refunded_at is not null
       or v_candidate.line_refunded_at is not null
       or (v_candidate.sale_line_id is not null and v_candidate.sale_status <> 'confirmed') then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'cancelled_or_refunded'
      ));
      continue;
    end if;

    if v_eligibility_start is not null
       and v_candidate.starts_on < v_eligibility_start then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'before_rule_eligibility',
        'starts_on', v_candidate.starts_on
      ));
      continue;
    end if;

    if v_candidate.starts_on > v_as_of then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'future_period',
        'starts_on', v_candidate.starts_on
      ));
      continue;
    end if;

    if v_candidate.sale_line_id is null and not v_count_unpaid then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'not_purchase_backed'
      ));
      continue;
    end if;

    if v_candidate.sale_line_id is not null
       and coalesce(v_candidate.line_total_minor, 0) = 0
       and not v_count_zero_value then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'zero_value_period',
        'discount_kind', v_candidate.discount_kind
      ));
      continue;
    end if;

    if v_candidate.sale_line_id is not null
       and coalesce(v_candidate.line_total_minor, 0) > 0
       and v_paid_minor <= 0
       and not v_count_unpaid then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'payment_not_recorded'
      ));
      continue;
    end if;

    if v_candidate.access_blocked and not v_count_unpaid then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'access_blocked'
      ));
      continue;
    end if;

    if v_current_coverage_end is null then
      v_effective_start := v_candidate.starts_on;
      v_gap_effective := 0;
    else
      v_gap_calendar := greatest(v_candidate.starts_on - v_current_coverage_end - 1, 0);
      v_gap_frozen := case
        when v_gap_calendar > 0 then private.reward_loyalty_frozen_days(
          p_rule_id,
          p_version_number,
          p_student_id,
          v_current_coverage_end + 1,
          v_candidate.starts_on - 1
        )
        else 0
      end;
      v_gap_effective := greatest(v_gap_calendar - v_gap_frozen, 0);

      if v_gap_effective > v_grace_days then
        v_current_streak := 0;
        v_current_coverage_start := null;
        v_effective_start := v_candidate.starts_on;
      elsif v_candidate.starts_on <= v_current_coverage_end then
        v_effective_start := v_current_coverage_end + 1;
      else
        v_effective_start := v_candidate.starts_on;
      end if;
    end if;

    if v_candidate.expires_on < v_effective_start then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'duplicate_coverage',
        'starts_on', v_candidate.starts_on,
        'expires_on', v_candidate.expires_on
      ));
      continue;
    end if;

    if v_effective_start > v_as_of then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
        'acquisition_id', v_candidate.acquisition_id,
        'reason_code', 'queued_overlap',
        'effective_start', v_effective_start,
        'expires_on', v_candidate.expires_on
      ));
      continue;
    end if;

    v_total_paid_periods := v_total_paid_periods + 1;

    if v_current_streak = 0 then
      v_current_streak := 1;
      v_current_coverage_start := v_effective_start;
      v_current_coverage_end := v_candidate.expires_on;
    else
      v_current_streak := v_current_streak + 1;
      v_current_coverage_end := greatest(v_current_coverage_end, v_candidate.expires_on);
    end if;

    v_best_streak := greatest(v_best_streak, v_current_streak);

    v_counted := v_counted || jsonb_build_array(jsonb_build_object(
      'acquisition_id', v_candidate.acquisition_id,
      'product_template_id', v_candidate.product_template_id,
      'product_name', v_candidate.product_name,
      'product_type', v_candidate.product_type,
      'sale_id', v_candidate.sale_id,
      'sale_line_id', v_candidate.source_sale_line_id,
      'starts_on', v_candidate.starts_on,
      'effective_start', v_effective_start,
      'expires_on', v_candidate.expires_on,
      'net_paid_minor', v_paid_minor,
      'gap_days', coalesce(v_gap_effective, 0),
      'streak_after_period', v_current_streak
    ));
  end loop;

  if v_current_coverage_end is not null then
    v_active_coverage := v_as_of <= v_current_coverage_end;

    if not v_active_coverage then
      v_days_since_coverage := greatest(v_as_of - v_current_coverage_end, 0);
      v_frozen_since_coverage := private.reward_loyalty_frozen_days(
        p_rule_id,
        p_version_number,
        p_student_id,
        v_current_coverage_end + 1,
        v_as_of
      );
      v_effective_days_since_coverage := greatest(
        v_days_since_coverage - v_frozen_since_coverage,
        0
      );

      if v_effective_days_since_coverage <= v_grace_days then
        v_in_grace := true;
      else
        v_current_streak := 0;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'rule_id', p_rule_id,
    'version_number', p_version_number,
    'student_id', p_student_id,
    'as_of_date', v_as_of,
    'eligibility_start_date', v_eligibility_start,
    'grace_days', v_grace_days,
    'allow_historical', v_allow_historical,
    'count_zero_value_periods', v_count_zero_value,
    'count_unpaid_periods', v_count_unpaid,
    'current_consecutive_periods', v_current_streak,
    'total_paid_periods', v_total_paid_periods,
    'best_consecutive_periods', v_best_streak,
    'current_coverage_start', v_current_coverage_start,
    'current_coverage_end', v_current_coverage_end,
    'active_coverage', v_active_coverage,
    'in_grace', v_in_grace,
    'effective_days_since_coverage', v_effective_days_since_coverage,
    'counted_periods', v_counted,
    'excluded_periods', v_excluded
  );
end;
$$;

comment on function public.system_compute_reward_loyalty_state(uuid,integer,uuid,date) is
  'SF-237 recalculates loyalty from operational acquisitions, sales and payments. It does not make the loyalty snapshot a source of truth.';

revoke all on function public.system_compute_reward_loyalty_state(uuid,integer,uuid,date)
from public, anon, authenticated;
grant execute on function public.system_compute_reward_loyalty_state(uuid,integer,uuid,date)
to service_role;
