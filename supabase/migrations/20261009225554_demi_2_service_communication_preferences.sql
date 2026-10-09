-- The runtime must persist opt-out, not merely read existing preferences.
grant select,insert,update on public.person_communication_preferences to service_role;
