alter table public.product_templates
  add column if not exists assistant_visible boolean not null default true;

comment on column public.product_templates.assistant_visible is
  'Controls whether this product can be surfaced by the Demi conversational assistant.';

create index if not exists product_templates_studio_assistant_visible_idx
  on public.product_templates(studio_id, assistant_visible)
  where active = true;
