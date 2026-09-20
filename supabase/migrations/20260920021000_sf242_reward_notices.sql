create table public.reward_notice_receipts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  source_key text not null check (length(trim(source_key)) > 0),
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_notice_receipts_studio_id_unique unique (studio_id, id),
  constraint reward_notice_receipts_source_unique unique (studio_id, student_id, source_key)
);

create index reward_notice_receipts_student_idx
  on public.reward_notice_receipts(studio_id, student_id, seen_at desc);

alter table public.reward_notice_receipts enable row level security;

create policy reward_notice_receipts_student_read
on public.reward_notice_receipts
for select
to authenticated
using (private.is_reward_student_self(studio_id, student_id));

revoke all on table public.reward_notice_receipts from anon, authenticated, service_role;
grant select on table public.reward_notice_receipts to authenticated, service_role;
grant select, insert, update, delete on table public.reward_notice_receipts to service_role;

create or replace function private.student_ack_reward_notices_internal(
  p_source_keys text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_student public.students%rowtype;
  v_key text;
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;

  select *
    into v_student
  from public.students s
  where s.user_id = v_user_id
    and s.lifecycle_status <> 'archived'
  order by s.created_at
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  if p_source_keys is null or cardinality(p_source_keys) = 0 then
    return 0;
  end if;

  foreach v_key in array p_source_keys
  loop
    v_key := trim(coalesce(v_key, ''));

    if v_key = '' or length(v_key) > 200 then
      raise exception 'reward_notice_source_key_invalid';
    end if;

    if v_key !~ '^(reward|achievement):[0-9a-fA-F-]{36}$' then
      raise exception 'reward_notice_source_key_invalid';
    end if;

    insert into public.reward_notice_receipts (
      studio_id,
      student_id,
      source_key,
      seen_at
    ) values (
      v_student.studio_id,
      v_student.id,
      v_key,
      clock_timestamp()
    )
    on conflict (studio_id, student_id, source_key)
    do update set seen_at = excluded.seen_at;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.student_ack_reward_notices_internal(text[])
from public, anon;
grant execute on function private.student_ack_reward_notices_internal(text[])
to authenticated;

create or replace function public.student_ack_reward_notices(
  p_source_keys text[]
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.student_ack_reward_notices_internal(p_source_keys);
$$;

revoke all on function public.student_ack_reward_notices(text[])
from public, anon;
grant execute on function public.student_ack_reward_notices(text[])
to authenticated;

comment on table public.reward_notice_receipts is
  'SF-242 presentation-only acknowledgement state. Reward generation remains independent and is never blocked by notice delivery.';
