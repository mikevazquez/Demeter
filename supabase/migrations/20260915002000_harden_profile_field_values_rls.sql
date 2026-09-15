drop policy if exists profile_field_values_staff_read on public.profile_field_values;
drop policy if exists profile_field_values_staff_write on public.profile_field_values;

create policy profile_field_values_scoped_read
on public.profile_field_values
for select
to authenticated
using (
  exists (
    select 1
    from public.profile_field_definitions d
    where d.id = profile_field_values.definition_id
      and d.studio_id = profile_field_values.studio_id
      and (
        (
          d.entity_type = 'student'
          and (
            private.has_capability(profile_field_values.studio_id, 'students.read')
            or exists (
              select 1
              from public.students s
              where s.person_id = profile_field_values.person_id
                and s.user_id = (select auth.uid())
            )
          )
        )
        or (
          d.entity_type = 'instructor'
          and private.has_capability(profile_field_values.studio_id, 'instructors.read')
        )
      )
  )
);

create policy profile_field_values_scoped_write
on public.profile_field_values
for all
to authenticated
using (
  exists (
    select 1
    from public.profile_field_definitions d
    where d.id = profile_field_values.definition_id
      and d.studio_id = profile_field_values.studio_id
      and (
        (d.entity_type = 'student' and private.has_capability(profile_field_values.studio_id, 'students.write'))
        or (d.entity_type = 'instructor' and private.has_capability(profile_field_values.studio_id, 'instructors.write'))
      )
  )
)
with check (
  exists (
    select 1
    from public.profile_field_definitions d
    where d.id = profile_field_values.definition_id
      and d.studio_id = profile_field_values.studio_id
      and (
        (d.entity_type = 'student' and private.has_capability(profile_field_values.studio_id, 'students.write'))
        or (d.entity_type = 'instructor' and private.has_capability(profile_field_values.studio_id, 'instructors.write'))
      )
  )
);
