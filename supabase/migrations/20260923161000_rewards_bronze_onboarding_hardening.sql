-- REWARDS Bronze onboarding hardening.

drop function if exists public.admin_reward_onboarding_snapshot(uuid);
drop function if exists private.reward_onboarding_mark_documents_complete(uuid,timestamptz,jsonb);

create index if not exists reward_onboarding_student_id_idx
  on public.reward_onboarding(student_id);

create index if not exists reward_onboarding_first_reservation_idx
  on public.reward_onboarding(first_reservation_id)
  where first_reservation_id is not null;

create index if not exists reward_onboarding_first_attendance_reservation_idx
  on public.reward_onboarding(first_attendance_reservation_id)
  where first_attendance_reservation_id is not null;

create index if not exists reward_onboarding_unlocked_by_idx
  on public.reward_onboarding(unlocked_by)
  where unlocked_by is not null;
