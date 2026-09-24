-- REWARDS · rollout del onboarding a alumnas activas existentes.
-- Conserva la Medalla histórica/actual, pero exige completar los 6 hitos
-- antes de habilitar el acceso al programa de Medallas.

create or replace function private.reward_onboarding_try_unlock(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_onboarding public.reward_onboarding%rowtype;
  v_timezone text;
  v_activated_on date;
  v_created boolean := false;
  v_had_membership boolean := false;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'reward_onboarding_student_not_found';
  end if;

  insert into public.reward_onboarding(studio_id,student_id)
  values(v_student.studio_id,v_student.id)
  on conflict(studio_id,student_id) do nothing;

  select * into v_onboarding
  from public.reward_onboarding
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  for update;

  if v_onboarding.access_unlocked_at is not null then
    return jsonb_build_object(
      'access_unlocked',true,
      'created',false,
      'method',v_onboarding.access_method
    );
  end if;

  if v_onboarding.documents_completed_at is null
     or v_onboarding.profile_completed_at is null
     or v_onboarding.app_installed_at is null
     or v_onboarding.notifications_enabled_at is null
     or v_onboarding.first_reservation_at is null
     or v_onboarding.first_attendance_at is null then
    return jsonb_build_object(
      'access_unlocked',false,
      'created',false,
      'method',null
    );
  end if;

  select coalesce(s.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

  select exists(
    select 1
    from public.reward_status_memberships m
    where m.studio_id = v_student.studio_id
      and m.student_id = v_student.id
  ) into v_had_membership;

  if not v_had_membership then
    insert into public.reward_status_memberships(
      studio_id,student_id,current_level_key,activated_on,level_effective_from
    )
    values(
      v_student.studio_id,
      v_student.id,
      null,
      v_activated_on,
      date_trunc('month',v_activated_on)::date
    )
    on conflict(studio_id,student_id) do nothing
    returning true into v_created;
  end if;

  update public.reward_onboarding
  set completed_at = coalesce(completed_at,now()),
      access_unlocked_at = coalesce(access_unlocked_at,now()),
      access_method = coalesce(access_method,'onboarding'),
      updated_at = now()
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  insert into public.reward_status_events(
    studio_id,student_id,period_start,event_type,
    from_level_key,to_level_key,details
  )
  values(
    v_student.studio_id,
    v_student.id,
    date_trunc('month',v_activated_on)::date,
    'access_unlocked',
    null,
    null,
    jsonb_build_object(
      'source','reward_onboarding',
      'existing_membership_preserved',v_had_membership,
      'documents_completed_at',v_onboarding.documents_completed_at,
      'profile_completed_at',v_onboarding.profile_completed_at,
      'app_installed_at',v_onboarding.app_installed_at,
      'notifications_enabled_at',v_onboarding.notifications_enabled_at,
      'first_reservation_at',v_onboarding.first_reservation_at,
      'first_attendance_at',v_onboarding.first_attendance_at
    )
  );

  return jsonb_build_object(
    'access_unlocked',true,
    'created',coalesce(v_created,false),
    'method','onboarding',
    'existing_membership_preserved',v_had_membership
  );
end;
$$;

revoke all on function private.reward_onboarding_try_unlock(uuid)
from public, anon, authenticated, service_role;

-- Las alumnas regulares actualmente activas deben pasar por el onboarding.
-- Se conserva su Medalla vigente en reward_status_memberships.
update public.reward_onboarding o
set access_unlocked_at = null,
    access_acknowledged_at = null,
    access_method = null,
    access_unlocked_by = null,
    access_reason = null,
    completed_at = null,
    bronze_unlocked_at = null,
    bronze_acknowledged_at = null,
    unlock_method = null,
    unlocked_by = null,
    unlock_reason = null,
    updated_at = now()
from public.students s
where s.id = o.student_id
  and s.studio_id = o.studio_id
  and s.active = true
  and s.archived_at is null
  and s.lifecycle_status = 'active'
  and s.student_type = 'regular';

-- Recalcula hitos que sí pueden demostrarse con evidencia histórica.
do $$
declare
  v_student record;
begin
  for v_student in
    select s.id
    from public.students s
    where s.active = true
      and s.archived_at is null
      and s.lifecycle_status = 'active'
      and s.student_type = 'regular'
    order by s.created_at, s.id
  loop
    perform private.reward_onboarding_refresh_profile(v_student.id);
    perform private.document_refresh_rewards_onboarding(v_student.id);
    perform private.reward_onboarding_try_unlock(v_student.id);
  end loop;
end
$$;
