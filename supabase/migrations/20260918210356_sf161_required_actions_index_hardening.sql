create index required_actions_assignee_user_idx
  on public.required_actions(assignee_user_id)
  where assignee_user_id is not null;

create index required_actions_student_fk_idx
  on public.required_actions(student_id)
  where student_id is not null;

create index required_actions_class_session_fk_idx
  on public.required_actions(class_session_id)
  where class_session_id is not null;

create index required_actions_created_by_user_idx
  on public.required_actions(created_by_user_id)
  where created_by_user_id is not null;
