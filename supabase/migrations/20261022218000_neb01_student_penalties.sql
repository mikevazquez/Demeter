-- NEB-01-41 · Nébora: penalizaciones para alumnas regulares por falta (no-show) y por
-- cancelación tardía, configurables por estudio y por separado.
-- Decisiones de Mike (22-oct-2026):
--  * Tras N eventos en D días, la alumna no puede reservar por X días, aunque tenga paquete
--    activo. X lo decide el estudio y la pausa se quita sola al vencer. (Esto reemplaza la idea
--    de "pago adelantado": quedó como una pausa de reservas.)
--  * Cargo en dinero por evento también en paquetes con créditos (además de gastar el crédito).
--    El cargo queda como adeudo y bloquea nuevas reservas hasta que se pague o se condone.
--  * Todo apagado por defecto: Demeter no cambia hasta que lo configure.
--  * Recepción y administración pueden quitar una pausa (queda quién y por qué).
--  * La alumna y Demi respetan la pausa y el adeudo; el equipo del estudio puede reservar por
--    ella. Las promociones desde lista de espera no se frenan, pero una alumna en pausa no puede
--    unirse a la lista de espera.

-- 1 · Política del estudio -----------------------------------------------------------------------

alter table public.studio_operating_policies
  add column if not exists package_late_cancellation_penalty_minor integer not null default 0,
  add column if not exists package_no_show_penalty_minor integer not null default 0,
  add column if not exists pending_charge_blocks_booking boolean not null default true,
  add column if not exists no_show_block_threshold integer,
  add column if not exists no_show_block_window_days integer,
  add column if not exists no_show_block_days integer,
  add column if not exists late_cancel_block_threshold integer,
  add column if not exists late_cancel_block_window_days integer,
  add column if not exists late_cancel_block_days integer;

alter table public.studio_operating_policies
  drop constraint if exists studio_operating_policies_package_penalty_check,
  drop constraint if exists studio_operating_policies_no_show_block_check,
  drop constraint if exists studio_operating_policies_late_cancel_block_check;
alter table public.studio_operating_policies
  add constraint studio_operating_policies_package_penalty_check check (
    package_late_cancellation_penalty_minor between 0 and 10000000
    and package_no_show_penalty_minor between 0 and 10000000),
  add constraint studio_operating_policies_no_show_block_check check (
    no_show_block_threshold is null
    or (no_show_block_threshold between 1 and 20
        and no_show_block_window_days is not null and no_show_block_window_days between 1 and 365
        and no_show_block_days is not null and no_show_block_days between 1 and 90)),
  add constraint studio_operating_policies_late_cancel_block_check check (
    late_cancel_block_threshold is null
    or (late_cancel_block_threshold between 1 and 20
        and late_cancel_block_window_days is not null and late_cancel_block_window_days between 1 and 365
        and late_cancel_block_days is not null and late_cancel_block_days between 1 and 90));

-- 2 · Pausas de reserva --------------------------------------------------------------------------

create table if not exists public.student_booking_penalties (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('no_show', 'late_cancellation')),
  events_count integer not null check (events_count > 0),
  window_days integer not null check (window_days > 0),
  source_reservation_id uuid references public.reservations(id) on delete set null,
  starts_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'waived')),
  waived_at timestamptz,
  waived_by_user_id uuid references auth.users(id) on delete set null,
  waive_note text,
  created_at timestamptz not null default clock_timestamp(),
  check (ends_at > starts_at),
  check ((status = 'waived') = (waived_at is not null))
);
create index if not exists student_booking_penalties_student_idx
  on public.student_booking_penalties (studio_id, student_id, ends_at desc);

alter table public.student_booking_penalties enable row level security;
alter table public.student_booking_penalties force row level security;
revoke all on public.student_booking_penalties from public, anon, authenticated;
grant select on public.student_booking_penalties to authenticated;
drop policy if exists student_booking_penalties_read on public.student_booking_penalties;
create policy student_booking_penalties_read on public.student_booking_penalties
  for select to authenticated
  using (
    private.has_capability(studio_id, 'schedule.read')
    or exists (select 1 from public.students st
               where st.id = student_id and st.user_id = (select auth.uid()))
  );

-- Pausa vigente de una alumna (la que termina más tarde), o null.
create or replace function private.student_active_booking_penalty(p_student_id uuid)
returns public.student_booking_penalties
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.student_booking_penalties p
  where p.student_id = p_student_id and p.status = 'active'
    and p.starts_at <= clock_timestamp() and p.ends_at > clock_timestamp()
  order by p.ends_at desc
  limit 1;
