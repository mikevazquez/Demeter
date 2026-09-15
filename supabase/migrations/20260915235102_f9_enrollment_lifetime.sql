alter table public.product_templates
  alter column validity_days drop not null;

alter table public.product_templates
  drop constraint if exists product_templates_validity_days_check;

alter table public.product_templates
  add constraint product_templates_validity_days_check
  check (
    (product_type = 'enrollment' and (validity_days is null or validity_days > 0))
    or
    (product_type <> 'enrollment' and validity_days is not null and validity_days > 0)
  );
