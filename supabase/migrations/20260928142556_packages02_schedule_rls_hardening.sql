drop policy if exists "product_template_schedules_read"
on public.product_template_schedules;

drop policy if exists "product_template_schedules_student_portal_read"
on public.product_template_schedules;

create policy "product_template_schedules_read"
on public.product_template_schedules
for select
to authenticated
using (
  (select private.has_capability(product_template_schedules.studio_id, 'products.read'))
  or private.has_capability(product_template_schedules.studio_id, 'student.portal')
);
