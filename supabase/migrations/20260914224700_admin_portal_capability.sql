insert into public.capabilities (key, description)
values ('admin.portal', 'Acceder al shell administrativo')
on conflict (key) do update set description = excluded.description;

insert into public.role_capabilities (role, capability_key) values
  ('owner', 'admin.portal'),
  ('admin', 'admin.portal'),
  ('reception', 'admin.portal')
on conflict do nothing;
