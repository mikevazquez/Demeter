-- ASISTIAN-INBOUND-05
-- Cover the class_template_id foreign key used by service mappings.

create index if not exists asistian_service_mappings_class_template_idx
  on public.asistian_service_mappings(class_template_id);
