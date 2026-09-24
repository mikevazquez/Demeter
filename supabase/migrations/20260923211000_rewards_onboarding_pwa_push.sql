-- REWARDS · onboarding previo a Medalla Bronce · PWA + Push
-- Bronce requiere ahora 6 hitos: documentos, perfil, app instalada,
-- notificaciones activadas, primera reserva y primera asistencia.

alter table public.reward_onboarding
  add column if not exists app_installed_at timestamptz,
  add column if not exists app_install_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(app_install_evidence) = 'object'),
  add column if not exists notifications_enabled_at timestamptz,
  add column if not exists first_push_subscription_id uuid
    references public.push_subscriptions(id) on delete set null,
  add column if not exists notifications_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(notifications_evidence) = 'object');

create index if not exists reward_onboarding_first_push_subscription_idx
  on public.reward_onboarding(first_push_subscription_id)
  where first_push_subscription_id is not null;

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
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then raise exception 'reward_onboarding_student_not_found'; end if;

  insert into public.reward_onboarding(studio_id, student_id)
  values (v_student.studio_id, v_student.id)
  on conflict (studio_id, student_id) do nothing;

  select * into v_onboarding
  from public.reward_onboarding
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  for update;

  if v_onboarding.bronze_unlocked_at is not null then
    return jsonb_build_object(
      'unlocked', true,
      'created', false,
      'method', v_onboarding.unlock_method
    );
  end if;

  if exists (
    select 1
    from public.reward_status_memberships m
    where m.studio_id = v_student.studio_id
      and m.student_id = v_student.id
  ) then
    update public.reward_onboarding
    set bronze_unlocked_at = coalesce(bronze_unlocked_at, now()),
        bronze_acknowledged_at = coalesce(bronze_acknowledged_at, now()),
        unlock_method = coalesce(unlock_method, 'legacy'),
        updated_at = now()
    where studio_id = v_student.studio_id
      and student_id = v_student.id;

    return jsonb_build_object(
      'unlocked', true,
      'created', false,
      'method', 'legacy'
    );
  end if;

  if v_onboarding.documents_completed_at is null
     or v_onboarding.profile_completed_at is null
     or v_onboarding.app_installed_at is null
     or v_onboarding.notifications_enabled_at is null
     or v_onboarding.first_reservation_at is null
     or v_onboarding.first_attendance_at is null then
    return jsonb_build_object(
      'unlocked', false,
      'created', false,
      'method', null
    );
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

  insert into public.reward_status_memberships(
    studio_id,
    student_id,
    current_level_key,
    activated_on,
    level_effective_from
  )
  values (
    v_student.studio_id,
    v_student.id,
    'bronze',
    v_activated_on,
    date_trunc('month', v_activated_on)::date
  )
  on conflict (studio_id, student_id) do nothing
  returning true into v_created;

  update public.reward_onboarding
  set completed_at = coalesce(completed_at, now()),
      bronze_unlocked_at = coalesce(bronze_unlocked_at, now()),
      unlock_method = coalesce(unlock_method, 'onboarding'),
      updated_at = now()
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  if coalesce(v_created, false) then
    insert into public.reward_status_events(
      studio_id,
      student_id,
      period_start,
      event_type,
      from_level_key,
      to_level_key,
      details
    )
    values (
      v_student.studio_id,
      v_student.id,
      date_trunc('month', v_activated_on)::date,
      'activated',
      null,
      'bronze',
      jsonb_build_object(
        'source', 'reward_onboarding',
        'documents_completed_at', v_onboarding.documents_completed_at,
        'profile_completed_at', v_onboarding.profile_completed_at,
        'app_installed_at', v_onboarding.app_installed_at,
        'notifications_enabled_at', v_onboarding.notifications_enabled_at,
        'first_reservation_at', v_onboarding.first_reservation_at,
        'first_attendance_at', v_onboarding.first_attendance_at
      )
    );
  end if;

  return jsonb_build_object(
    'unlocked', true,
    'created', coalesce(v_created,false),
    'method', 'onboarding'
  );
end;
$$;

revoke all on function private.reward_onboarding_try_unlock(uuid)
from public, anon, authenticated, service_role;

