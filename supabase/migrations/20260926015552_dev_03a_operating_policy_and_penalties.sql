alter table public.studio_operating_policies
  add column if not exists default_minimum_reservations_enabled boolean not null default false,
  add column if not exists default_minimum_reservations integer not null default 2,
  add column if not exists default_minimum_review_minutes_before integer not null default 120,
  add column if not exists default_minimum_override_allowed boolean not null default true,
  add column if not exists unlimited_late_cancellation_penalty_minor integer not null default 0,
  add column if not exists unlimited_no_show_penalty_minor integer not null default 0;

alter table public.studio_operating_policies
  drop constraint if exists studio_operating_policies_default_minimum_reservations_check,
  add constraint studio_operating_policies_default_minimum_reservations_check
    check (default_minimum_reservations between 1 and 100),
  drop constraint if exists studio_operating_policies_default_minimum_review_check,
  add constraint studio_operating_policies_default_minimum_review_check
    check (default_minimum_review_minutes_before between 15 and 10080),
  drop constraint if exists studio_operating_policies_unlimited_late_penalty_check,
  add constraint studio_operating_policies_unlimited_late_penalty_check
    check (unlimited_late_cancellation_penalty_minor between 0 and 10000000),
  drop constraint if exists studio_operating_policies_unlimited_no_show_penalty_check,
  add constraint studio_operating_policies_unlimited_no_show_penalty_check
    check (unlimited_no_show_penalty_minor between 0 and 10000000);

update public.studio_operating_policies
set unlimited_late_cancellation_penalty_minor=2000,
    unlimited_no_show_penalty_minor=2000
where studio_id='9fe23cfa-fb47-4670-afeb-ed4a56433772';

create table if not exists public.student_operating_charges (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  acquisition_id uuid null references public.product_acquisitions(id) on delete set null,
  charge_type text not null check (charge_type in ('late_cancellation','no_show')),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending','paid','waived','voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by_user_id uuid null references auth.users(id) on delete set null,
  resolution_note text null,
  unique(reservation_id,charge_type)
);

alter table public.student_operating_charges enable row level security;

revoke all on table public.student_operating_charges from public,anon,authenticated;
grant select on table public.student_operating_charges to authenticated;
grant all on table public.student_operating_charges to service_role;

drop policy if exists student_operating_charges_select on public.student_operating_charges;
create policy student_operating_charges_select
on public.student_operating_charges
for select
to authenticated
using (
  private.has_capability(studio_id,'sales.read')
  or private.has_capability(studio_id,'sales.write')
  or private.has_capability(studio_id,'settings.write')
  or private.is_current_student(student_id,studio_id)
);

create or replace function private.studio_operating_policy(p_studio_id uuid)
returns public.studio_operating_policies
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_policy public.studio_operating_policies%rowtype;
begin
  select * into v_policy
  from public.studio_operating_policies
  where studio_id=p_studio_id;

  if not found then
    v_policy.studio_id := p_studio_id;
    v_policy.cancellation_cutoff_minutes := 300;
    v_policy.late_cancellation_consumes_credit := true;
    v_policy.no_show_consumes_credit := true;
    v_policy.default_minimum_reservations_enabled := false;
    v_policy.default_minimum_reservations := 2;
    v_policy.default_minimum_review_minutes_before := 120;
    v_policy.default_minimum_override_allowed := true;
    v_policy.unlimited_late_cancellation_penalty_minor := 0;
    v_policy.unlimited_no_show_penalty_minor := 0;
    v_policy.updated_by_user_id := null;
    v_policy.updated_at := now();
  end if;

  return v_policy;
end;
$$;

