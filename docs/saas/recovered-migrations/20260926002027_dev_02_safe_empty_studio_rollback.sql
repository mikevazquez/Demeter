create or replace function public.service_delete_empty_studio(p_studio_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_studio_id is null then
    raise exception 'studio_id_required';
  end if;

  if not exists (
    select 1 from public.studios s where s.id=p_studio_id
  ) then
    raise exception 'studio_not_found';
  end if;

  if exists (select 1 from public.students where studio_id=p_studio_id)
     or exists (select 1 from public.instructors where studio_id=p_studio_id)
     or exists (select 1 from public.disciplines where studio_id=p_studio_id)
     or exists (select 1 from public.class_templates where studio_id=p_studio_id)
     or exists (select 1 from public.recurring_schedules where studio_id=p_studio_id)
     or exists (select 1 from public.class_sessions where studio_id=p_studio_id)
     or exists (select 1 from public.product_templates where studio_id=p_studio_id)
     or exists (select 1 from public.product_acquisitions where studio_id=p_studio_id)
     or exists (select 1 from public.sales where studio_id=p_studio_id)
     or exists (select 1 from public.payments where studio_id=p_studio_id)
     or exists (select 1 from public.studio_documents where studio_id=p_studio_id)
     or exists (select 1 from public.reservations where studio_id=p_studio_id)
     or exists (select 1 from public.automation_instances where studio_id=p_studio_id)
     or exists (select 1 from public.reward_rules where studio_id=p_studio_id)
     or exists (select 1 from public.reward_programs where studio_id=p_studio_id)
     or exists (select 1 from public.domain_events where studio_id=p_studio_id)
  then
    raise exception 'studio_not_empty';
  end if;

  delete from public.notification_rules
  where studio_id=p_studio_id;

  delete from public.studios
  where id=p_studio_id;
end;
$$;

revoke all on function public.service_delete_empty_studio(uuid)
from public, anon, authenticated;
grant execute on function public.service_delete_empty_studio(uuid)
to service_role;