create or replace function public.student_confirm_reward_app_installation(
  p_display_mode text,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_student public.students%rowtype;
  v_display_mode text := lower(trim(coalesce(p_display_mode, '')));
  v_platform text := nullif(trim(coalesce(p_platform, '')), '');
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  if v_display_mode not in ('standalone', 'ios-standalone') then
    raise exception 'reward_onboarding_install_not_detected';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = v_user_id
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  insert into public.reward_onboarding(
    studio_id,
    student_id,
    app_installed_at,
    app_install_evidence
  )
  values (
    v_student.studio_id,
    v_student.id,
    clock_timestamp(),
    jsonb_build_object(
      'display_mode', v_display_mode,
      'platform', v_platform,
      'detected_by', 'pwa_runtime'
    )
  )
  on conflict (studio_id, student_id)
  do update set
    app_installed_at = coalesce(
      public.reward_onboarding.app_installed_at,
      excluded.app_installed_at
    ),
    app_install_evidence = case
      when public.reward_onboarding.app_installed_at is null
        then excluded.app_install_evidence
      else public.reward_onboarding.app_install_evidence
    end,
    updated_at = clock_timestamp();

  perform private.reward_onboarding_try_unlock(v_student.id);

  return jsonb_build_object('ok', true, 'installed', true);
end;
$$;

revoke all on function public.student_confirm_reward_app_installation(text,text)
from public, anon, service_role;
grant execute on function public.student_confirm_reward_app_installation(text,text)
to authenticated;

create or replace function private.reward_onboarding_capture_push_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  if new.revoked_at is not null then
    return new;
  end if;

  select s.id into v_student_id
  from public.students s
  where s.studio_id = new.studio_id
    and s.user_id = new.user_id
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student_id is null then
    return new;
  end if;

  insert into public.reward_onboarding(
    studio_id,
    student_id,
    notifications_enabled_at,
    first_push_subscription_id,
    notifications_evidence
  )
  values (
    new.studio_id,
    v_student_id,
    clock_timestamp(),
    new.id,
    jsonb_build_object(
      'device_label', new.device_label,
      'captured_from', 'push_subscription'
    )
  )
  on conflict (studio_id, student_id)
  do update set
    notifications_enabled_at = coalesce(
      public.reward_onboarding.notifications_enabled_at,
      excluded.notifications_enabled_at
    ),
    first_push_subscription_id = coalesce(
      public.reward_onboarding.first_push_subscription_id,
      excluded.first_push_subscription_id
    ),
    notifications_evidence = case
      when public.reward_onboarding.notifications_enabled_at is null
        then excluded.notifications_evidence
      else public.reward_onboarding.notifications_evidence
    end,
    updated_at = clock_timestamp();

  perform private.reward_onboarding_try_unlock(v_student_id);

  return new;
end;
$$;

revoke all on function private.reward_onboarding_capture_push_subscription()
from public, anon, authenticated, service_role;

drop trigger if exists reward_onboarding_push_subscription on public.push_subscriptions;
create trigger reward_onboarding_push_subscription
after insert or update of revoked_at on public.push_subscriptions
for each row
when (new.revoked_at is null)
execute function private.reward_onboarding_capture_push_subscription();

do $$
declare
  v_student record;
  v_subscription record;
begin
  for v_student in
    select s.id, s.studio_id, s.user_id
    from public.students s
    where s.user_id is not null
  loop
    select ps.id, ps.device_label
      into v_subscription
    from public.push_subscriptions ps
    where ps.studio_id = v_student.studio_id
      and ps.user_id = v_student.user_id
      and ps.revoked_at is null
    order by ps.created_at asc, ps.id asc
    limit 1;

    if v_subscription.id is not null then
      update public.reward_onboarding
      set notifications_enabled_at = coalesce(notifications_enabled_at, now()),
          first_push_subscription_id = coalesce(first_push_subscription_id, v_subscription.id),
          notifications_evidence = case
            when notifications_enabled_at is null then
              jsonb_build_object(
                'device_label', v_subscription.device_label,
                'captured_from', 'push_subscription_backfill'
              )
            else notifications_evidence
          end,
          updated_at = now()
      where studio_id = v_student.studio_id
        and student_id = v_student.id;

      perform private.reward_onboarding_try_unlock(v_student.id);
    end if;
  end loop;
end
$$;
