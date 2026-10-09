-- Settings can be opened by configurators even when they lack other student read scopes.
drop policy if exists crm_lifecycle_settings_read on public.crm_lifecycle_settings;
create policy crm_lifecycle_settings_read on public.crm_lifecycle_settings
  for select to authenticated using (
    private.has_capability(studio_id,'students.read')
    or private.has_capability(studio_id,'settings.write')
  );
