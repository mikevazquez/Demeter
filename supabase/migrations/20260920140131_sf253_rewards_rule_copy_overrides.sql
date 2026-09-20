
create table public.reward_rule_copy_overrides (
  rule_id uuid primary key references public.reward_rules(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete restrict,
  title text,
  description text,
  cover_url text,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint reward_rule_copy_overrides_title_chk
    check (title is null or length(trim(title)) > 0)
);

create table public.reward_rule_copy_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_id uuid not null references public.reward_rules(id) on delete cascade,
  title text,
  description text,
  cover_url text,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index reward_rule_copy_events_rule_idx
  on public.reward_rule_copy_events(studio_id,rule_id,occurred_at desc,id desc);

alter table public.reward_rule_copy_overrides enable row level security;
alter table public.reward_rule_copy_events enable row level security;

create policy reward_rule_copy_overrides_read
on public.reward_rule_copy_overrides
for select to authenticated
using (private.has_capability(studio_id,'rewards.read'));

create policy reward_rule_copy_events_read
on public.reward_rule_copy_events
for select to authenticated
using (private.has_capability(studio_id,'rewards.read'));

create or replace function private.reject_reward_rule_copy_event_mutation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception 'reward_rule_copy_events_immutable';
end;
$$;

create trigger reward_rule_copy_events_immutable
before update or delete on public.reward_rule_copy_events
for each row execute function private.reject_reward_rule_copy_event_mutation();

create or replace function public.admin_update_reward_rule_copy(
  p_rule_id uuid,
  p_title text,
  p_description text,
  p_cover_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_title text := nullif(trim(coalesce(p_title,'')),'');
  v_description text := nullif(trim(coalesce(p_description,'')),'');
  v_cover text := nullif(trim(coalesce(p_cover_url,'')),'');
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'unauthenticated'; end if;

  select * into v_rule
  from public.reward_rules
  where id=p_rule_id
  for update;

  if not found then raise exception 'reward_rule_not_found'; end if;
  if not private.has_capability(v_rule.studio_id,'rewards.manage') then
    raise exception 'forbidden';
  end if;
  if v_rule.status not in ('active','scheduled','paused') then
    raise exception 'reward_rule_copy_override_not_allowed';
  end if;
  if v_title is null then raise exception 'reward_rule_title_required'; end if;

  insert into public.reward_rule_copy_overrides(
    rule_id,studio_id,title,description,cover_url,updated_by_user_id,updated_at
  ) values (
    v_rule.id,v_rule.studio_id,v_title,v_description,v_cover,v_user,clock_timestamp()
  )
  on conflict (rule_id) do update
  set title=excluded.title,
      description=excluded.description,
      cover_url=excluded.cover_url,
      updated_by_user_id=excluded.updated_by_user_id,
      updated_at=excluded.updated_at;

  insert into public.reward_rule_copy_events(
    studio_id,rule_id,title,description,cover_url,actor_user_id
  ) values (
    v_rule.studio_id,v_rule.id,v_title,v_description,v_cover,v_user
  );

  return jsonb_build_object(
    'rule_id',v_rule.id,
    'title',v_title,
    'description',v_description,
    'cover_url',v_cover
  );
end;
$$;

revoke all on function public.admin_update_reward_rule_copy(uuid,text,text,text)
from public,anon;
grant execute on function public.admin_update_reward_rule_copy(uuid,text,text,text)
to authenticated;