$$;
revoke all on function private.student_active_booking_penalty(uuid) from public, anon, authenticated;

-- Adeudos pendientes que bloquean reservar (si el estudio lo tiene activado).
create or replace function private.student_blocking_charges_minor(p_student_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.amount_minor), 0)::integer
  from public.student_operating_charges c
  join public.students st on st.id = c.student_id
  where c.student_id = p_student_id and c.status = 'pending'
    and coalesce((private.studio_operating_policy(st.studio_id)).pending_charge_blocks_booking, true);
$$;
revoke all on function private.student_blocking_charges_minor(uuid) from public, anon, authenticated;

-- 3 · Crear la pausa cuando una falta o cancelación tardía completa N en D días ------------------

create or replace function private.neb_evaluate_student_penalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.studio_operating_policies%rowtype;
  v_kind text;
  v_threshold integer;
  v_window integer;
  v_days integer;
  v_since timestamptz;
  v_count integer;
begin
  if new.student_id is null or old.status is not distinct from new.status
     or new.status::text not in ('no_show', 'cancelled_late') then
    return new;
  end if;

  v_policy := private.studio_operating_policy(new.studio_id);
  if new.status::text = 'no_show' then
    v_kind := 'no_show';
    v_threshold := v_policy.no_show_block_threshold;
    v_window := v_policy.no_show_block_window_days;
    v_days := v_policy.no_show_block_days;
  else
    v_kind := 'late_cancellation';
    v_threshold := v_policy.late_cancel_block_threshold;
    v_window := v_policy.late_cancel_block_window_days;
    v_days := v_policy.late_cancel_block_days;
  end if;
  if v_threshold is null or v_window is null or v_days is null then return new; end if;

  -- Ya hay una pausa vigente del mismo tipo: no se encima otra.
  if exists (select 1 from public.student_booking_penalties p
             where p.student_id = new.student_id and p.kind = v_kind and p.status = 'active'
               and p.ends_at > clock_timestamp()) then
    return new;
  end if;

  -- Solo cuentan eventos posteriores a la última pausa del mismo tipo (no se cobran dos veces).
  v_since := greatest(
    clock_timestamp() - make_interval(days => v_window),
    coalesce((select max(p.starts_at) from public.student_booking_penalties p
              where p.student_id = new.student_id and p.kind = v_kind), '-infinity'::timestamptz));

  select count(*) into v_count
  from public.reservations r
  join public.class_sessions cs on cs.id = r.session_id
  where r.student_id = new.student_id and r.studio_id = new.studio_id
    and r.status::text = new.status::text
    and (case when v_kind = 'no_show' then cs.starts_at
              else coalesce(r.cancelled_at, cs.starts_at) end) > v_since;

  if v_count >= v_threshold then
    insert into public.student_booking_penalties
      (studio_id, student_id, kind, events_count, window_days, source_reservation_id, ends_at)
    values (new.studio_id, new.student_id, v_kind, v_count, v_window, new.id,
            clock_timestamp() + make_interval(days => v_days));
  end if;
  return new;
end;
$$;
revoke all on function private.neb_evaluate_student_penalty() from public, anon, authenticated;

drop trigger if exists neb_evaluate_student_penalty on public.reservations;
create trigger neb_evaluate_student_penalty after update of status on public.reservations
  for each row execute function private.neb_evaluate_student_penalty();

-- 4 · Cargo en dinero también en paquetes con créditos -------------------------------------------
-- Misma función que antes (20260926015552); ahora, si el paquete no es ilimitado, usa los montos
-- de paquete. Sin montos configurados (0), no hay cargo, como hoy.

create or replace function private.capture_unlimited_operating_charge()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_acquisition public.product_acquisitions%rowtype;
  v_policy public.studio_operating_policies%rowtype;
  v_amount integer := 0;
  v_charge_type text;
  v_currency text;
