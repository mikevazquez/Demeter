
-- EVALUACIONES-01-01 · hardening: used-template guard must support
-- version tables and child tables with different row shapes.

create or replace function private.evaluations_guard_used_template_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_used boolean;
begin
  if tg_table_name = 'evaluation_template_versions' then
    v_version_id := old.id;
  elsif tg_op = 'DELETE' then
    v_version_id := old.template_version_id;
  else
    v_version_id := new.template_version_id;
  end if;

  select exists (
    select 1
    from public.technical_evaluations e
    where e.template_version_id = v_version_id
  ) into v_used;

  if not v_used then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'evaluation_template_versions' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'status' - 'archived_at' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'status' - 'archived_at' - 'updated_at') then
      raise exception 'evaluation_template_version_in_use';
    end if;
    return new;
  end if;

  raise exception 'evaluation_template_version_in_use';
end;
$$;

revoke all on function private.evaluations_guard_used_template_version()
from public, anon, authenticated, service_role;
