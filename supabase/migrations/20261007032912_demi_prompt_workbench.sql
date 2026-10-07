-- Additive prompt history. Saving a draft never updates assistant_configs.
create table public.assistant_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id),
  kind text not null check (kind in ('baseline', 'draft', 'activation')),
  instructions text not null check (length(instructions) <= 24000),
  note text not null default '' check (length(note) <= 500),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index assistant_prompt_versions_studio_created_idx
  on public.assistant_prompt_versions(studio_id, created_at desc);
alter table public.assistant_prompt_versions enable row level security;
revoke all on public.assistant_prompt_versions from public, anon, authenticated;
grant select, insert on public.assistant_prompt_versions to authenticated;
grant select, insert on public.assistant_prompt_versions to service_role;
create policy assistant_prompt_versions_read on public.assistant_prompt_versions
  for select to authenticated using (private.has_capability(studio_id, 'settings.write'));
create policy assistant_prompt_versions_append on public.assistant_prompt_versions
  for insert to authenticated with check (
    private.has_capability(studio_id, 'settings.write')
    and created_by = (select auth.uid()) and kind in ('draft', 'activation')
  );
insert into public.assistant_prompt_versions(studio_id, kind, instructions, note)
  select studio_id, 'baseline', personality_instructions, 'Instrucciones iniciales conservadas'
  from public.assistant_configs;

alter table public.assistant_conversations add column workbench_lock_until timestamptz;

create function public.admin_activate_demi_prompt(
  p_studio_id uuid, p_version_id uuid, p_expected_active text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_current text;
  v_instructions text;
begin
  if auth.uid() is null or not private.has_capability(p_studio_id, 'settings.write') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select personality_instructions into v_current from public.assistant_configs
    where studio_id = p_studio_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'assistant_not_configured'); end if;
  if v_current is distinct from p_expected_active then
    return jsonb_build_object('ok', false, 'error', 'active_prompt_changed');
  end if;
  select instructions into v_instructions from public.assistant_prompt_versions
    where id = p_version_id and studio_id = p_studio_id;
  if not found or length(trim(v_instructions)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'prompt_version_not_found');
  end if;
  insert into public.assistant_prompt_versions(studio_id, kind, instructions, note, created_by)
    values(p_studio_id, 'activation', v_instructions, 'Versión activada explícitamente', auth.uid());
  update public.assistant_configs set personality_instructions = v_instructions,
    updated_at = clock_timestamp() where studio_id = p_studio_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_activate_demi_prompt(uuid, uuid, text) from public, anon;
grant execute on function public.admin_activate_demi_prompt(uuid, uuid, text) to authenticated;
