-- CUMP-01 · Cumpleaños v1 (Claude, 23-oct-2026). Completa el pase de regalo de cumpleaños:
--  * CUMP-01-09  Configuración por estudio: regalo sí/no y regalarlo a una amiga sí/no.
--  * CUMP-01-03  Reserva con el pase: WhatsApp de la amiga válido (antes '^\\+…' rechazaba todos),
--                fecha en la zona horaria del estudio, talleres y clases con lugar fuera del pase.
--  * CUMP-01-04  Snapshot del portal: saludo del día aunque el regalo esté apagado, datos del uso.
--  * CUMP-01-07  Si la reserva con pase se cancela a tiempo (o la cancela el estudio), el pase regresa.
--  * CUMP-01-08  Estado del pase para el equipo (ficha de la alumna).
--  * CUMP-01-10  WhatsApp el día 1 del mes de cumpleaños (regla marketing.birthday_month, apagada).
-- Depende de 20261023100000_birthday_passes, 20261023100500_birthday_pass_snapshot_day y
-- 20261020163648_birthday_whatsapp_notifications.

-- ---------------------------------------------------------------------------------------------
-- 1. Configuración por estudio
-- ---------------------------------------------------------------------------------------------
create table if not exists public.studio_birthday_settings (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  gift_enabled boolean not null default true,
  gift_friend_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

alter table public.studio_birthday_settings enable row level security;
revoke all on table public.studio_birthday_settings from anon;
revoke insert, update, delete on table public.studio_birthday_settings from authenticated;
grant select on table public.studio_birthday_settings to authenticated;

drop policy if exists studio_birthday_settings_staff_read on public.studio_birthday_settings;
create policy studio_birthday_settings_staff_read
on public.studio_birthday_settings
for select
to authenticated
using (
  private.has_capability(studio_id, 'students.read')
  or private.has_capability(studio_id, 'settings.write')
);

create or replace function private.birthday_settings(p_studio_id uuid)
returns table(gift_enabled boolean, gift_friend_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(s.gift_enabled, true), coalesce(s.gift_friend_enabled, true)
  from (select 1) as d
  left join public.studio_birthday_settings s on s.studio_id = p_studio_id
$function$;
revoke all on function private.birthday_settings(uuid) from public, anon, authenticated;

create or replace function private.birthday_studio_today(p_studio_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $function$
  select (clock_timestamp() at time zone coalesce(
    (select nullif(trim(st.timezone), '') from public.studios st where st.id = p_studio_id),
    'America/Mexico_City'))::date
$function$;
revoke all on function private.birthday_studio_today(uuid) from public, anon, authenticated;

create or replace function public.admin_birthday_settings(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_settings record;
begin
  if (select auth.uid()) is null
     or not (private.has_capability(p_studio_id, 'students.read')
       or private.has_capability(p_studio_id, 'settings.write')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_settings from private.birthday_settings(p_studio_id);
  return jsonb_build_object(
    'gift_enabled', v_settings.gift_enabled,
    'gift_friend_enabled', v_settings.gift_friend_enabled
  );
end;
$function$;
revoke all on function public.admin_birthday_settings(uuid) from public, anon;
grant execute on function public.admin_birthday_settings(uuid) to authenticated;

create or replace function public.admin_update_birthday_settings(
  p_studio_id uuid,
  p_gift_enabled boolean,
  p_gift_friend_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not private.has_capability(p_studio_id, 'settings.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_gift_enabled is null or p_gift_friend_enabled is null then
    raise exception 'birthday_settings_invalid';
  end if;

  insert into public.studio_birthday_settings (studio_id, gift_enabled, gift_friend_enabled, updated_at, updated_by)
  values (p_studio_id, p_gift_enabled, p_gift_friend_enabled, clock_timestamp(), (select auth.uid()))
  on conflict (studio_id) do update set
    gift_enabled = excluded.gift_enabled,
    gift_friend_enabled = excluded.gift_friend_enabled,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  -- El aviso del día 1 habla del regalo: sin regalo, el aviso se apaga.
  if not p_gift_enabled then
    update public.notification_rules
    set enabled = false, updated_at = now()
    where studio_id = p_studio_id and rule_key = 'marketing.birthday_month' and enabled;
  end if;
end;
$function$;
revoke all on function public.admin_update_birthday_settings(uuid, boolean, boolean) from public, anon;
grant execute on function public.admin_update_birthday_settings(uuid, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Pase: solo se crea si el estudio tiene el regalo activo
-- ---------------------------------------------------------------------------------------------
create or replace function private.ensure_birthday_pass(p_student_id uuid, p_as_of date)
returns public.birthday_passes
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_birth date;
  v_start date;
  v_end date;
  v_pass public.birthday_passes%rowtype;
begin
  select * into v_student
  from public.students
  where id = p_student_id
    and private.is_current_student(id, studio_id);

  if not found then
    raise exception 'student_not_eligible';
  end if;

  if not (select s.gift_enabled from private.birthday_settings(v_student.studio_id) s) then
    raise exception 'birthday_gift_disabled';
  end if;

  v_birth := private.student_birth_date(v_student.id);
  if v_birth is null then
    raise exception 'birth_date_required';
  end if;

  if extract(month from v_birth)::integer <> extract(month from p_as_of)::integer then
    raise exception 'birthday_pass_not_in_month';
  end if;

  v_start := make_date(extract(year from p_as_of)::integer, extract(month from p_as_of)::integer, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;

  insert into public.birthday_passes(
    studio_id, student_id, birthday_year, period_start, expires_on
  )
  values(
    v_student.studio_id, v_student.id, extract(year from p_as_of)::integer, v_start, v_end
  )
  on conflict (studio_id, student_id, birthday_year) do nothing;

  select * into v_pass
  from public.birthday_passes
  where studio_id = v_student.studio_id
    and student_id = v_student.id
    and birthday_year = extract(year from p_as_of)::integer
  for update;

  return v_pass;
end;
$function$;
revoke all on function private.ensure_birthday_pass(uuid,date) from public, anon, authenticated;

-- Detalle legible del uso del pase (clase, fecha y nombre de pila de la amiga).
create or replace function private.birthday_pass_usage(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'used_class_name', ct.name,
    'used_starts_at', cs.starts_at,
    'recipient_name', case when bp.recipient_kind = 'friend' then nullif(p.first_name, '') end
  )
  from public.birthday_passes bp
  left join public.class_sessions cs on cs.id = bp.used_session_id
  left join public.class_templates ct on ct.id = cs.template_id
  left join public.persons p on p.id = bp.recipient_person_id
  where bp.id = p_pass_id
$function$;
revoke all on function private.birthday_pass_usage(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Snapshot del portal
-- ---------------------------------------------------------------------------------------------
create or replace function public.student_birthday_pass_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_today date;
  v_birth date;
  v_pass public.birthday_passes%rowtype;
  v_state text;
  v_is_birthday boolean;
  v_settings record;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  v_today := private.birthday_studio_today(v_student.studio_id);
  v_birth := private.student_birth_date(v_student.id);

  if v_birth is null then
    return jsonb_build_object('eligible', false, 'reason_code', 'birth_date_required', 'is_birthday', false);
  end if;

  -- Mismo criterio que Hoy y el WhatsApp: el 29 de febrero se festeja el 28 en años no bisiestos.
  v_is_birthday := private.birthday_occurs_on(to_char(v_birth, 'YYYY-MM-DD'), v_today);

  if extract(month from v_birth)::integer <> extract(month from v_today)::integer then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'outside_birthday_month',
      'birthday_month', extract(month from v_birth)::integer,
      'is_birthday', false
    );
  end if;

  select * into v_settings from private.birthday_settings(v_student.studio_id);
  if not v_settings.gift_enabled then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'gift_disabled',
      'is_birthday', v_is_birthday
    );
  end if;

  v_pass := private.ensure_birthday_pass(v_student.id, v_today);
  v_state := case
    when v_pass.status = 'used' then 'used'
    when v_today > v_pass.expires_on then 'expired'
    else 'available'
  end;

  return jsonb_build_object(
    'eligible', true,
    'pass_id', v_pass.id,
    'state', v_state,
    'period_start', v_pass.period_start,
    'expires_on', v_pass.expires_on,
    'today', v_today,
    'recipient_kind', v_pass.recipient_kind,
    'used_session_id', v_pass.used_session_id,
    'used_at', v_pass.used_at,
    'is_birthday', v_is_birthday,
    'friend_enabled', v_settings.gift_friend_enabled
  ) || case when v_pass.status = 'used' then coalesce(private.birthday_pass_usage(v_pass.id), '{}'::jsonb) else '{}'::jsonb end;
end;
$function$;
revoke all on function public.student_birthday_pass_snapshot() from public, anon;
grant execute on function public.student_birthday_pass_snapshot() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Reservar con el pase (para ella o para una amiga)
-- ---------------------------------------------------------------------------------------------
-- Una reserva cancelada a tiempo libera el pase: el índice único solo cuenta reservas vigentes.
drop index if exists public.reservations_birthday_pass_unique_idx;
create unique index if not exists reservations_birthday_pass_unique_idx
  on public.reservations(birthday_pass_id)
  where birthday_pass_id is not null
    and status not in ('cancelled_on_time', 'cancelled_by_studio');

create or replace function public.student_book_with_birthday_pass(
  target_session_id uuid,
  target_for text default 'self',
  target_friend_name text default null,
  target_friend_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_timezone text;
  v_today date;
  v_session_date date;
  v_pass public.birthday_passes%rowtype;
  v_reserved integer;
  v_reservation_id uuid;
  v_target_student public.students%rowtype;
  v_person public.persons%rowtype;
  v_friend_name text;
  v_phone text;
  v_first_name text;
  v_last_name text;
  v_settings record;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if coalesce(target_for, '') not in ('self','friend') then
    return jsonb_build_object('ok',false,'reason_code','recipient_invalid');
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select * into v_settings from private.birthday_settings(v_student.studio_id);
  if not v_settings.gift_enabled then
    return jsonb_build_object('ok',false,'reason_code','birthday_gift_disabled');
  end if;
  if target_for = 'friend' and not v_settings.gift_friend_enabled then
    return jsonb_build_object('ok',false,'reason_code','birthday_friend_disabled');
  end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
    and studio_id = v_student.studio_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;

  select * into v_template from public.class_templates where id = v_session.template_id;
  if v_template.workshop_offer_id is not null then
    return jsonb_build_object('ok',false,'reason_code','birthday_pass_not_for_workshops');
  end if;
  if coalesce(v_session.requires_resource, false) then
    return jsonb_build_object('ok',false,'reason_code','birthday_pass_resource_unsupported');
  end if;

  select coalesce(nullif(trim(st.timezone), ''),'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id = v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_session_date := (v_session.starts_at at time zone v_timezone)::date;

  begin
    v_pass := private.ensure_birthday_pass(v_student.id, v_today);
  exception
    when others then
      return jsonb_build_object('ok',false,'reason_code',sqlerrm);
  end;

  select * into v_pass
  from public.birthday_passes
  where id = v_pass.id
  for update;

  if v_pass.status <> 'available' then
    return jsonb_build_object('ok',false,'reason_code','birthday_pass_already_used');
  end if;

  if v_session_date < v_pass.period_start or v_session_date > v_pass.expires_on then
    return jsonb_build_object('ok',false,'reason_code','birthday_pass_outside_validity');
  end if;

  select count(*)::integer into v_reserved
  from public.reservations r
  where r.session_id = v_session.id
    and r.status in ('reserved','attended');

  if v_reserved >= v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  if target_for = 'self' then
    if exists(
      select 1 from public.reservations r
      where r.session_id=v_session.id
        and r.student_id=v_student.id
        and r.status in ('reserved','attended')
    ) then
      return jsonb_build_object('ok',false,'reason_code','already_reserved');
    end if;

    insert into public.reservations(
      studio_id, session_id, student_id, student_user_id,
      status, credits_held, birthday_pass_id
    )
    values(
      v_student.studio_id, v_session.id, v_student.id, v_student.user_id,
      'reserved', 0, v_pass.id
    )
    returning id into v_reservation_id;

    update public.birthday_passes
    set status='used',
        recipient_kind='self',
        recipient_student_id=v_student.id,
        recipient_person_id=v_student.person_id,
        used_session_id=v_session.id,
        used_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_pass.id;

  else
    v_friend_name := regexp_replace(trim(coalesce(target_friend_name,'')), '\s+', ' ', 'g');
    if v_friend_name = '' or length(v_friend_name) > 120 then
      return jsonb_build_object('ok',false,'reason_code','friend_name_required');
    end if;

    -- Acepta 10 dígitos de México o el número con lada internacional.
    v_phone := regexp_replace(coalesce(target_friend_phone,''), '[^0-9+]', '', 'g');
    if v_phone ~ '^[0-9]{10}$' then
      v_phone := '+52' || v_phone;
    end if;
    if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      return jsonb_build_object('ok',false,'reason_code','friend_phone_invalid');
    end if;

    perform pg_advisory_xact_lock(hashtext(v_student.studio_id::text||':birthday:'||v_phone));

    select p.* into v_person
    from public.person_contacts pc
    join public.persons p on p.id=pc.person_id and p.studio_id=pc.studio_id
    where pc.studio_id=v_student.studio_id
      and pc.kind='phone'
      and lower(pc.value)=lower(v_phone)
    order by p.created_at asc
    limit 1;

    if found and v_person.id = v_student.person_id then
      return jsonb_build_object('ok',false,'reason_code','friend_is_self');
    end if;

    if not found then
      v_first_name:=split_part(v_friend_name,' ',1);
      v_last_name:=nullif(trim(substr(v_friend_name,length(v_first_name)+1)),'');
      insert into public.persons(studio_id,first_name,last_name)
      values(v_student.studio_id,v_first_name,v_last_name)
      returning * into v_person;

      insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
      values(v_person.id,v_student.studio_id,'phone',v_phone,true);

      insert into public.crm_contacts(studio_id,person_id,lifecycle_status,source)
      values(v_student.studio_id,v_person.id,'trial','birthday_pass')
      on conflict do nothing;
    end if;

    select s.* into v_target_student
    from public.students s
    where s.studio_id=v_student.studio_id
      and s.person_id=v_person.id
      and private.is_current_student(s.id,s.studio_id)
    order by s.created_at asc
    limit 1;

    if v_target_student.id is not null then
      if exists(
        select 1 from public.reservations r
        where r.session_id=v_session.id
          and r.student_id=v_target_student.id
          and r.status in ('reserved','attended')
      ) then
        return jsonb_build_object('ok',false,'reason_code','friend_already_reserved');
      end if;

      insert into public.reservations(
        studio_id, session_id, student_id, student_user_id,
        status, credits_held, birthday_pass_id
      )
      values(
        v_student.studio_id, v_session.id, v_target_student.id, v_target_student.user_id,
        'reserved', 0, v_pass.id
      )
      returning id into v_reservation_id;
    else
      if exists(
        select 1 from public.reservations r
        where r.session_id=v_session.id
          and r.guest_person_id=v_person.id
          and r.status in ('reserved','attended')
      ) then
        return jsonb_build_object('ok',false,'reason_code','friend_already_reserved');
      end if;

      insert into public.reservations(
        studio_id, session_id, guest_person_id,
        status, credits_held, birthday_pass_id
      )
      values(
        v_student.studio_id, v_session.id, v_person.id,
        'reserved', 0, v_pass.id
      )
      returning id into v_reservation_id;
    end if;

    update public.birthday_passes
    set status='used',
        recipient_kind='friend',
        recipient_student_id=v_target_student.id,
        recipient_person_id=v_person.id,
        used_session_id=v_session.id,
        used_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=v_pass.id;
  end if;

  perform public.emit_domain_event(
    v_student.studio_id,
    'booking.created',
    'reservation',
    v_reservation_id,
    'booking.created:' || v_reservation_id::text,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'reservation_id',v_reservation_id,
      'session_id',v_session.id,
      'birthday_pass_id',v_pass.id,
      'birthday_student_id',v_student.id,
      'recipient_kind',target_for,
      'source','birthday_pass'
    ),
    null,null,null
  );

  return jsonb_build_object(
    'ok',true,
    'reservation_id',v_reservation_id,
    'pass_id',v_pass.id,
    'recipient_kind',target_for
  );
end;
$function$;
revoke all on function public.student_book_with_birthday_pass(uuid,text,text,text) from public, anon;
grant execute on function public.student_book_with_birthday_pass(uuid,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Cancelación: el pase regresa si se cancela a tiempo o si el estudio cancela la clase
-- ---------------------------------------------------------------------------------------------
create or replace function private.birthday_pass_restore_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'reserved'
     and new.status in ('cancelled_on_time', 'cancelled_by_studio') then
    update public.birthday_passes
    set status = 'available',
        recipient_kind = null,
        recipient_student_id = null,
        recipient_person_id = null,
        used_session_id = null,
        used_at = null,
        updated_at = clock_timestamp()
    where id = new.birthday_pass_id
      and status = 'used'
      and used_session_id = new.session_id;
  end if;
  return new;
end;
$function$;
revoke all on function private.birthday_pass_restore_on_cancel() from public, anon, authenticated;

drop trigger if exists zz_birthday_pass_restore_on_cancel on public.reservations;
create trigger zz_birthday_pass_restore_on_cancel
after update of status on public.reservations
for each row
when (new.birthday_pass_id is not null and old.status is distinct from new.status)
execute function private.birthday_pass_restore_on_cancel();

-- ---------------------------------------------------------------------------------------------
-- 6. Estado del pase para el equipo
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_student_birthday_pass(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_today date;
  v_birth date;
  v_pass public.birthday_passes%rowtype;
  v_settings record;
  v_in_month boolean;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found then
    raise exception 'student_not_found';
  end if;
  if (select auth.uid()) is null or not private.has_capability(v_student.studio_id, 'students.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_today := private.birthday_studio_today(v_student.studio_id);
  v_birth := private.student_birth_date(v_student.id);
  select * into v_settings from private.birthday_settings(v_student.studio_id);

  if v_birth is null then
    return jsonb_build_object('has_birth_date', false, 'gift_enabled', v_settings.gift_enabled);
  end if;

  v_in_month := extract(month from v_birth) = extract(month from v_today);

  select * into v_pass
  from public.birthday_passes
  where studio_id = v_student.studio_id
    and student_id = v_student.id
    and birthday_year = extract(year from v_today)::integer;

  return jsonb_build_object(
    'has_birth_date', true,
    'birthday_month', extract(month from v_birth)::integer,
    'in_birthday_month', v_in_month,
    'is_birthday', private.birthday_occurs_on(to_char(v_birth, 'YYYY-MM-DD'), v_today),
    'gift_enabled', v_settings.gift_enabled,
    'current_student', private.is_current_student(v_student.id, v_student.studio_id),
    'pass', case when v_pass.id is null then null else
      jsonb_build_object(
        'state', case
          when v_pass.status = 'used' then 'used'
          when v_today > v_pass.expires_on then 'expired'
          else 'available' end,
        'period_start', v_pass.period_start,
        'expires_on', v_pass.expires_on,
        'recipient_kind', v_pass.recipient_kind,
        'used_at', v_pass.used_at
      ) || case when v_pass.status = 'used' then coalesce(private.birthday_pass_usage(v_pass.id), '{}'::jsonb) else '{}'::jsonb end
    end
  );
end;
$function$;
revoke all on function public.admin_student_birthday_pass(uuid) from public, anon;
grant execute on function public.admin_student_birthday_pass(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. WhatsApp el día 1 del mes de cumpleaños (regla marketing.birthday_month, apagada)
-- ---------------------------------------------------------------------------------------------
create or replace function private.birthday_month_notification_candidates(p_studio_id uuid, p_month_start date)
returns table(student_id uuid, full_name text)
language sql
stable
set search_path = ''
as $function$
  select s.id, s.full_name
  from public.students s
  join public.studios st on st.id = s.studio_id and st.status = 'active'
  where s.studio_id = p_studio_id
    and p_month_start is not null
    and extract(day from p_month_start) = 1
    and (select b.gift_enabled from private.birthday_settings(p_studio_id) b)
    and s.active and s.lifecycle_status = 'active'
    and (s.student_type = 'regular' or (s.student_type = 'trial' and s.trial_status = 'converted'))
    and exists (
      select 1 from public.profile_field_definitions d
      join public.profile_field_values v on v.definition_id = d.id and v.studio_id = d.studio_id
        and v.person_id = s.person_id
      where d.studio_id = s.studio_id and d.entity_type = 'student' and d.key = 'birth_date' and d.active
        and (v.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and substr(v.value #>> '{}', 6, 2)::integer = extract(month from p_month_start)::integer
    )
    and (
      exists(select 1 from public.student_enrollments e where e.student_id = s.id and e.studio_id = s.studio_id
        and e.refunded_at is null and e.status = 'active' and e.starts_on <= p_month_start
        and (e.expires_on is null or e.expires_on >= p_month_start))
      or not exists(select 1 from public.student_enrollments e where e.student_id = s.id and e.studio_id = s.studio_id
        and e.refunded_at is null and (e.status = 'expired' or (e.status = 'active' and e.expires_on < p_month_start)))
    );
$function$;
revoke all on function private.birthday_month_notification_candidates(uuid, date) from public, anon, authenticated, service_role;

create or replace function public.admin_birthday_month_notification_preview(p_studio_id uuid, p_month_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_start date := date_trunc('month', p_month_start)::date;
begin
  if (select auth.uid()) is null or not private.has_capability(p_studio_id, 'automations.read')
     or not exists(select 1 from public.studio_memberships m where m.user_id = (select auth.uid())
       and m.studio_id = p_studio_id and m.active and m.role in ('owner','admin','reception')) then
    raise exception 'forbidden';
  end if;
  if p_month_start is null then
    raise exception 'birthday_date_required';
  end if;
  select jsonb_build_object('month_start', v_start, 'total', count(*), 'students', coalesce(jsonb_agg(
    jsonb_build_object('id', c.student_id, 'name', c.full_name) order by c.full_name), '[]'::jsonb))
  into v_result
  from private.birthday_month_notification_candidates(p_studio_id, v_start) c;
  return v_result;
end;
$function$;
revoke all on function public.admin_birthday_month_notification_preview(uuid, date) from public, anon;
grant execute on function public.admin_birthday_month_notification_preview(uuid, date) to authenticated;

-- Revalidación antes de entregar: sigue siendo su mes (primeros 3 días) y sigue siendo elegible.
create or replace function public.system_birthday_month_notification_eligible(
  p_studio_id uuid,
  p_student_id uuid,
  p_month_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_month_start is not null
    and private.birthday_studio_today(p_studio_id) between p_month_start and p_month_start + 2
    and exists(
      select 1 from private.birthday_month_notification_candidates(p_studio_id, p_month_start) c
      where c.student_id = p_student_id
    );
$function$;
revoke all on function public.system_birthday_month_notification_eligible(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.system_birthday_month_notification_eligible(uuid, uuid, date) to service_role;

create or replace function private.seed_birthday_month_notification_rule(p_studio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  r public.notification_rules%rowtype;
  old_version public.notification_rule_versions%rowtype;
  next_version integer;
begin
  insert into public.notification_rules(studio_id, rule_key, event_type, enabled, current_version_number)
  values(p_studio_id, 'marketing.birthday_month', 'student.birthday_month_due', false, 1)
  on conflict(studio_id, rule_key) do nothing;

  select * into r from public.notification_rules
  where studio_id = p_studio_id and rule_key = 'marketing.birthday_month' for update;
  if r.archived_at is not null then return; end if;
  if r.event_type <> 'student.birthday_month_due' then raise exception 'birthday_month_rule_conflict'; end if;

  select * into old_version from public.notification_rule_versions
  where rule_id = r.id and version_number = r.current_version_number;
  if found and old_version.template_key = 'birthday_month'
     and old_version.revalidation_strategy_key = 'birthday_month_start'
     and exists(select 1 from public.notification_rule_channels c
       where c.rule_id = r.id and c.version_number = r.current_version_number and c.channel_key = 'whatsapp')
     and not exists(select 1 from public.notification_rule_channels c
       where c.rule_id = r.id and c.version_number = r.current_version_number and c.channel_key <> 'whatsapp') then
    return;
  end if;

  next_version := case when old_version.rule_id is null then r.current_version_number else r.current_version_number + 1 end;
  insert into public.notification_rule_versions(studio_id, rule_id, version_number, notification_type, communication_class,
    priority, recipient_strategy_key, conditions, timing_strategy_key, timing_config, revalidation_strategy_key,
    template_key, expires_after_seconds, activated_at)
  values(p_studio_id, r.id, next_version, 'birthday_month', 'P2', 'low', 'payload_student',
    coalesce(old_version.conditions, '{}'::jsonb), 'immediate', '{}'::jsonb, 'birthday_month_start',
    'birthday_month', 259200, clock_timestamp());
  -- Solo WhatsApp, igual que la felicitación del día.
  insert into public.notification_rule_channels(studio_id, rule_id, version_number, channel_key, is_required, ordinal, channel_policy)
  values(p_studio_id, r.id, next_version, 'whatsapp', true, 2, '{"provider_key":"meta_whatsapp","delivery_max_attempts":3}'::jsonb);
  update public.notification_rules set current_version_number = next_version, enabled = false, updated_at = now()
  where id = r.id;
end;
$function$;
revoke all on function private.seed_birthday_month_notification_rule(uuid) from public, anon, authenticated, service_role;

create or replace function private.seed_birthday_month_notification_rule_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.seed_birthday_month_notification_rule(new.id);
  return new;
end;
$function$;
revoke all on function private.seed_birthday_month_notification_rule_trigger() from public, anon, authenticated, service_role;

drop trigger if exists zzz_studios_seed_birthday_month_notification on public.studios;
create trigger zzz_studios_seed_birthday_month_notification after insert on public.studios
for each row execute function private.seed_birthday_month_notification_rule_trigger();

do $seed$
declare
  s record;
begin
  for s in select id from public.studios loop
    perform private.seed_birthday_month_notification_rule(s.id);
  end loop;
end
$seed$;

create or replace function private.notification_emit_birthday_months_due_at(p_at timestamptz, p_studio_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate record;
  emitted integer := 0;
begin
  if p_at is null then raise exception 'birthday_time_required'; end if;
  for candidate in
    select st.id as studio_id, c.student_id, d.local_day
    from public.studios st
    join public.notification_rules r on r.studio_id = st.id
      and r.rule_key = 'marketing.birthday_month' and r.enabled and r.archived_at is null
    cross join lateral (
      select (p_at at time zone coalesce(nullif(trim(st.timezone), ''), 'America/Mexico_City'))::date as local_day
    ) d
    cross join lateral private.birthday_month_notification_candidates(st.id, d.local_day) c
    where (p_studio_id is null or st.id = p_studio_id)
      and extract(day from d.local_day) = 1
      and not exists(select 1 from public.domain_events e
        where e.studio_id = st.id
          and e.deduplication_key = 'notification:student.birthday_month_due:' || st.id::text || ':'
            || c.student_id::text || ':' || extract(year from d.local_day)::text)
  loop
    if private.notification_try_emit_domain_event(candidate.studio_id, 'student.birthday_month_due', 'student',
      candidate.student_id,
      'notification:student.birthday_month_due:' || candidate.studio_id::text || ':' || candidate.student_id::text
        || ':' || extract(year from candidate.local_day)::text,
      jsonb_build_object('student_id', candidate.student_id, 'month_start', candidate.local_day), null, p_at) is not null then
      emitted := emitted + 1;
    end if;
  end loop;
  return emitted;
end;
$function$;
revoke all on function private.notification_emit_birthday_months_due_at(timestamptz, uuid) from public, anon, authenticated, service_role;

-- El cron existente (studio_flow_birthdays_due, cada 15 min) también revisa el día 1.
create or replace function private.notification_emit_birthdays_due()
returns integer
language sql
security definer
set search_path = ''
as $function$
  select private.notification_emit_birthdays_due_at(clock_timestamp())
    + private.notification_emit_birthday_months_due_at(clock_timestamp());
$function$;
revoke all on function private.notification_emit_birthdays_due() from public, anon, authenticated, service_role;

-- La plantilla del día 1 se puede asignar desde Notificaciones (lista permitida de claves).
do $migration$
declare
  v_sig text := 'public.admin_update_meta_whatsapp_templates(uuid,text,text,jsonb)';
  v_def text;
begin
  if to_regprocedure(v_sig) is null then
    raise notice 'CUMP-01: % no existe en esta base; se omite', v_sig;
    return;
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if position('''birthday_month''' in v_def) > 0 then
    return;
  end if;
  if position('''birthday'',' in v_def) = 0 then
    raise exception 'CUMP-01: definición inesperada de %: falta la clave birthday', v_sig;
  end if;
  execute replace(v_def, '''birthday'',', '''birthday'',''birthday_month'',');
end
$migration$;
