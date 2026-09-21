
-- EVALUACIONES-01 · Criterion result rows use the same immutable result guard
-- as element/combo rows, so they need an updated_at timestamp.

alter table public.technical_evaluation_criterion_results
  add column if not exists updated_at timestamptz not null default now();
