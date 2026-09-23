-- Remove an earlier Sandbox-only prototype if it exists.
-- Safe in environments where those prototype objects were never created.

drop trigger if exists reward_onboarding_student_sync on public.students;
drop trigger if exists reward_onboarding_profile_sync on public.profiles;
drop trigger if exists reward_onboarding_profile_value_sync on public.profile_field_values;
drop trigger if exists reward_onboarding_reservation_sync on public.reservations;

drop function if exists private.reward_onboarding_from_student();
drop function if exists private.reward_onboarding_from_profile();
drop function if exists private.reward_onboarding_from_profile_value();
drop function if exists private.reward_onboarding_from_reservation();
drop function if exists private.reward_onboarding_sync_student(uuid);
drop function if exists private.reward_onboarding_profile_evidence(uuid);
drop function if exists private.reward_onboarding_mark_documents(uuid,jsonb);
drop function if exists public.student_reward_onboarding_snapshot();
drop function if exists public.admin_grant_reward_bronze(uuid,text);

drop table if exists private.reward_medal_onboarding;
