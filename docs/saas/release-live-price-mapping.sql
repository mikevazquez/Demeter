-- Operational configuration, not a schema migration.
-- Run only after backup/restoration/rehearsal, functional acceptance and release authorization.
-- Verify connection is production qfhojvgvhrbautvczffq and reread Prices in acct_1TwcF07pc7DxswTf first.
-- Never commit this configuration in Sandbox. All Access assignments must remain unchanged.
begin;
set local statement_timeout = '30s';

create temporary table _studio_flow_live_prices (
  plan_key text primary key,
  amount_minor integer not null,
  product_id text not null,
  price_id text not null
) on commit drop;
insert into _studio_flow_live_prices values
  ('core',89900,'prod_VQSwPc6Hvd0njB','price_1UPc0p7pc7DxswTfuC75I0d9'),
  ('growth',139900,'prod_VQSwdFuVmvXnAL','price_1UPc0x7pc7DxswTfakgBvEFP'),
  ('pro',199900,'prod_VQSwgphcakcjRN','price_1UPc0y7pc7DxswTfEoWHSabh');

create temporary table _studio_flow_assignment_baseline on commit drop as
select md5(coalesce(jsonb_agg(to_jsonb(a) order by studio_id)::text,'[]')) fingerprint
from public.studio_plan_assignments a;

do $$
begin
  if (select count(*) from public.saas_plans p join _studio_flow_live_prices e using(plan_key)
      where p.active and not p.internal_only) <> 3 then
    raise exception 'Three active commercial plans are required';
  end if;
  if not exists (
    select 1 from public.studios s
    join public.studio_plan_assignments a on a.studio_id=s.id
    join public.saas_plans p on p.id=a.plan_id
    where s.slug='demeter-fitness' and p.plan_key='all_access' and p.internal_only
      and a.status='active' and a.billing_provider is null
  ) then
    raise exception 'Demeter All Access baseline is not preserved';
  end if;
  if exists (
    select 1 from public.saas_plan_prices x
    join public.saas_plans p on p.id=x.plan_id
    join _studio_flow_live_prices e on e.plan_key=p.plan_key
    where x.provider='stripe' and x.billing_interval='month' and x.currency='mxn'
      and x.active and x.provider_price_id<>e.price_id
  ) then
    raise exception 'An active price occupies a target slot; review it explicitly';
  end if;
  if exists (
    select 1 from public.saas_plan_prices x
    join _studio_flow_live_prices e on e.price_id=x.provider_price_id
    join public.saas_plans p on p.id=x.plan_id
    where x.provider='stripe' and
      (p.plan_key,x.amount_minor,x.provider_product_id,x.billing_interval,x.currency,x.trial_days,x.grace_days)
      is distinct from (e.plan_key,e.amount_minor,e.product_id,'month'::text,'mxn'::text,0,3)
  ) then
    raise exception 'An existing Live price mapping has inconsistent configuration';
  end if;
end $$;

insert into public.saas_plan_prices (
  plan_id,provider,billing_interval,currency,amount_minor,
  provider_product_id,provider_price_id,trial_days,grace_days,active
)
select p.id,'stripe','month','mxn',e.amount_minor,e.product_id,e.price_id,0,3,true
from _studio_flow_live_prices e join public.saas_plans p using(plan_key)
on conflict (provider,provider_price_id) do update set active=true,updated_at=now();

do $$
begin
  if (select count(*) from public.saas_plan_prices x
      join public.saas_plans p on p.id=x.plan_id
      join _studio_flow_live_prices e on e.plan_key=p.plan_key
      where x.active and x.provider='stripe' and x.billing_interval='month' and x.currency='mxn'
        and x.amount_minor=e.amount_minor and x.provider_product_id=e.product_id
        and x.provider_price_id=e.price_id and x.trial_days=0 and x.grace_days=3) <> 3 then
    raise exception 'Live mapping verification failed';
  end if;
  if (select md5(coalesce(jsonb_agg(to_jsonb(a) order by studio_id)::text,'[]'))
      from public.studio_plan_assignments a)
     is distinct from (select fingerprint from _studio_flow_assignment_baseline) then
    raise exception 'Studio assignments changed unexpectedly';
  end if;
end $$;

select p.plan_key,x.provider_price_id,x.amount_minor,x.currency,x.billing_interval,x.active
from public.saas_plan_prices x join public.saas_plans p on p.id=x.plan_id
join _studio_flow_live_prices e on e.price_id=x.provider_price_id
where x.provider='stripe' order by p.plan_key;
commit;
