alter table public.sites
  drop constraint if exists sites_studio_id_id_key;
alter table public.sites
  add constraint sites_studio_id_id_key unique (studio_id, id);

alter table public.spaces
  drop constraint if exists spaces_studio_id_id_key;
alter table public.spaces
  add constraint spaces_studio_id_id_key unique (studio_id, id);

alter table public.spaces
  drop constraint if exists spaces_studio_site_fkey;
alter table public.spaces
  add constraint spaces_studio_site_fkey
  foreign key (studio_id, site_id) references public.sites(studio_id, id) on delete cascade;

alter table public.class_sessions
  drop constraint if exists class_sessions_studio_space_fkey;
alter table public.class_sessions
  add constraint class_sessions_studio_space_fkey
  foreign key (studio_id, space_id) references public.spaces(studio_id, id) on delete set null;

-- Give existing memberships a tenant-scoped Person identity without creating any
-- Student/Instructor operational profile or additional login credentials.
do $$
declare
  r record;
  v_person_id uuid;
  v_first_name text;
  v_last_name text;
begin
  for r in
    select m.studio_id, m.user_id, coalesce(nullif(btrim(p.full_name), ''), 'Usuario') as full_name
    from public.studio_memberships m
    left join public.profiles p on p.id = m.user_id
    where m.person_id is null
  loop
    v_first_name := split_part(r.full_name, ' ', 1);
    v_last_name := nullif(btrim(substr(r.full_name, length(v_first_name) + 1)), '');

    insert into public.persons(studio_id, first_name, last_name)
    values(r.studio_id, v_first_name, v_last_name)
    returning id into v_person_id;

    update public.studio_memberships
    set person_id = v_person_id
    where studio_id = r.studio_id and user_id = r.user_id;
  end loop;
end;
$$;

-- Identity-bearing rows are exposed by operational relationship, not by a broad
-- students.read capability over every Person in a studio.
drop policy if exists persons_student_staff_read on public.persons;
drop policy if exists person_contacts_student_staff_read on public.person_contacts;

create policy persons_identity_scoped_read
on public.persons
for select
to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or exists (
    select 1
    from public.students s
    where s.person_id = persons.id
      and s.studio_id = persons.studio_id
      and private.has_capability(persons.studio_id, 'students.read')
  )
  or exists (
    select 1
    from public.studio_memberships m
    where m.studio_id = persons.studio_id
      and m.person_id = persons.id
      and m.user_id = (select auth.uid())
      and m.active = true
  )
  or exists (
    select 1
    from public.students s
    where s.person_id = persons.id
      and s.user_id = (select auth.uid())
  )
);

create policy person_contacts_identity_scoped_read
on public.person_contacts
for select
to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or exists (
    select 1
    from public.students s
    where s.person_id = person_contacts.person_id
      and s.studio_id = person_contacts.studio_id
      and private.has_capability(person_contacts.studio_id, 'students.read')
  )
  or exists (
    select 1
    from public.studio_memberships m
    where m.studio_id = person_contacts.studio_id
      and m.person_id = person_contacts.person_id
      and m.user_id = (select auth.uid())
      and m.active = true
  )
  or exists (
    select 1
    from public.students s
    where s.person_id = person_contacts.person_id
      and s.user_id = (select auth.uid())
  )
);
