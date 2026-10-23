-- NEB-01-35 · Nébora: "hoy" en la hora de cada estudio.
-- Nébora v1 es solo para México, pero un estudio puede estar en Tijuana, Cancún o Hermosillo.
-- La base de datos corre en UTC: current_date ya es "mañana" desde las 18:00 en el centro del
-- país. Aquí se corrigen los puntos donde eso cambia un dato que se guarda:
--  * La fecha de cada pago (payments.effective_on): toma la fecha local del estudio.
--  * El paso de alumna a ex-alumna por inactividad (CRM): cuenta los días con la fecha local.
--  * La validación de fecha de nacimiento: usa la zona del estudio, no la de CDMX fija.
-- Sin cambio para Demeter salvo que los pagos registrados de noche ya quedan con la fecha
-- correcta (antes quedaban con la fecha del día siguiente).
-- Pendiente de bajo impacto (documentado en NEB-01-35): student_is_minor y la fecha por
-- defecto de evaluaciones técnicas siguen usando current_date.

create or replace function private.studio_timezone(p_studio uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- La zona se valida al guardarla (owner_update_studio_regional_settings_v2_release).
  select coalesce(
    (select nullif(btrim(s.timezone), '') from public.studios s where s.id = p_studio),
    'America/Mexico_City');
$$;
revoke all on function private.studio_timezone(uuid) from public, anon;
grant execute on function private.studio_timezone(uuid) to authenticated, service_role;

create or replace function private.studio_local_today(p_studio uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone private.studio_timezone(p_studio))::date;
$$;
revoke all on function private.studio_local_today(uuid) from public, anon;
grant execute on function private.studio_local_today(uuid) to authenticated, service_role;

-- Pagos: si no se manda fecha, se usa la fecha local del estudio.
alter table public.payments alter column effective_on drop default;

create or replace function private.neb_payment_local_effective_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.effective_on is null then
    new.effective_on := private.studio_local_today(new.studio_id);
  end if;
  return new;
end;
$$;
revoke all on function private.neb_payment_local_effective_on() from public, anon, authenticated;

drop trigger if exists neb_payment_local_effective_on on public.payments;
create trigger neb_payment_local_effective_on before insert on public.payments
  for each row execute function private.neb_payment_local_effective_on();

-- Mismas funciones que antes; solo cambia current_date por la fecha local del estudio.

-- register_sale_payment: en algunas bases ya delega en admin_register_sale_payment (que ya usa la
-- fecha del estudio). Solo se ajusta si todavía guarda current_date; así no se pisa una versión nueva.
do $migration$
declare
  v_sig text := 'public.register_sale_payment(uuid,integer,text,text,text)';
  v_def text;
  v_old constant text := 'nullif(trim(coalesce(payment_notes,'''')),''''),
    current_date,(select auth.uid()));';
  v_new constant text := 'nullif(trim(coalesce(payment_notes,'''')),''''),
    private.studio_local_today(v_sale.studio_id),(select auth.uid()));';
begin
  if to_regprocedure(v_sig) is null then
    raise notice 'NEB-01: % no existe en esta base; se omite', v_sig;
    return;
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if position('public.admin_register_sale_payment(' in v_def) > 0 then
    raise notice 'NEB-01: % ya delega en admin_register_sale_payment (fecha local); se omite', v_sig;
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'NEB-01: definición inesperada de % (fecha del pago)', v_sig;
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

create or replace function private.refresh_crm_lifecycle_history()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_inserted integer;
begin
  with source as (
    select s.id student_id,s.studio_id,s.person_id,
      private.studio_local_today(s.studio_id) local_today,
      coalesce(cfg.inactivity_days,15) inactivity_days,
      coalesce(pkg.inactive_since,enr.inactive_since,s.created_at::date) inactive_since,
      exists (
        select 1 from public.product_acquisitions pa
        join public.product_templates pt on pt.id=pa.product_template_id and pt.studio_id=pa.studio_id
        where pa.studio_id=s.studio_id and pa.student_id=s.id and pa.refunded_at is null
          and pa.status='active' and pt.product_type='package'
          and pa.starts_on <= private.studio_local_today(s.studio_id) and pa.expires_on >= private.studio_local_today(s.studio_id)
      ) has_active_package
    from public.students s
    left join public.crm_lifecycle_settings cfg on cfg.studio_id=s.studio_id
    left join lateral (
      select max(pa.expires_on) inactive_since
      from public.product_acquisitions pa
      join public.product_templates pt on pt.id=pa.product_template_id and pt.studio_id=pa.studio_id
      where pa.studio_id=s.studio_id and pa.student_id=s.id and pa.refunded_at is null
        and pa.status <> 'cancelled' and pa.starts_on <= private.studio_local_today(s.studio_id) and pt.product_type='package'
    ) pkg on true
    left join lateral (
      select max(e.starts_on) inactive_since
      from public.student_enrollments e
      where e.studio_id=s.studio_id and e.student_id=s.id and e.refunded_at is null
        and e.status <> 'cancelled'
    ) enr on true
    where s.archived_at is null and s.active and s.lifecycle_status='active'
      and s.student_type='regular' and s.person_id is not null
  ), projected as (
    select source.*,
      case when not has_active_package
        and local_today - inactive_since >= inactivity_days
        then 'former_student' else 'student' end to_type
    from source
  ), latest as (
    select distinct on (h.student_id) h.student_id,h.to_type
    from public.crm_lifecycle_history h
    order by h.student_id,h.changed_at desc,h.id desc
  ), changed as (
    select p.*,coalesce(l.to_type,'student') from_type
    from projected p left join latest l using(student_id)
    where coalesce(l.to_type,'student') <> p.to_type
  )
  insert into public.crm_lifecycle_history(studio_id,student_id,person_id,from_type,to_type,inactivity_days,inactive_since)
  select studio_id,student_id,person_id,from_type,to_type,inactivity_days,inactive_since from changed;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

create or replace function private.student_set_reward_onboarding_birth_date(
  p_student_id uuid,
  p_birth_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_definition_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_student
  from public.students
  where id = p_student_id
    and user_id = (select auth.uid())
    and private.is_current_student(id, studio_id)
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;
  if not private.has_capability(v_student.studio_id, 'student.profile.self') then
    raise exception 'forbidden';
  end if;
  if p_birth_date is null then raise exception 'birth_date_required'; end if;
  if p_birth_date < date '1900-01-01'
     or p_birth_date > private.studio_local_today(v_student.studio_id) then
    raise exception 'birth_date_invalid';
  end if;

  select d.id into v_definition_id
  from public.profile_field_definitions d
  where d.studio_id = v_student.studio_id
    and d.entity_type = 'student'
    and d.key = 'birth_date'
    and d.active = true
  limit 1;

  if v_definition_id is null then raise exception 'birth_date_field_missing'; end if;

  insert into public.profile_field_values(
    definition_id,
    person_id,
    studio_id,
    value
  )
  values (
    v_definition_id,
    v_student.person_id,
    v_student.studio_id,
    to_jsonb(p_birth_date::text)
  )
  on conflict (definition_id, person_id)
  do update set
    value = excluded.value,
    updated_at = now();

  perform private.reward_onboarding_refresh_profile(v_student.id);
end;
$$;
