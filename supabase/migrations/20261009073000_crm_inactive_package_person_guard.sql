-- Legacy student rows without a person identity are outside the unified CRM.
create or replace function private.refresh_crm_lifecycle_history()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_inserted integer;
begin
  with source as (
    select s.id student_id,s.studio_id,s.person_id,
      coalesce(cfg.inactivity_days,15) inactivity_days,
      coalesce(pkg.inactive_since,enr.inactive_since,s.created_at::date) inactive_since,
      exists (
        select 1 from public.product_acquisitions pa
        join public.product_templates pt on pt.id=pa.product_template_id and pt.studio_id=pa.studio_id
        where pa.studio_id=s.studio_id and pa.student_id=s.id and pa.refunded_at is null
          and pa.status='active' and pt.product_type='package'
          and pa.starts_on <= current_date and pa.expires_on >= current_date
      ) has_active_package
    from public.students s
    left join public.crm_lifecycle_settings cfg on cfg.studio_id=s.studio_id
    left join lateral (
      select max(pa.expires_on) inactive_since
      from public.product_acquisitions pa
      join public.product_templates pt on pt.id=pa.product_template_id and pt.studio_id=pa.studio_id
      where pa.studio_id=s.studio_id and pa.student_id=s.id and pa.refunded_at is null
        and pa.status <> 'cancelled' and pa.starts_on <= current_date and pt.product_type='package'
    ) pkg on true
    left join lateral (
      select max(e.starts_on) inactive_since
      from public.student_enrollments e
      where e.studio_id=s.studio_id and e.student_id=s.id and e.refunded_at is null
        and e.status <> 'cancelled'
    ) enr on true
    where s.archived_at is null and s.active and s.lifecycle_status='active'
      and s.student_type='regular' and s.person_id is not null
  ), projected as (
    select source.*,
      case when not has_active_package
        and current_date - inactive_since >= inactivity_days
        then 'former_student' else 'student' end to_type
    from source
  ), latest as (
    select distinct on (h.student_id) h.student_id,h.to_type
    from public.crm_lifecycle_history h
    order by h.student_id,h.changed_at desc,h.id desc
  ), changed as (
    select p.*,coalesce(l.to_type,'student') from_type
    from projected p left join latest l using(student_id)
    where coalesce(l.to_type,'student') <> p.to_type
  )
  insert into public.crm_lifecycle_history(studio_id,student_id,person_id,from_type,to_type,inactivity_days,inactive_since)
  select studio_id,student_id,person_id,from_type,to_type,inactivity_days,inactive_since from changed;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;
