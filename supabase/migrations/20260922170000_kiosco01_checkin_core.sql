-- KIOSCO-01 · T01-T04
-- Core seguro de credenciales QR por reserva y check-in idempotente.
-- La reserva sigue siendo la única fuente de verdad de asistencia.

create table if not exists private.checkin_signing_secret (
  singleton boolean primary key default true check (singleton),
  secret bytea not null,
  created_at timestamptz not null default now()
);

insert into private.checkin_signing_secret(singleton, secret)
values (true, extensions.gen_random_bytes(32))
on conflict (singleton) do nothing;

revoke all on table private.checkin_signing_secret from public, anon, authenticated, service_role;

create table if not exists public.reservation_checkin_tokens (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  token_version integer not null default 1 check (token_version > 0),
  token_hash bytea not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservation_checkin_tokens_reservation_unique unique (reservation_id),
  constraint reservation_checkin_tokens_hash_unique unique (token_hash)
);

create index if not exists reservation_checkin_tokens_studio_idx
  on public.reservation_checkin_tokens(studio_id, reservation_id);

alter table public.reservation_checkin_tokens enable row level security;
revoke all on table public.reservation_checkin_tokens from public, anon, authenticated;
grant select, insert, update on table public.reservation_checkin_tokens to service_role;

create table if not exists public.attendance_checkins (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  source text not null check (source in ('KIOSK','COACH','ADMIN','ADMIN_AFTER_CLOSE')),
  actor_user_id uuid references auth.users(id) on delete set null,
  checked_in_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint attendance_checkins_reservation_unique unique (reservation_id)
);

create index if not exists attendance_checkins_session_idx
  on public.attendance_checkins(studio_id, session_id, checked_in_at desc);

alter table public.attendance_checkins enable row level security;

drop policy if exists attendance_checkins_staff_read on public.attendance_checkins;
create policy attendance_checkins_staff_read
on public.attendance_checkins
for select
to authenticated
using (private.has_capability(studio_id, 'attendance.write'));

revoke all on table public.attendance_checkins from public, anon, authenticated;
grant select on table public.attendance_checkins to authenticated;
grant select, insert, update on table public.attendance_checkins to service_role;

