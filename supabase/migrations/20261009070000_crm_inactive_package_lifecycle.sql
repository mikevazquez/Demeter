-- Configurable CRM lifecycle: an active regular student without a current package
-- becomes an alumna/exalumna contact after the configured grace period. This does
-- not change the operational student record, access, credits, sales, or attendance.
create table public.crm_lifecycle_settings (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  inactivity_days integer not null default 15 check (inactivity_days between 1 and 365),
  updated_at timestamptz not null default now()
);

create table public.crm_lifecycle_history (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  from_type text not null check (from_type in ('student','former_student')),
  to_type text not null check (to_type in ('student','former_student')),
  inactivity_days integer not null check (inactivity_days between 1 and 365),
  inactive_since date not null,
  changed_at timestamptz not null default now(),
  constraint crm_lifecycle_history_transition check (from_type <> to_type)
);
create index crm_lifecycle_history_person on public.crm_lifecycle_history(studio_id,person_id,changed_at desc);

alter table public.crm_lifecycle_settings enable row level security;
alter table public.crm_lifecycle_history enable row level security;
create policy crm_lifecycle_settings_read on public.crm_lifecycle_settings
  for select to authenticated using (private.has_capability(studio_id,'students.read'));
create policy crm_lifecycle_history_read on public.crm_lifecycle_history
  for select to authenticated using (private.has_capability(studio_id,'students.read'));
revoke all on public.crm_lifecycle_settings,public.crm_lifecycle_history from public,anon,authenticated;
grant select on public.crm_lifecycle_settings,public.crm_lifecycle_history to authenticated;

create or replace function public.admin_set_crm_inactivity_days(p_studio_id uuid,p_days integer)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.has_capability(p_studio_id,'settings.write') then
    raise exception 'crm_settings_forbidden';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'crm_inactivity_days_invalid';
  end if;
  insert into public.crm_lifecycle_settings(studio_id,inactivity_days)
  values(p_studio_id,p_days)
  on conflict(studio_id) do update set inactivity_days=excluded.inactivity_days,updated_at=now();
  return p_days;
end $$;
revoke all on function public.admin_set_crm_inactivity_days(uuid,integer) from public,anon;
grant execute on function public.admin_set_crm_inactivity_days(uuid,integer) to authenticated;

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
    where s.archived_at is null and s.active and s.lifecycle_status='active' and s.student_type='regular'
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
revoke all on function private.refresh_crm_lifecycle_history() from public,anon,authenticated;

create extension if not exists pg_cron;
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='studio_flow_crm_inactivity_daily';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'studio_flow_crm_inactivity_daily',
    '0 14 * * *',
    'select private.refresh_crm_lifecycle_history();'
  );
end $$;
