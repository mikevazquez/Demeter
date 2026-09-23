-- EVALUACIONES-03 · Normalize legacy cycles before adaptive diagnostics.
update public.student_evaluation_cycles c
set active = false,
    next_due_on = null,
    updated_at = now()
where c.active = true
  and not exists (
    select 1
    from public.technical_evaluations e
    where e.studio_id = c.studio_id
      and e.student_id = c.student_id
      and e.discipline_id = c.discipline_id
      and e.status = 'published'
      and e.evaluation_purpose in ('diagnostic','placement')
      and e.resulting_discipline_level_id is not null
  );
