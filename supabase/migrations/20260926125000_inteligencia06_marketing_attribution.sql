-- INTEL-06 · Atribución de gasto publicitario a origen/campaña.

alter table public.studio_expenses
  add column if not exists marketing_source text,
  add column if not exists marketing_campaign text;

create index if not exists studio_expenses_marketing_attribution_idx
  on public.studio_expenses(studio_id, marketing_source, marketing_campaign, effective_on desc)
  where category = 'advertising';

comment on column public.studio_expenses.marketing_source is
  'Origen publicitario opcional. Debe corresponder al source recibido en crm_conversations cuando sea posible.';

comment on column public.studio_expenses.marketing_campaign is
  'Campaña publicitaria opcional. Debe corresponder al campaign recibido en crm_conversations cuando sea posible.';
