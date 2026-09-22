create or replace function private.recursos01_sync_session_resources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.requires_resource or new.space_id is null then
    delete from public.session_resources
    where session_id = new.id;
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.space_id is not distinct from new.space_id
    and old.requires_resource = new.requires_resource then
    return new;
  end if;

  delete from public.session_resources
  where session_id = new.id;

  insert into public.session_resources (
    studio_id,
    session_id,
    resource_id,
    enabled,
    capacity_override
  )
  select
    new.studio_id,
    new.id,
    r.id,
    true,
    null
  from public.resources r
  where r.studio_id = new.studio_id
    and r.space_id = new.space_id
    and r.active;

  return new;
end;
$$;

revoke all on function private.recursos01_sync_session_resources()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_sync_session_resources
on public.class_sessions;

create trigger recursos01_sync_session_resources
after insert or update of space_id, requires_resource
on public.class_sessions
for each row execute function private.recursos01_sync_session_resources();

comment on function private.recursos01_sync_session_resources() is
  'RECURSOS-01 seeds active resources from the session space and rebuilds them safely when the space/resource requirement changes.';
