alter table public.class_sessions
  add column if not exists instructor_id uuid references public.instructors(id) on delete set null;

create index if not exists class_sessions_instructor_id_idx
  on public.class_sessions(instructor_id)
  where instructor_id is not null;

-- Keep space_id as the canonical F5 resource. location_id remains legacy compatibility only.
update public.class_sessions
set space_id = location_id
where space_id is null
  and location_id is not null
  and exists (
    select 1 from public.spaces s
    where s.id = class_sessions.location_id
      and s.studio_id = class_sessions.studio_id
  );

-- Tenant-safe instructor relation.
alter table public.instructors
  drop constraint if exists instructors_studio_id_id_key;
alter table public.instructors
  add constraint instructors_studio_id_id_key unique (studio_id, id);

alter table public.class_sessions
  drop constraint if exists class_sessions_studio_instructor_fkey;
alter table public.class_sessions
  add constraint class_sessions_studio_instructor_fkey
  foreign key (studio_id, instructor_id)
  references public.instructors(studio_id, id)
  on delete set null;

-- Prevent the same active instructor or space from being scheduled into overlapping sessions.
create or replace function public.admin_session_has_conflict(
  p_studio_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_instructor_id uuid default null,
  p_space_id uuid default null,
  p_exclude_session_id uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_sessions s
    where s.studio_id = p_studio_id
      and s.status <> 'cancelled'
      and (p_exclude_session_id is null or s.id <> p_exclude_session_id)
      and s.starts_at < p_ends_at
      and s.ends_at > p_starts_at
      and (
        (p_instructor_id is not null and s.instructor_id = p_instructor_id)
        or (p_space_id is not null and s.space_id = p_space_id)
      )
  );
$$;

grant execute on function public.admin_session_has_conflict(uuid, timestamptz, timestamptz, uuid, uuid, uuid)
  to authenticated;
