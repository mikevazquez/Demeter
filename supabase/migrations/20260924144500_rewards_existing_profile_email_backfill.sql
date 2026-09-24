-- REWARDS · backfill de correo existente en perfiles de alumnas activas.
-- Un correo válido ya registrado en Students, Auth o Person Contacts cuenta
-- como evidencia del paso Perfil; no obliga a capturarlo nuevamente.

create or replace function private.reward_onboarding_refresh_profile(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_email_ok boolean := false;
  v_avatar_ok boolean := false;
  v_birth_date_ok boolean := false;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then return; end if;

  insert into public.reward_onboarding(studio_id, student_id)
  values (v_student.studio_id, v_student.id)
  on conflict (studio_id, student_id) do nothing;

  select
    nullif(trim(coalesce(v_student.email,'')), '') is not null
    or exists (
      select 1
      from auth.users u
      where u.id = v_student.user_id
        and nullif(trim(coalesce(u.email,'')), '') is not null
    )
    or exists (
      select 1
      from public.person_contacts pc
      where pc.person_id = v_student.person_id
        and pc.kind = 'email'
        and nullif(trim(coalesce(pc.value,'')), '') is not null
    )
    into v_email_ok;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_student.user_id
      and nullif(trim(coalesce(p.avatar_url,'')), '') is not null
  ) into v_avatar_ok;

  select exists (
    select 1
    from public.profile_field_definitions d
    join public.profile_field_values v
      on v.definition_id = d.id
     and v.person_id = v_student.person_id
    where d.studio_id = v_student.studio_id
      and d.entity_type = 'student'
      and d.key = 'birth_date'
      and d.active = true
      and v.value <> 'null'::jsonb
      and nullif(trim(v.value #>> '{}'), '') is not null
  ) into v_birth_date_ok;

  if v_email_ok and v_avatar_ok and v_birth_date_ok then
    update public.reward_onboarding
    set profile_completed_at = coalesce(profile_completed_at, now()),
        profile_evidence = jsonb_build_object(
          'email', true,
          'avatar', true,
          'birth_date', true
        ),
        updated_at = now()
    where studio_id = v_student.studio_id
      and student_id = v_student.id
      and profile_completed_at is null;
  else
    update public.reward_onboarding
    set profile_evidence = jsonb_build_object(
          'email', v_email_ok,
          'avatar', v_avatar_ok,
          'birth_date', v_birth_date_ok
        ),
        updated_at = now()
    where studio_id = v_student.studio_id
      and student_id = v_student.id
      and profile_completed_at is null;
  end if;

  perform private.reward_onboarding_try_unlock(v_student.id);
end;
$$;

revoke all on function private.reward_onboarding_refresh_profile(uuid)
from public, anon, authenticated, service_role;

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
  end loop;
end
$$;
