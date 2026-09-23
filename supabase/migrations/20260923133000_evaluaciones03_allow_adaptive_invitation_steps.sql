-- EVALUACIONES-03
-- Adaptive diagnostics intentionally keep multiple technical evaluations under
-- one invitation (one published row per passed level plus one current draft).
-- The previous unique index allowed only one evaluation per invitation, which
-- blocked the transition from Principiante to Intermedio.
--
-- Keep the safety invariant that an invitation may have at most one active
-- draft at a time while preserving all published diagnostic steps.

drop index if exists public.technical_evaluations_invitation_unique;

create unique index technical_evaluations_invitation_draft_unique
  on public.technical_evaluations (evaluation_invitation_id)
  where evaluation_invitation_id is not null
    and status = 'draft';
