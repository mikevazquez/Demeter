-- DEV-04G: keep plan usage visible to authorized recovery/admin surfaces in restricted states.

create or replace function public.current_studio_plan_usage(
  p_studio_id uuid
)
returns table(
  plan_key text,
  plan_name text,
  limit_key text,
  limit_name text,
  unit text,
  limit_value bigint,
  usage bigint,
  unlimited boolean,
  over_limit boolean,
  remaining bigint,
  note text
)
language plpgsql
stable
security invoker
set search_path=''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not (
    exists(
      select 1
      from public.studio_memberships m
      join public.role_capabilities rc on rc.role=m.role
      where m.studio_id=p_studio_id
        and m.user_id=(select auth.uid())
        and m.active=true
        and rc.capability_key='admin.portal'
    )
    or exists(
      select 1
      from public.platform_admins pa
      where pa.user_id=(select auth.uid())
        and pa.active=true
    )
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    p.plan_key,
    p.name,
    d.limit_key,
    d.name,
    d.unit,
    l.limit_value,
    private.studio_plan_limit_usage(p_studio_id,d.limit_key) as usage,
    l.limit_value is null as unlimited,
    (
      l.limit_value is not null
      and private.studio_plan_limit_usage(p_studio_id,d.limit_key) > l.limit_value
    ) as over_limit,
    case
      when l.limit_value is null then null
      else greatest(
        l.limit_value-private.studio_plan_limit_usage(p_studio_id,d.limit_key),
        0
      )
    end as remaining,
    l.note
  from public.studio_plan_assignments spa
  join public.saas_plans p on p.id=spa.plan_id
  join public.saas_plan_limits l on l.plan_id=p.id
  join public.saas_limit_definitions d on d.limit_key=l.limit_key
  where spa.studio_id=p_studio_id
  order by d.sort_order,d.limit_key;
end;
$function$;

revoke all on function public.current_studio_plan_usage(uuid)
  from public,anon;
grant execute on function public.current_studio_plan_usage(uuid)
  to authenticated,service_role;
