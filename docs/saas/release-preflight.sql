-- Read-only. Run explicitly against the intended project; results do not authorize a release.
select name, to_regclass('public.' || name) is not null as present
from (values ('platform_admins'),('saas_plans'),('studio_plan_assignments'),
  ('studio_plan_assignment_events'),('saas_plan_prices'),
  ('saas_billing_checkout_attempts'),('saas_billing_webhook_events')) v(name)
order by name;

select c.relname as table_name,c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('platform_admins','saas_plans','studio_plan_assignments','studio_plan_assignment_events',
   'saas_plan_prices','saas_billing_checkout_attempts','saas_billing_webhook_events');

select p.proname,pg_get_function_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,p.proconfig,array(select a::text from unnest(p.proacl) a) as acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in
  ('service_provision_studio_v3','service_apply_stripe_subscription_state',
   'current_studio_capabilities','current_studio_plan_usage',
   'materialize_recurring_schedule','admin_save_activity')
order by p.proname,p.pronargs;

-- Baseline preservation gate: Demeter must remain active on its internal All Access plan.
select s.slug,p.plan_key,p.internal_only,a.status,a.billing_provider
from public.studios s join public.studio_plan_assignments a on a.studio_id=s.id
join public.saas_plans p on p.id=a.plan_id
where s.slug='demeter-fitness';
