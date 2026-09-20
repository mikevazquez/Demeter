drop policy if exists profiles_select_studio_student_admin on public.profiles;

create policy profiles_select_studio_student_admin
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.students s
    where s.user_id = profiles.id
      and private.has_capability(s.studio_id, 'students.read')
  )
);

insert into public.profile_field_definitions (
  studio_id,
  entity_type,
  key,
  label,
  field_type,
  required,
  active,
  options,
  sort_order
)
select
  s.id,
  'student',
  'birth_date',
  'Fecha de nacimiento',
  'date'::public.profile_field_type,
  false,
  true,
  null,
  50
from public.studios s
on conflict (studio_id, entity_type, key) do nothing;
