create policy service_role_audit on public.studio_plan_assignment_events for all to service_role using(true) with check(true);