create or replace function public.owner_update_studio_operating_policy_v2(
  p_studio_id uuid,
  p_cancellation_cutoff_minutes integer,
  p_late_cancellation_consumes_credit boolean,
  p_no_show_consumes_credit boolean,
  p_default_minimum_reservations_enabled boolean,
  p_default_minimum_reservations integer,
  p_default_minimum_review_minutes_before integer,
  p_default_minimum_override_allowed boolean,
  p_unlimited_late_cancellation_penalty_minor integer,
  p_unlimited_no_show_penalty_minor integer
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.has_studio_role(
    p_studio_id,
    array['owner'::public.studio_role]
  ) then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if p_cancellation_cutoff_minutes is null
     or p_cancellation_cutoff_minutes < 0
     or p_cancellation_cutoff_minutes > 10080 then
    raise exception 'cancellation_cutoff_invalid' using errcode='22023';
  end if;

  if p_default_minimum_reservations is null
     or p_default_minimum_reservations < 1
     or p_default_minimum_reservations > 100 then
    raise exception 'minimum_reservations_invalid' using errcode='22023';
  end if;

  if p_default_minimum_review_minutes_before is null
     or p_default_minimum_review_minutes_before < 15
     or p_default_minimum_review_minutes_before > 10080 then
    raise exception 'minimum_review_invalid' using errcode='22023';
  end if;

  if coalesce(p_unlimited_late_cancellation_penalty_minor,-1) < 0
     or coalesce(p_unlimited_no_show_penalty_minor,-1) < 0 then
    raise exception 'unlimited_penalty_invalid' using errcode='22023';
  end if;

  insert into public.studio_operating_policies(
    studio_id,
    cancellation_cutoff_minutes,
    late_cancellation_consumes_credit,
    no_show_consumes_credit,
    default_minimum_reservations_enabled,
    default_minimum_reservations,
    default_minimum_review_minutes_before,
    default_minimum_override_allowed,
    unlimited_late_cancellation_penalty_minor,
    unlimited_no_show_penalty_minor,
    updated_by_user_id,
    updated_at
  )
  values(
    p_studio_id,
    p_cancellation_cutoff_minutes,
    coalesce(p_late_cancellation_consumes_credit,true),
    coalesce(p_no_show_consumes_credit,true),
    coalesce(p_default_minimum_reservations_enabled,false),
    p_default_minimum_reservations,
    p_default_minimum_review_minutes_before,
    coalesce(p_default_minimum_override_allowed,true),
    p_unlimited_late_cancellation_penalty_minor,
    p_unlimited_no_show_penalty_minor,
    (select auth.uid()),
    now()
  )
  on conflict(studio_id) do update
  set cancellation_cutoff_minutes=excluded.cancellation_cutoff_minutes,
      late_cancellation_consumes_credit=excluded.late_cancellation_consumes_credit,
      no_show_consumes_credit=excluded.no_show_consumes_credit,
      default_minimum_reservations_enabled=excluded.default_minimum_reservations_enabled,
      default_minimum_reservations=excluded.default_minimum_reservations,
      default_minimum_review_minutes_before=excluded.default_minimum_review_minutes_before,
      default_minimum_override_allowed=excluded.default_minimum_override_allowed,
      unlimited_late_cancellation_penalty_minor=excluded.unlimited_late_cancellation_penalty_minor,
      unlimited_no_show_penalty_minor=excluded.unlimited_no_show_penalty_minor,
      updated_by_user_id=(select auth.uid()),
      updated_at=now();
end;
$$;

revoke all on function public.owner_update_studio_operating_policy_v2(
  uuid,integer,boolean,boolean,boolean,integer,integer,boolean,integer,integer
) from public,anon;
grant execute on function public.owner_update_studio_operating_policy_v2(
  uuid,integer,boolean,boolean,boolean,integer,integer,boolean,integer,integer
) to authenticated;

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

  if not found or not coalesce(v_acquisition.unlimited,false) then
    return new;
  end if;

  v_policy := private.studio_operating_policy(new.studio_id);

  if new.status='cancelled_late' then
    v_amount := v_policy.unlimited_late_cancellation_penalty_minor;
    v_charge_type := 'late_cancellation';
  else
    v_amount := v_policy.unlimited_no_show_penalty_minor;
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

drop trigger if exists reservations_capture_unlimited_operating_charge on public.reservations;
create trigger reservations_capture_unlimited_operating_charge
after update of status on public.reservations
for each row
execute function private.capture_unlimited_operating_charge();

create or replace function public.admin_resolve_student_operating_charge(
  p_charge_id uuid,
  p_resolution text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_charge public.student_operating_charges%rowtype;
  v_status text := lower(trim(coalesce(p_resolution,'')));
begin
  select * into v_charge
  from public.student_operating_charges
  where id=p_charge_id
  for update;

  if not found then
    raise exception 'charge_not_found';
  end if;

  if not private.has_capability(v_charge.studio_id,'sales.write') then
    raise exception 'forbidden';
  end if;

  if v_status not in ('paid','waived') then
    raise exception 'charge_resolution_invalid';
  end if;

  if v_charge.status <> 'pending' then
    raise exception 'charge_not_pending';
  end if;

  update public.student_operating_charges
  set status=v_status,
      resolved_at=clock_timestamp(),
      resolved_by_user_id=(select auth.uid()),
      resolution_note=nullif(trim(coalesce(p_note,'')),''),
      updated_at=clock_timestamp()
  where id=v_charge.id;
end;
$$;

revoke all on function public.admin_resolve_student_operating_charge(uuid,text,text)
from public,anon;
grant execute on function public.admin_resolve_student_operating_charge(uuid,text,text)
to authenticated;

create or replace function public.student_cancellation_preview(target_reservation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_policy public.studio_operating_policies%rowtype;
  v_outcome public.reservation_status;
  v_credit_cost integer;
  v_uses_credits boolean := false;
  v_unlimited boolean := false;
  v_penalty_minor integer := 0;
  v_currency text;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select * into v_reservation
  from public.reservations
  where id=target_reservation_id;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  if v_reservation.student_id is null
     or not private.is_current_student(
       v_reservation.student_id,
       v_reservation.studio_id
     ) then
    raise exception 'forbidden';
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_reservation.session_id
    and studio_id=v_reservation.studio_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok',false,
      'reason_code','reservation_not_cancellable'
    );
  end if;

  if v_reservation.acquisition_id is not null then
    select * into v_acquisition
    from public.product_acquisitions
    where id=v_reservation.acquisition_id
      and studio_id=v_reservation.studio_id;

    if found then
      v_unlimited := coalesce(v_acquisition.unlimited,false);
      v_uses_credits := not v_unlimited;
    end if;
  end if;

  v_credit_cost := greatest(coalesce(v_reservation.credits_held,1),1);
  v_outcome := private.reservation_cancellation_outcome(
    v_reservation.studio_id,
    v_session.starts_at
  );
  v_policy := private.studio_operating_policy(v_reservation.studio_id);

  if v_unlimited and v_outcome='cancelled_late' then
    v_penalty_minor := greatest(
      coalesce(v_policy.unlimited_late_cancellation_penalty_minor,0),
      0
    );
  end if;

  select currency into v_currency
  from public.studios
  where id=v_reservation.studio_id;

  return jsonb_build_object(
    'ok',true,
    'status',v_outcome::text,
    'late',v_outcome='cancelled_late',
    'uses_credits',v_uses_credits,
    'unlimited',v_unlimited,
    'credit_cost',v_credit_cost,
    'credit_will_return',
      case
        when not v_uses_credits then null
        else not private.reservation_credit_should_consume(
          v_reservation.studio_id,
          v_outcome
        )
      end,
    'unlimited_penalty_minor',v_penalty_minor,
    'currency',coalesce(v_currency,'MXN'),
    'cancellation_cutoff_minutes',v_policy.cancellation_cutoff_minutes
  );
end;
$$;

revoke all on function public.student_cancellation_preview(uuid)
from public,anon;
grant execute on function public.student_cancellation_preview(uuid)
to authenticated;