create or replace function private.checkin_token_value(
  target_reservation_id uuid,
  target_version integer
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret bytea;
begin
  select s.secret into v_secret
  from private.checkin_signing_secret s
  where s.singleton = true;

  if v_secret is null then
    raise exception 'checkin_secret_missing';
  end if;

  return 'sfci_' || extensions.encode(
    extensions.hmac(
      convert_to(target_reservation_id::text || ':' || target_version::text, 'UTF8'),
      v_secret,
      'sha256'
    ),
    'hex'
  );
end;
$$;

revoke all on function private.checkin_token_value(uuid, integer)
from public, anon, authenticated, service_role;

create or replace function private.ensure_reservation_checkin_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_version integer;
  v_token text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'reserved' then
      v_token := private.checkin_token_value(new.id, 1);

      insert into public.reservation_checkin_tokens(
        studio_id, reservation_id, token_version, token_hash, revoked_at
      )
      values (
        new.studio_id,
        new.id,
        1,
        extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
        null
      )
      on conflict (reservation_id) do nothing;
    end if;

    return new;
  end if;

  if old.status is distinct from new.status then
    if new.status in ('cancelled_on_time','cancelled_late','cancelled_by_studio') then
      update public.reservation_checkin_tokens
      set revoked_at = coalesce(revoked_at, now()),
          updated_at = now()
      where reservation_id = new.id;
    elsif new.status = 'reserved'
      and old.status not in ('reserved','attended') then
      select coalesce(t.token_version, 0) + 1
        into v_next_version
      from public.reservation_checkin_tokens t
      where t.reservation_id = new.id;

      v_next_version := coalesce(v_next_version, 1);
      v_token := private.checkin_token_value(new.id, v_next_version);

      insert into public.reservation_checkin_tokens(
        studio_id, reservation_id, token_version, token_hash, revoked_at
      )
      values (
        new.studio_id,
        new.id,
        v_next_version,
        extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
        null
      )
      on conflict (reservation_id) do update
      set token_version = excluded.token_version,
          token_hash = excluded.token_hash,
          revoked_at = null,
          updated_at = now();
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.ensure_reservation_checkin_token()
from public, anon, authenticated, service_role;

drop trigger if exists reservation_checkin_token_sync on public.reservations;
create trigger reservation_checkin_token_sync
after insert or update of status on public.reservations
for each row execute function private.ensure_reservation_checkin_token();

-- Backfill para reservas válidas existentes. No crea credenciales para lista de espera.
insert into public.reservation_checkin_tokens(
  studio_id, reservation_id, token_version, token_hash, revoked_at
)
select
  r.studio_id,
  r.id,
  1,
  extensions.digest(
    convert_to(private.checkin_token_value(r.id, 1), 'UTF8'),
    'sha256'
  ),
  null
from public.reservations r
where r.status in ('reserved','attended')
on conflict (reservation_id) do nothing;

create or replace function private.revoke_cancelled_session_checkin_tokens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status = 'cancelled' then
    update public.reservation_checkin_tokens t
    set revoked_at = coalesce(t.revoked_at, now()),
        updated_at = now()
    from public.reservations r
    where r.id = t.reservation_id
      and r.session_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function private.revoke_cancelled_session_checkin_tokens()
from public, anon, authenticated, service_role;

drop trigger if exists class_session_checkin_token_revoke on public.class_sessions;
create trigger class_session_checkin_token_revoke
after update of status on public.class_sessions
for each row execute function private.revoke_cancelled_session_checkin_tokens();

create or replace function public.student_reservation_checkin_token(
  target_reservation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_token_row public.reservation_checkin_tokens%rowtype;
  v_uid uuid := (select auth.uid());
  v_authorized boolean := false;
  v_token text;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;

  select * into v_reservation
  from public.reservations
  where id = target_reservation_id;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  v_authorized :=
    v_reservation.student_user_id = v_uid
    or exists (
      select 1
      from public.students s
      where s.id = v_reservation.student_id
        and s.studio_id = v_reservation.studio_id
        and s.user_id = v_uid
    )
    or exists (
      select 1
      from public.reservations host
      left join public.students hs
        on hs.id = host.student_id
       and hs.studio_id = host.studio_id
      where host.id = v_reservation.host_reservation_id
        and host.studio_id = v_reservation.studio_id
        and (host.student_user_id = v_uid or hs.user_id = v_uid)
    )
    or private.has_capability(v_reservation.studio_id, 'attendance.write');

  if not v_authorized then
    raise exception 'forbidden';
  end if;

  select * into v_session
  from public.class_sessions
  where id = v_reservation.session_id
    and studio_id = v_reservation.studio_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  select * into v_token_row
  from public.reservation_checkin_tokens
  where reservation_id = v_reservation.id;

  if v_reservation.status not in ('reserved','attended')
     or v_session.status <> 'scheduled'
     or v_session.ends_at <= now()
     or v_token_row.id is null
     or v_token_row.revoked_at is not null then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'reservation_not_valid'
    );
  end if;

  v_token := private.checkin_token_value(
    v_reservation.id,
    v_token_row.token_version
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation.id,
    'session_id', v_reservation.session_id,
    'token', v_token,
    'check_in_opens_at', v_session.starts_at - interval '30 minutes',
    'check_in_closes_at', v_session.ends_at
  );
end;
$$;

revoke all on function public.student_reservation_checkin_token(uuid)
from public, anon;
grant execute on function public.student_reservation_checkin_token(uuid)
to authenticated;

create or replace function public.check_in_reservation(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash bytea;
  v_token_row public.reservation_checkin_tokens%rowtype;
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_activity text;
  v_student_name text;
  v_existing_checkin public.attendance_checkins%rowtype;
  v_checked_in_at timestamptz;
begin
  if nullif(trim(coalesce(p_token, '')), '') is null
     or length(trim(p_token)) > 200 then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  v_token_hash := extensions.digest(
    convert_to(trim(p_token), 'UTF8'),
    'sha256'
  );

  select * into v_token_row
  from public.reservation_checkin_tokens
  where token_hash = v_token_hash;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  -- Lee la referencia primero y después bloquea en el mismo orden que el cierre:
  -- sesión -> reserva. Esto evita carreras entre el último scan y finalize_attendance.
  select session_id into v_reservation.session_id
  from public.reservations
  where id = v_token_row.reservation_id;

  if v_reservation.session_id is null then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  select * into v_session
  from public.class_sessions
  where id = v_reservation.session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  select * into v_reservation
  from public.reservations
  where id = v_token_row.reservation_id
    and session_id = v_session.id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write') then
    raise exception 'forbidden';
  end if;

  select ct.name into v_activity
  from public.class_templates ct
  where ct.id = v_session.template_id
    and ct.studio_id = v_session.studio_id;

  select coalesce(
    (
      select s.full_name
      from public.students s
      where s.id = v_reservation.student_id
        and s.studio_id = v_reservation.studio_id
    ),
    (
      select trim(concat_ws(' ', p.first_name, p.last_name))
      from public.persons p
      where p.id = v_reservation.guest_person_id
        and p.studio_id = v_reservation.studio_id
    ),
    'Asistente'
  ) into v_student_name;

  if v_session.status = 'cancelled'
     or v_token_row.revoked_at is not null
     or v_reservation.status in ('cancelled_on_time','cancelled_late','cancelled_by_studio') then
    return jsonb_build_object(
      'ok', false,
      'status', 'reservation_invalid'
    );
  end if;

  if now() < v_session.starts_at - interval '30 minutes' then
    return jsonb_build_object(
      'ok', false,
      'status', 'too_early',
      'available_at', v_session.starts_at - interval '30 minutes'
    );
  end if;

  if now() >= v_session.ends_at
     or v_session.status = 'completed'
     or v_reservation.status = 'no_show' then
    return jsonb_build_object(
      'ok', false,
      'status', 'session_finished'
    );
  end if;

  if v_reservation.status = 'attended' then
    select * into v_existing_checkin
    from public.attendance_checkins
    where reservation_id = v_reservation.id;

    return jsonb_build_object(
      'ok', true,
      'status', 'already_attended',
      'reservation_id', v_reservation.id,
      'session_id', v_session.id,
      'student_name', v_student_name,
      'activity', v_activity,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'checked_in_at', v_existing_checkin.checked_in_at
    );
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'status', 'reservation_invalid'
    );
  end if;

  v_checked_in_at := clock_timestamp();

  update public.reservations
  set status = 'attended',
      updated_at = v_checked_in_at
  where id = v_reservation.id;

  insert into public.attendance_checkins(
    studio_id,
    reservation_id,
    session_id,
    source,
    actor_user_id,
    checked_in_at
  )
  values (
    v_reservation.studio_id,
    v_reservation.id,
    v_session.id,
    'KIOSK',
    (select auth.uid()),
    v_checked_in_at
  )
  on conflict (reservation_id) do nothing;

  perform public.emit_domain_event(
    v_reservation.studio_id,
    'attendance.checked_in',
    'reservation',
    v_reservation.id,
    'attendance:checked_in:' || v_reservation.id::text,
    v_checked_in_at,
    (select auth.uid()),
    jsonb_build_object(
      'reservation_id', v_reservation.id,
      'session_id', v_session.id,
      'student_id', v_reservation.student_id,
      'guest_person_id', v_reservation.guest_person_id,
      'source', 'KIOSK',
      'checked_in_at', v_checked_in_at
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'success',
    'reservation_id', v_reservation.id,
    'session_id', v_session.id,
    'student_name', v_student_name,
    'activity', v_activity,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'checked_in_at', v_checked_in_at
  );
end;
$$;

revoke all on function public.check_in_reservation(text)
from public, anon;
grant execute on function public.check_in_reservation(text)
to authenticated;
