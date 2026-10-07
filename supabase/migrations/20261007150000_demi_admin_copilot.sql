create table if not exists public.assistant_admin_change_requests (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  instruction text not null check (length(instruction) between 1 and 4000),
  summary text not null default '',
  plan jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','applied','rejected','failed')),
  error_code text,
  created_by uuid references auth.users(id),
  applied_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists assistant_admin_change_requests_studio_created_idx
  on public.assistant_admin_change_requests(studio_id, created_at desc);

create table if not exists public.assistant_admin_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  rule_key text not null check (length(rule_key) between 3 and 120),
  category text not null default 'behavior' check (category in ('behavior','commercial','booking','payment','communication','safety')),
  instruction text not null check (length(instruction) between 1 and 2000),
  enabled boolean not null default true,
  source_request_id uuid references public.assistant_admin_change_requests(id) on delete set null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(studio_id, rule_key)
);
create index if not exists assistant_admin_rules_runtime_idx
  on public.assistant_admin_rules(studio_id, enabled, category, updated_at desc);

alter table public.assistant_admin_change_requests enable row level security;
alter table public.assistant_admin_rules enable row level security;

revoke all on public.assistant_admin_change_requests from public, anon;
revoke all on public.assistant_admin_rules from public, anon;
grant select,insert,update on public.assistant_admin_change_requests to authenticated, service_role;
grant select,insert,update,delete on public.assistant_admin_rules to authenticated, service_role;

drop policy if exists assistant_admin_change_requests_admin on public.assistant_admin_change_requests;
create policy assistant_admin_change_requests_admin on public.assistant_admin_change_requests
  for all to authenticated
  using (private.has_capability(studio_id,'settings.write'))
  with check (private.has_capability(studio_id,'settings.write'));

drop policy if exists assistant_admin_rules_admin on public.assistant_admin_rules;
create policy assistant_admin_rules_admin on public.assistant_admin_rules
  for all to authenticated
  using (private.has_capability(studio_id,'settings.write'))
  with check (private.has_capability(studio_id,'settings.write'));

grant select on public.assistant_admin_rules to service_role;


create or replace function public.admin_apply_demi_change_plan(
  p_studio_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $function$
declare
  v_request public.assistant_admin_change_requests%rowtype;
  v_action jsonb;
  v_type text;
  v_field text;
  v_count integer;
begin
  if auth.uid() is null or not private.has_capability(p_studio_id,'settings.write') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  select * into v_request
  from public.assistant_admin_change_requests
  where id=p_request_id and studio_id=p_studio_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','request_not_found'); end if;
  if v_request.status<>'proposed' then return jsonb_build_object('ok',false,'error','request_not_proposed'); end if;

  for v_action in select value from jsonb_array_elements(coalesce(v_request.plan->'actions','[]'::jsonb))
  loop
    v_type := coalesce(v_action->>'type','');

    if v_type='set_trial_policy' then
      v_field := coalesce(v_action->>'field','');
      if v_field='require_payment_before_booking' then
        update public.trial_booking_policies set require_payment_before_booking=(v_action->>'value')::boolean,updated_at=clock_timestamp() where studio_id=p_studio_id;
      elsif v_field='require_payment_before_attendance' then
        update public.trial_booking_policies set require_payment_before_attendance=(v_action->>'value')::boolean,updated_at=clock_timestamp() where studio_id=p_studio_id;
      elsif v_field='allow_without_enrollment_until_first_attendance' then
        update public.trial_booking_policies set allow_without_enrollment_until_first_attendance=(v_action->>'value')::boolean,updated_at=clock_timestamp() where studio_id=p_studio_id;
      elsif v_field='max_active_trial_reservations' then
        update public.trial_booking_policies set max_active_trial_reservations=(v_action->>'value')::integer,updated_at=clock_timestamp() where studio_id=p_studio_id;
      elsif v_field='prepayment_after_no_shows' then
        update public.trial_booking_policies set prepayment_after_no_shows=(v_action->>'value')::integer,updated_at=clock_timestamp() where studio_id=p_studio_id;
      else
        raise exception 'unsupported_trial_policy_field';
      end if;
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'trial_policy_not_found'; end if;

    elsif v_type='set_handoff_policy' then
      update public.assistant_handoff_policies
      set enabled=case when v_action ? 'enabled' then (v_action->>'enabled')::boolean else enabled end,
          blocking=case when v_action ? 'blocking' then (v_action->>'blocking')::boolean else blocking end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and reason_code=v_action->>'reason_code';
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'handoff_policy_not_found'; end if;

    elsif v_type='set_product' then
      update public.product_templates
      set price_minor=case when v_action ? 'price_minor' then (v_action->>'price_minor')::integer else price_minor end,
          active=case when v_action ? 'active' then (v_action->>'active')::boolean else active end,
          assistant_visible=case when v_action ? 'assistant_visible' then (v_action->>'assistant_visible')::boolean else assistant_visible end,
          online_purchasable=case when v_action ? 'online_purchasable' then (v_action->>'online_purchasable')::boolean else online_purchasable end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and name=v_action->>'product_name';
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'product_not_found_or_ambiguous'; end if;

    elsif v_type='set_class_price' then
      update public.class_templates
      set drop_in_price_minor=case when jsonb_typeof(v_action->'price_minor')='null' then null else (v_action->>'price_minor')::integer end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and name=v_action->>'activity_name' and active=true;
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'activity_not_found_or_ambiguous'; end if;

    elsif v_type='upsert_rule' then
      insert into public.assistant_admin_rules(
        studio_id,rule_key,category,instruction,enabled,source_request_id,created_by,updated_by
      ) values(
        p_studio_id,
        v_action->>'rule_key',
        v_action->>'category',
        v_action->>'instruction',
        coalesce((v_action->>'enabled')::boolean,true),
        p_request_id,
        auth.uid(),
        auth.uid()
      )
      on conflict(studio_id,rule_key) do update set
        category=excluded.category,
        instruction=excluded.instruction,
        enabled=excluded.enabled,
        source_request_id=excluded.source_request_id,
        updated_by=auth.uid(),
        updated_at=clock_timestamp();

    else
      raise exception 'unsupported_admin_action';
    end if;
  end loop;

  update public.assistant_admin_change_requests
  set status='applied',applied_by=auth.uid(),applied_at=clock_timestamp(),updated_at=clock_timestamp(),error_code=null
  where id=p_request_id and studio_id=p_studio_id;

  return jsonb_build_object('ok',true,'status','applied');
exception when others then
  return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$function$;

revoke all on function public.admin_apply_demi_change_plan(uuid,uuid) from public,anon;
grant execute on function public.admin_apply_demi_change_plan(uuid,uuid) to authenticated;
