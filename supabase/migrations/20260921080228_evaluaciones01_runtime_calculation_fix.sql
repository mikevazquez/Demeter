
-- EVALUACIONES-01 · Fix PL/pgSQL output-variable qualification in recalc.

create or replace function private.evaluations_recalculate(
  p_evaluation_id uuid
)
returns table (
  total_score numeric,
  automatic_outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
  v_version public.evaluation_template_versions;
  v_incomplete boolean;
  v_mandatory_failed boolean;
  v_criterion_failed boolean;
  v_total numeric(5,2);
  v_outcome text;
begin
  select * into v_evaluation
  from public.technical_evaluations
  where id = p_evaluation_id;

  if v_evaluation.id is null then
    raise exception 'evaluation_not_found';
  end if;

  select * into v_version
  from public.evaluation_template_versions
  where id = v_evaluation.template_version_id;

  delete from public.technical_evaluation_criterion_results
  where evaluation_id = p_evaluation_id;

  insert into public.technical_evaluation_criterion_results (
    studio_id,
    evaluation_id,
    template_criterion_id,
    score_percent,
    weighted_points,
    passed
  )
  select
    v_evaluation.studio_id,
    p_evaluation_id,
    c.id,
    coalesce(
      round(
        (
          sum(
            case
              when x.scored and x.score is not null
                then least(x.score / nullif(x.max_score, 0), 1)
              else 0
            end
          )
          /
          nullif(sum(case when x.scored then 1 else 0 end), 0)
        ) * 100,
        2
      ),
      0
    ) as score_percent,
    round(
      coalesce(
        (
          sum(
            case
              when x.scored and x.score is not null
                then least(x.score / nullif(x.max_score, 0), 1)
              else 0
            end
          )
          /
          nullif(sum(case when x.scored then 1 else 0 end), 0)
        ),
        0
      ) * c.weight_percent,
      2
    ) as weighted_points,
    coalesce(
      (
        coalesce(
          (
            sum(
              case
                when x.scored and x.score is not null
                  then least(x.score / nullif(x.max_score, 0), 1)
                else 0
              end
            )
            /
            nullif(sum(case when x.scored then 1 else 0 end), 0)
          ),
          0
        ) * 100
      ) >= coalesce(c.min_percent, v_version.default_category_min),
      false
    ) as passed
  from public.evaluation_template_criteria c
  left join (
    select
      te.criterion_id,
      te.scored,
      te.max_score,
      er.score
    from public.evaluation_template_elements te
    left join public.technical_evaluation_element_results er
      on er.template_element_id = te.id
     and er.evaluation_id = p_evaluation_id
    where te.template_version_id = v_evaluation.template_version_id
    union all
    select
      tc.criterion_id,
      tc.scored,
      tc.max_score,
      cr.score
    from public.evaluation_template_combos tc
    left join public.technical_evaluation_combo_results cr
      on cr.template_combo_id = tc.id
     and cr.evaluation_id = p_evaluation_id
    where tc.template_version_id = v_evaluation.template_version_id
  ) x on x.criterion_id = c.id
  where c.template_version_id = v_evaluation.template_version_id
  group by c.id, c.weight_percent, c.min_percent, v_version.default_category_min;

  select coalesce(sum(r.weighted_points), 0)
    into v_total
  from public.technical_evaluation_criterion_results r
  where r.evaluation_id = p_evaluation_id;

  select exists (
    select 1
    from public.evaluation_template_elements te
    left join public.technical_evaluation_element_results er
      on er.template_element_id = te.id
     and er.evaluation_id = p_evaluation_id
    where te.template_version_id = v_evaluation.template_version_id
      and te.mandatory
      and coalesce(er.result_status, 'not_evaluated') = 'not_evaluated'
  )
  or exists (
    select 1
    from public.evaluation_template_combos tc
    left join public.technical_evaluation_combo_results cr
      on cr.template_combo_id = tc.id
     and cr.evaluation_id = p_evaluation_id
    where tc.template_version_id = v_evaluation.template_version_id
      and tc.mandatory
      and coalesce(cr.result_status, 'not_evaluated') = 'not_evaluated'
  )
  into v_incomplete;

  select exists (
    select 1
    from public.evaluation_template_elements te
    join public.technical_evaluation_element_results er
      on er.template_element_id = te.id
     and er.evaluation_id = p_evaluation_id
    where te.template_version_id = v_evaluation.template_version_id
      and te.mandatory
      and er.result_status = 'does_not_meet'
  )
  or exists (
    select 1
    from public.evaluation_template_combos tc
    join public.technical_evaluation_combo_results cr
      on cr.template_combo_id = tc.id
     and cr.evaluation_id = p_evaluation_id
    where tc.template_version_id = v_evaluation.template_version_id
      and tc.mandatory
      and cr.result_status = 'does_not_meet'
  )
  into v_mandatory_failed;

  select exists (
    select 1
    from public.technical_evaluation_criterion_results r
    where r.evaluation_id = p_evaluation_id
      and not r.passed
  )
  into v_criterion_failed;

  v_outcome :=
    case
      when v_incomplete then 'incomplete'
      when v_mandatory_failed then 'stays'
      when v_criterion_failed then 'stays'
      when v_total < v_version.pass_threshold then 'stays'
      else 'approved'
    end;

  update public.technical_evaluations
  set
    automatic_outcome = v_outcome,
    total_score = v_total,
    updated_at = now(),
    last_saved_at = now()
  where id = p_evaluation_id;

  total_score := v_total;
  automatic_outcome := v_outcome;
  return next;
end;
$$;

revoke all on function private.evaluations_recalculate(uuid)
from public, anon, authenticated, service_role;
