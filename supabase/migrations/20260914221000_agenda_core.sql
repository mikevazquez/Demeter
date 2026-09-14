create table if not exists public.studio_locations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (studio_id, name)
);

alter table public.studio_locations enable row level security;

grant select, insert, update, delete on public.studio_locations to authenticated;

create policy locations_member_select on public.studio_locations for select to authenticated
  using ((select private.is_studio_member(studio_id)));

create policy locations_admin_insert on public.studio_locations for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

create policy locations_admin_update on public.studio_locations for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

create policy locations_admin_delete on public.studio_locations for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

alter table public.class_sessions
  add column if not exists location_id uuid references public.studio_locations(id) on delete set null;

create index if not exists class_sessions_location_idx on public.class_sessions(location_id);

create policy disciplines_admin_insert on public.disciplines for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy disciplines_admin_update on public.disciplines for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy disciplines_admin_delete on public.disciplines for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

create policy templates_admin_insert on public.class_templates for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy templates_admin_update on public.class_templates for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy templates_admin_delete on public.class_templates for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

create policy sessions_admin_insert on public.class_sessions for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy sessions_admin_update on public.class_sessions for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy sessions_admin_delete on public.class_sessions for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

create policy memberships_admin_insert on public.studio_memberships for insert to authenticated
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy memberships_admin_update on public.studio_memberships for update to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])))
  with check ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));
create policy memberships_admin_delete on public.studio_memberships for delete to authenticated
  using ((select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[])));

insert into public.studio_locations (studio_id, name)
select id, 'Principal'
from public.studios s
where s.slug = 'demeter'
  and not exists (
    select 1 from public.studio_locations l where l.studio_id = s.id and l.name = 'Principal'
  );