begin
  if old.status is distinct from new.status
     and old.status in ('cancelled_late','no_show') then
    update public.student_operating_charges
    set status='voided',
        resolved_at=clock_timestamp(),
        resolution_note='Estado de reserva corregido',
        updated_at=clock_timestamp()
    where reservation_id=new.id
      and charge_type=case
        when old.status='cancelled_late' then 'late_cancellation'
        else 'no_show'
      end
      and status='pending';
  end if;

  if old.status is not distinct from new.status
     or new.status not in ('cancelled_late','no_show')
     or new.student_id is null
     or new.acquisition_id is null then
    return new;
  end if;

  select * into v_acquisition
  from public.product_acquisitions
  where id=new.acquisition_id
    and studio_id=new.studio_id;

  if not found then
    return new;
  end if;

  v_policy := private.studio_operating_policy(new.studio_id);

  if new.status='cancelled_late' then
    v_amount := case when coalesce(v_acquisition.unlimited,false)
      then v_policy.unlimited_late_cancellation_penalty_minor
      else v_policy.package_late_cancellation_penalty_minor end;
    v_charge_type := 'late_cancellation';
  else
    v_amount := case when coalesce(v_acquisition.unlimited,false)
      then v_policy.unlimited_no_show_penalty_minor
      else v_policy.package_no_show_penalty_minor end;
    v_charge_type := 'no_show';
  end if;

  if coalesce(v_amount,0) <= 0 then
    return new;
  end if;

  select currency into v_currency
  from public.studios
  where id=new.studio_id;

  insert into public.student_operating_charges(
    studio_id,
    student_id,
    reservation_id,
    acquisition_id,
    charge_type,
    amount_minor,
    currency,
    status
  )
  values(
    new.studio_id,
    new.student_id,
    new.id,
    new.acquisition_id,
    v_charge_type,
    v_amount,
    coalesce(v_currency,'MXN'),
    'pending'
  )
  on conflict(reservation_id,charge_type) do update
  set amount_minor=excluded.amount_minor,
      currency=excluded.currency,
      status=case
        when public.student_operating_charges.status='paid' then 'paid'
        else 'pending'
      end,
      resolved_at=case
        when public.student_operating_charges.status='paid'
          then public.student_operating_charges.resolved_at
        else null
      end,
      resolved_by_user_id=case
        when public.student_operating_charges.status='paid'
          then public.student_operating_charges.resolved_by_user_id
        else null
      end,
      resolution_note=case
        when public.student_operating_charges.status='paid'
          then public.student_operating_charges.resolution_note
        else null
      end,
      updated_at=clock_timestamp();

  return new;
end;
$$;

-- 5 · Al reservar o unirse a lista de espera ----------------------------------------------------

