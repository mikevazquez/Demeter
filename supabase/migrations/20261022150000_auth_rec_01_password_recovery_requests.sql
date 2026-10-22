-- AUTH-REC-01 · Password recovery request log and rate limit.
-- Identifiers (phone / email / client address) are stored only as HMAC hashes computed by the
-- server. Limits: 3 requests per identifier and 10 per client address in a rolling hour.
-- Rows older than 30 days are purged on every new request.

create table if not exists public.auth_password_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  portal text not null check (portal in ('student', 'studio')),
  identifier_hash text not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  client_hash text check (client_hash is null or client_hash ~ '^[0-9a-f]{64}$'),
  studio_id uuid references public.studios(id) on delete set null,
  outcome text not null default 'requested' check (outcome in (
    'requested', 'sent', 'no_account', 'rate_limited', 'delivery_failed',
    'not_configured', 'template_without_link'
  )),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists auth_password_recovery_requests_identifier_idx
  on public.auth_password_recovery_requests (portal, identifier_hash, created_at desc);
create index if not exists auth_password_recovery_requests_client_idx
  on public.auth_password_recovery_requests (portal, client_hash, created_at desc)
  where client_hash is not null;

alter table public.auth_password_recovery_requests enable row level security;
revoke all on table public.auth_password_recovery_requests from public, anon, authenticated;

create or replace function public.service_begin_password_recovery_request(
  p_portal text,
  p_identifier_hash text,
  p_client_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identifier_count integer;
  v_client_count integer := 0;
  v_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_portal not in ('student', 'studio') or p_identifier_hash !~ '^[0-9a-f]{64}$'
     or (p_client_hash is not null and p_client_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid_recovery_request';
  end if;

  delete from public.auth_password_recovery_requests
  where created_at < clock_timestamp() - interval '30 days';

  -- Serialize requests for the same identifier so parallel taps cannot bypass the limit.
  perform pg_advisory_xact_lock(hashtextextended(p_portal || ':' || p_identifier_hash, 0));

  select count(*) into v_identifier_count
  from public.auth_password_recovery_requests r
  where r.portal = p_portal
    and r.identifier_hash = p_identifier_hash
    and r.outcome <> 'rate_limited'
    and r.created_at > clock_timestamp() - interval '1 hour';

  if p_client_hash is not null then
    select count(*) into v_client_count
    from public.auth_password_recovery_requests r
    where r.portal = p_portal
      and r.client_hash = p_client_hash
      and r.outcome <> 'rate_limited'
      and r.created_at > clock_timestamp() - interval '1 hour';
  end if;

  if v_identifier_count >= 3 or v_client_count >= 10 then
    insert into public.auth_password_recovery_requests (portal, identifier_hash, client_hash, outcome)
    values (p_portal, p_identifier_hash, p_client_hash, 'rate_limited');
    return jsonb_build_object('allowed', false, 'reason_code', 'rate_limited');
  end if;

  insert into public.auth_password_recovery_requests (portal, identifier_hash, client_hash)
  values (p_portal, p_identifier_hash, p_client_hash)
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'request_id', v_id);
end;
$$;

create or replace function public.service_finish_password_recovery_request(
  p_request_id uuid,
  p_outcome text,
  p_studio_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_outcome not in (
    'sent', 'no_account', 'delivery_failed', 'not_configured', 'template_without_link'
  ) then
    raise exception 'invalid_recovery_outcome';
  end if;

  update public.auth_password_recovery_requests
  set outcome = p_outcome,
      studio_id = coalesce(p_studio_id, studio_id),
      updated_at = clock_timestamp()
  where id = p_request_id and outcome = 'requested';
end;
$$;

revoke all on function public.service_begin_password_recovery_request(text, text, text)
  from public, anon, authenticated;
revoke all on function public.service_finish_password_recovery_request(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.service_begin_password_recovery_request(text, text, text)
  to service_role;
grant execute on function public.service_finish_password_recovery_request(uuid, text, uuid)
  to service_role;
