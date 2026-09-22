-- EVALUACIONES v2 · expose placement/progression context to the student result view.

create or replace function public.student_evaluation_result_detail(
  p_evaluation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student.id is null then
    raise exception 'student_context_not_found';
  end if;

  select jsonb_build_object(
    'id', e.id,
    'discipline_id', e.discipline_id,
    'discipline_name', d.name,
    'evaluation_purpose', e.evaluation_purpose,
    'evaluated_level_title', target_def.title,
    'resulting_level_title', result_def.title,
    'evaluation_date', e.evaluation_date,
    'total_score', e.total_score,
    'final_outcome', e.final_outcome,
    'strengths', e.strengths,
    'improvement_areas', e.improvement_areas,
    'coach_message', e.coach_message,
    'next_objective', e.next_objective,
    'published_at', e.published_at,
    'next_due_on', c.next_due_on,
    'cadence_months', c.cadence_months,
    'criteria', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'label', etc.label,
            'weight_percent', etc.weight_percent,
            'min_percent', etc.min_percent,
            'score_percent', er.score_percent,
            'weighted_points', er.weighted_points,
            'passed', er.passed
          )
          order by etc.sort_order
        )
        from public.technical_evaluation_criterion_results er
        join public.evaluation_template_criteria etc
          on etc.id = er.template_criterion_id
        where er.evaluation_id = e.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.technical_evaluations e
  join public.disciplines d on d.id = e.discipline_id
  join public.discipline_technical_levels target_dl on target_dl.id = e.target_discipline_level_id
  join public.technical_level_definitions target_def on target_def.id = target_dl.technical_level_id
  left join public.discipline_technical_levels result_dl
    on result_dl.id = e.resulting_discipline_level_id
  left join public.technical_level_definitions result_def
    on result_def.id = result_dl.technical_level_id
  left join public.student_evaluation_cycles c
    on c.studio_id = e.studio_id
   and c.student_id = e.student_id
   and c.discipline_id = e.discipline_id
   and c.active = true
  where e.id = p_evaluation_id
    and e.studio_id = v_student.studio_id
    and e.student_id = v_student.id
    and e.status = 'published';

  if v_result is null then
    raise exception 'evaluation_result_not_found';
  end if;

  return v_result;
end;
$$;
