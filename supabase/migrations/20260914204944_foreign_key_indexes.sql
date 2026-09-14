-- Cover foreign keys used by joins and delete/update checks.
create index class_sessions_coach_user_idx on public.class_sessions(coach_user_id);
create index class_sessions_template_idx on public.class_sessions(template_id);
create index class_templates_discipline_idx on public.class_templates(discipline_id);
create index class_templates_studio_idx on public.class_templates(studio_id);
create index packages_studio_idx on public.packages(studio_id);
create index reservations_student_package_idx on public.reservations(student_package_id);
create index reservations_studio_idx on public.reservations(studio_id);
create index student_packages_package_idx on public.student_packages(package_id);
create index student_packages_studio_idx on public.student_packages(studio_id);