create or replace function private.student_penalty_block_reason(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_penalty public.student_booking_penalties;
  v_charges integer;
begin
  if p_student_id is null then return null; end if;
  v_penalty := private.student_active_booking_penalty(p_student_id);
  if v_penalty.id is not null then
    return jsonb_build_object('reason_code', 'student_booking_blocked',
      'blocked_until', v_penalty.ends_at, 'penalty_kind', v_penalty.kind);
  end if;
  v_charges := private.student_blocking_charges_minor(p_student_id);
  if v_charges > 0 then
    return jsonb_build_object('reason_code', 'student_charge_pending', 'pending_charge_minor', v_charges);
  end if;
  return null;
end;
$$;
revoke all on function private.student_penalty_block_reason(uuid) from public, anon, authenticated;

create or replace function private.neb_guard_student_penalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block jsonb;
begin
  if tg_table_name = 'reservations' and new.status::text <> 'reserved' then return new; end if;
  if new.student_id is null or not private.booking_window_applies(new.studio_id) then return new; end if;
  if tg_table_name = 'reservations' and exists (
    select 1 from public.class_waitlist_entries w
    where w.session_id = new.session_id and w.student_id = new.student_id and w.status = 'active'
  ) then
    return new;
  end if;
  v_block := private.student_penalty_block_reason(new.student_id);
  if v_block is not null then
    raise exception '%', v_block ->> 'reason_code'
      using detail = coalesce(v_block ->> 'blocked_until', v_block ->> 'pending_charge_minor', '');
  end if;
  return new;
end;
$$;
revoke all on function private.neb_guard_student_penalty() from public, anon, authenticated;

drop trigger if exists neb_guard_student_penalty on public.reservations;
create trigger neb_guard_student_penalty before insert on public.reservations
  for each row execute function private.neb_guard_student_penalty();
drop trigger if exists neb_guard_student_penalty on public.class_waitlist_entries;
create trigger neb_guard_student_penalty before insert on public.class_waitlist_entries
  for each row execute function private.neb_guard_student_penalty();

-- Elegibilidad: la capa de ventana de reserva (NEB-01-40) más la pausa y el adeudo de la alumna.
create or replace function private.neb_booking_overlay_for_student(
  p_session_id uuid, p_student_id uuid, p_result jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_block jsonb;
begin
  v_result := private.neb_booking_window_overlay(p_session_id, p_result);
  if v_result is null or coalesce((v_result ->> 'eligible')::boolean, false) is not true then
    return v_result;
  end if;
  if not private.booking_window_applies(
    (select cs.studio_id from public.class_sessions cs where cs.id = p_session_id)) then
    return v_result;
  end if;
  v_block := private.student_penalty_block_reason(p_student_id);
  if v_block is not null then
    return v_result || jsonb_build_object('eligible', false) || v_block;
  end if;
  return v_result;
end;
$$;
revoke all on function private.neb_booking_overlay_for_student(uuid, uuid, jsonb) from public, anon, authenticated;

-- Las elegibilidades que ya pasan por la capa de ventana ahora también revisan a la alumna.
do $migration$
declare
  v_sig text;
  v_def text;
  v_new text;
begin
  foreach v_sig in array array['public.booking_eligibility(uuid,uuid)', 'public.service_booking_eligibility(uuid,uuid,uuid)'] loop
    if to_regprocedure(v_sig) is null then
      raise notice 'NEB-01: % no existe en esta base; se omite', v_sig;
      continue;
    end if;
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_new := regexp_replace(v_def,
      'private\.neb_booking_window_overlay\(target_session_id,\s*',
      'private.neb_booking_overlay_for_student(target_session_id, target_student_id, ', 'g');
    if v_new = v_def then
      raise exception 'NEB-01: definición inesperada de % (penalizaciones)', v_sig;
    end if;
    execute v_new;
  end loop;
end
$migration$;

-- 6 · Configurar y perdonar ----------------------------------------------------------------------

create or replace function public.owner_update_studio_penalty_policy(
  p_studio_id uuid,
  p_package_late_cancellation_penalty_minor integer,
  p_package_no_show_penalty_minor integer,
  p_pending_charge_blocks_booking boolean,
  p_no_show_block_threshold integer,
  p_no_show_block_window_days integer,
  p_no_show_block_days integer,
  p_late_cancel_block_threshold integer,
  p_late_cancel_block_window_days integer,
  p_late_cancel_block_days integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_capability(p_studio_id, 'settings.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.studio_operating_policies (studio_id) values (p_studio_id)
  on conflict (studio_id) do nothing;
  update public.studio_operating_policies set
    package_late_cancellation_penalty_minor = coalesce(p_package_late_cancellation_penalty_minor, 0),
    package_no_show_penalty_minor = coalesce(p_package_no_show_penalty_minor, 0),
    pending_charge_blocks_booking = coalesce(p_pending_charge_blocks_booking, true),
    no_show_block_threshold = p_no_show_block_threshold,
    no_show_block_window_days = case when p_no_show_block_threshold is null then null else p_no_show_block_window_days end,
    no_show_block_days = case when p_no_show_block_threshold is null then null else p_no_show_block_days end,
    late_cancel_block_threshold = p_late_cancel_block_threshold,
    late_cancel_block_window_days = case when p_late_cancel_block_threshold is null then null else p_late_cancel_block_window_days end,
    late_cancel_block_days = case when p_late_cancel_block_threshold is null then null else p_late_cancel_block_days end,
    updated_by_user_id = (select auth.uid()),
    updated_at = now()
  where studio_id = p_studio_id;
end;
$$;
revoke all on function public.owner_update_studio_penalty_policy(uuid, integer, integer, boolean, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.owner_update_studio_penalty_policy(uuid, integer, integer, boolean, integer, integer, integer, integer, integer, integer) to authenticated;

create or replace function public.admin_waive_student_booking_penalty(p_penalty_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_penalty public.student_booking_penalties;
begin
  select * into v_penalty from public.student_booking_penalties where id = p_penalty_id for update;
  if v_penalty.id is null then raise exception 'penalty_not_found'; end if;
  if not (private.has_capability(v_penalty.studio_id, 'schedule.write')
          or private.has_capability(v_penalty.studio_id, 'students.write')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_penalty.status <> 'active' then raise exception 'penalty_not_active'; end if;
  update public.student_booking_penalties set
    status = 'waived',
    waived_at = clock_timestamp(),
    waived_by_user_id = (select auth.uid()),
    waive_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_penalty_id;
end;
$$;
revoke all on function public.admin_waive_student_booking_penalty(uuid, text) from public, anon;
grant execute on function public.admin_waive_student_booking_penalty(uuid, text) to authenticated;

-- Para el portal: la pausa o el adeudo de la alumna que consulta.
create or replace function public.student_booking_penalty_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.student_penalty_block_reason(
    (select st.id from public.students st where st.user_id = (select auth.uid()) and st.active
     order by st.created_at limit 1));
$$;
revoke all on function public.student_booking_penalty_status() from public, anon;
grant execute on function public.student_booking_penalty_status() to authenticated;
