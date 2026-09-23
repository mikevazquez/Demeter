-- REWARDS Bronze onboarding · least-privilege Data API grants.
-- Students/admins may read rows permitted by RLS. Mutations are only performed
-- by trusted triggers/RPCs; there is no direct client INSERT/UPDATE/DELETE surface.

revoke all on table public.reward_onboarding from anon, authenticated;
grant select on table public.reward_onboarding to authenticated;
