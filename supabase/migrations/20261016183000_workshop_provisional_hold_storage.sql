-- DRAFT ONLY: NOT applied to Sandbox or Production.
-- Phase 1 storage for unverified transfer evidence. This migration intentionally
-- exposes no checkout RPC: holds do NOT consume capacity until a transactionally
-- integrated capacity checker is deployed and tested.
create table public.workshop_provisional_holds (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  offer_id uuid not null references public.workshop_offers(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  request_id uuid not null,
  transfer_reference text not null check (length(btrim(transfer_reference)) between 1 and 200),
  selection_mode text not null check (selection_mode in ('full','sessions')),
  amount_minor integer not null check (amount_minor > 0),
  total_minor integer not null check (total_minor >= amount_minor),
  currency text not null default 'MXN' check (currency = 'MXN'),
  state text not null default 'proof_received'
    check (state in ('proof_received','reserved_provisionally','confirmed','rejected','expired')),
  expires_at timestamptz not null,
  verified_by uuid references auth.users(id) on delete restrict,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(studio_id,request_id),
  unique(studio_id,transfer_reference),
  check (
    (state='confirmed' and verified_by is not null and verified_at is not null)
    or (state<>'confirmed' and verified_by is null and verified_at is null)
  )
);
create table public.workshop_provisional_hold_sessions (
  hold_id uuid not null references public.workshop_provisional_holds(id) on delete restrict,
  session_id uuid not null references public.class_sessions(id) on delete restrict,
  primary key(hold_id,session_id)
);
create index workshop_provisional_hold_sessions_session_idx
  on public.workshop_provisional_hold_sessions(session_id);
create index workshop_provisional_holds_active_idx
  on public.workshop_provisional_holds(studio_id,expires_at)
  where state='reserved_provisionally';

alter table public.workshop_provisional_holds enable row level security;
alter table public.workshop_provisional_hold_sessions enable row level security;
revoke all on public.workshop_provisional_holds from public,anon,authenticated,service_role;
revoke all on public.workshop_provisional_hold_sessions from public,anon,authenticated,service_role;
-- No direct client writes, no service-role grants, no implicit revenue.
-- Follow-up migration must implement privileged atomic transitions with:
-- auth/tenant checks, session FOR UPDATE locks, ordinary reservations + active
-- provisional holds in capacity count, immutable reference/idempotency,
-- checked approval + single ledger posting, expiration and withdrawal.
