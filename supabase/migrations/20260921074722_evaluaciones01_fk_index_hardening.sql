
create index if not exists student_discipline_levels_student_fk_idx
  on public.student_discipline_levels(student_id);

create index if not exists student_discipline_levels_discipline_fk_idx
  on public.student_discipline_levels(discipline_id);
