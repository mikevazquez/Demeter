-- F4 · Instructores: perfil operativo separado de cuenta de acceso.

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'inactive')),
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, person_id)
);

create table if not exists public.instructor_disciplines (
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (instructor_id, discipline_id)
);

create index if not exists instructors_studio_status_idx on public.instructors(studio_id, status);
create index if not exists instructor_disciplines_discipline_idx on public.instructor_disciplines(discipline_id);

alter table public.instructors enable row level security;
alter table public.instructor_disciplines enable row level security;

drop policy if exists instructors_read on public.instructors;
create policy instructors_read on public.instructors
for select to authenticated
using (
  private.has_capability(studio_id, 'instructors.read')
  or exists (
    select 1 from public.studio_memberships sm
    where sm.studio_id = instructors.studio_id
      and sm.user_id = auth.uid()
      and sm.role = 'instructor'
      and sm.active = true
  )
);

drop policy if exists instructors_write on public.instructors;
create policy instructors_write on public.instructors
for all to authenticated
using (private.has_capability(studio_id, 'instructors.write'))
with check (private.has_capability(studio_id, 'instructors.write'));

drop policy if exists instructor_disciplines_read on public.instructor_disciplines;
create policy instructor_disciplines_read on public.instructor_disciplines
for select to authenticated
using (
  exists (
    select 1 from public.instructors i
    where i.id = instructor_disciplines.instructor_id
      and (
        private.has_capability(i.studio_id, 'instructors.read')
        or exists (
          select 1 from public.studio_memberships sm
          where sm.studio_id = i.studio_id
            and sm.user_id = auth.uid()
            and sm.role = 'instructor'
            and sm.active = true
        )
      )
  )
);

drop policy if exists instructor_disciplines_write on public.instructor_disciplines;
create policy instructor_disciplines_write on public.instructor_disciplines
for all to authenticated
using (
  exists (
    select 1 from public.instructors i
    where i.id = instructor_disciplines.instructor_id
      and private.has_capability(i.studio_id, 'instructors.write')
  )
)
with check (
  exists (
    select 1 from public.instructors i
    where i.id = instructor_disciplines.instructor_id
      and private.has_capability(i.studio_id, 'instructors.write')
  )
);

create or replace function public.admin_create_instructor(
  p_first_name text,
  p_last_name text default null,
  p_phone text default null,
  p_email text default null,
  p_bio text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_person_id uuid;
  v_instructor_id uuid;
begin
  select sm.studio_id into v_studio_id
  from public.studio_memberships sm
  where sm.user_id = auth.uid() and sm.active = true
  order by sm.created_at
  limit 1;

  if v_studio_id is null or not private.has_capability(v_studio_id, 'instructors.write') then
    raise exception 'forbidden';
  end if;
  if nullif(trim(p_first_name), '') is null then raise exception 'first_name_required'; end if;

  insert into public.persons (studio_id, first_name, last_name)
  values (v_studio_id, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''))
  returning id into v_person_id;

  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    insert into public.person_contacts (studio_id, person_id, kind, value, is_primary)
    values (v_studio_id, v_person_id, 'phone', trim(p_phone), true);
  end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null then
    insert into public.person_contacts (studio_id, person_id, kind, value, is_primary)
    values (v_studio_id, v_person_id, 'email', lower(trim(p_email)), true);
  end if;

  insert into public.instructors (studio_id, person_id, bio)
  values (v_studio_id, v_person_id, nullif(trim(coalesce(p_bio, '')), ''))
  returning id into v_instructor_id;

  return v_instructor_id;
end;
$$;

create or replace function public.admin_set_instructor_status(p_instructor_id uuid, p_status text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_studio_id uuid;
begin
  if p_status not in ('active', 'inactive') then raise exception 'status_invalid'; end if;
  select studio_id into v_studio_id from public.instructors where id = p_instructor_id;
  if v_studio_id is null or not private.has_capability(v_studio_id, 'instructors.write') then
    raise exception 'forbidden';
  end if;
  update public.instructors set status = p_status, updated_at = now() where id = p_instructor_id;
end;
$$;

grant execute on function public.admin_create_instructor(text,text,text,text,text) to authenticated;
grant execute on function public.admin_set_instructor_status(uuid,text) to authenticated;
