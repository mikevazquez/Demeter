-- NEB-01-19 · Solicitudes de soporte desde la app del estudio.
-- La dueña (o quien tenga permiso de ajustes) pide ayuda desde Más › Ayuda de Nébora; la consola tiene
-- una bandeja con abiertas y resueltas, acceso directo a entrar al estudio y respuesta visible para ella.

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  response text check (response is null or char_length(response) <= 2000),
  check ((status = 'open' and resolved_at is null) or (status = 'resolved' and resolved_at is not null))
);

create index if not exists support_requests_studio_idx on public.support_requests (studio_id, created_at desc);
create index if not exists support_requests_open_idx on public.support_requests (created_at) where status = 'open';

alter table public.support_requests enable row level security;
revoke all on table public.support_requests from anon, authenticated;

create or replace function public.studio_create_support_request(p_studio uuid, p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text := btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g'));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if (select auth.uid()) is null or not private.has_capability(p_studio, 'settings.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_subject) < 3 or char_length(v_subject) > 120 then
    raise exception 'support_subject_invalid';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'support_body_too_long';
  end if;
  -- Freno sencillo contra envíos repetidos: máximo 10 abiertas por estudio.
  if (select count(*) from public.support_requests r where r.studio_id = p_studio and r.status = 'open') >= 10 then
    raise exception 'support_too_many_open';
  end if;
  insert into public.support_requests (studio_id, created_by, subject, body)
  values (p_studio, (select auth.uid()), v_subject, v_body)
  returning id into v_id;
  perform private.platform_audit(p_studio, 'support.request.created',
    jsonb_build_object('request', v_id, 'subject', v_subject));
  return v_id;
end;
$$;
revoke all on function public.studio_create_support_request(uuid, text, text) from public, anon;
grant execute on function public.studio_create_support_request(uuid, text, text) to authenticated;

create or replace function public.studio_support_requests(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_capability(p_studio, 'settings.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'subject', r.subject, 'body', r.body, 'status', r.status,
      'created_at', r.created_at, 'resolved_at', r.resolved_at, 'response', r.response
    ) order by r.created_at desc)
    from (select * from public.support_requests where studio_id = p_studio order by created_at desc limit 30) r
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.studio_support_requests(uuid) from public, anon;
grant execute on function public.studio_support_requests(uuid) to authenticated;

-- Consola: bandeja (abiertas primero) y resolver con respuesta.
create or replace function public.platform_support_requests(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.platform_require_admin();
  if p_status is not null and p_status not in ('open', 'resolved') then
    raise exception 'support_status_invalid';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'studio_id', r.studio_id, 'studio_name', coalesce(nullif(st.brand_name, ''), st.name),
      'subject', r.subject, 'body', r.body, 'status', r.status, 'created_at', r.created_at,
      'resolved_at', r.resolved_at, 'response', r.response
    ) order by (r.status = 'open') desc, r.created_at desc)
    from (select * from public.support_requests
          where p_status is null or status = p_status
          order by (status = 'open') desc, created_at desc limit 200) r
    join public.studios st on st.id = r.studio_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.platform_support_requests(text) from public, anon;
grant execute on function public.platform_support_requests(text) to authenticated;

create or replace function public.platform_resolve_support_request(p_request uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.platform_require_admin();
  v_request public.support_requests%rowtype;
  v_response text := nullif(btrim(coalesce(p_response, '')), '');
begin
  select * into v_request from public.support_requests where id = p_request for update;
  if not found then
    raise exception 'support_request_not_found';
  end if;
  if v_request.status = 'resolved' then
    return;
  end if;
  if v_response is not null and char_length(v_response) > 2000 then
    raise exception 'support_body_too_long';
  end if;
  update public.support_requests
  set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = v_admin, response = v_response
  where id = p_request;
  perform private.platform_audit(v_request.studio_id, 'support.request.resolved',
    jsonb_build_object('request', p_request, 'subject', v_request.subject));
end;
$$;
revoke all on function public.platform_resolve_support_request(uuid, text) from public, anon;
grant execute on function public.platform_resolve_support_request(uuid, text) to authenticated;
