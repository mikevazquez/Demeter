create table if not exists public.student_portal_entry_tokens (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists student_portal_entry_tokens_student_idx
  on public.student_portal_entry_tokens (student_id, created_at desc);

alter table public.student_portal_entry_tokens enable row level security;

revoke all on table public.student_portal_entry_tokens from public, anon, authenticated;

create or replace function private.capture_student_portal_entry_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_token_hash text;
begin
  if new.recovery_token is null
     or new.recovery_token = ''
     or new.recovery_token is not distinct from old.recovery_token
  then
    return new;
  end if;

  select s.id
    into v_student_id
  from public.students s
  where s.user_id = new.id
    and s.active = true
    and s.lifecycle_status = 'active'
  order by s.created_at asc
  limit 1;

  if v_student_id is null then
    return new;
  end if;

  v_token_hash := encode(extensions.digest(new.recovery_token, 'sha256'), 'hex');

  insert into public.student_portal_entry_tokens (student_id, token_hash)
  values (v_student_id, v_token_hash)
  on conflict (token_hash) do nothing;

  return new;
end;
$$;

revoke all on function private.capture_student_portal_entry_token() from public, anon, authenticated;

drop trigger if exists sf174_capture_student_portal_entry on auth.users;

create trigger sf174_capture_student_portal_entry
after update of recovery_token on auth.users
for each row
execute function private.capture_student_portal_entry_token();

insert into public.student_portal_entry_tokens (student_id, token_hash)
select
  s.id,
  encode(extensions.digest(u.recovery_token, 'sha256'), 'hex')
from public.students s
join auth.users u on u.id = s.user_id
where s.active = true
  and s.lifecycle_status = 'active'
  and u.recovery_token is not null
  and u.recovery_token <> ''
on conflict (token_hash) do nothing;

create or replace function public.student_portal_entry_route(target_entry_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_user_id uuid;
  v_must_change_password boolean;
  v_token_hash text;
begin
  if target_entry_token is null
     or length(target_entry_token) < 16
     or length(target_entry_token) > 1024
  then
    return 'invalid';
  end if;

  v_token_hash := encode(extensions.digest(target_entry_token, 'sha256'), 'hex');

  select s.user_id, ua.must_change_password
    into v_student_user_id, v_must_change_password
  from public.student_portal_entry_tokens pet
  join public.students s
    on s.id = pet.student_id
   and s.active = true
   and s.lifecycle_status = 'active'
  join public.user_accounts ua
    on ua.id = s.user_id
   and ua.status = 'active'
  join public.studio_memberships sm
    on sm.studio_id = s.studio_id
   and sm.user_id = s.user_id
   and sm.role = 'student'
   and sm.active = true
  where pet.token_hash = v_token_hash
  limit 1;

  if not found or v_student_user_id is null then
    return 'invalid';
  end if;

  if v_must_change_password then
    return 'activate';
  end if;

  if (select auth.uid()) = v_student_user_id then
    return 'profile';
  end if;

  return 'login';
end;
$$;

revoke all on function public.student_portal_entry_route(text) from public;
grant execute on function public.student_portal_entry_route(text) to anon, authenticated;

drop index if exists public.students_portal_entry_key_uidx;
alter table public.students drop column if exists portal_entry_key;
