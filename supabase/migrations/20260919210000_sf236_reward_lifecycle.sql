create type public.reward_delivery_mode as enum (
  'redeem',
  'auto_apply',
  'achievement'
);

alter table public.reward_instances
  add column reward_key text,
  add column delivery_mode public.reward_delivery_mode not null default 'redeem',
  add column source_evaluation_id uuid;

alter table public.reward_instances
  add constraint reward_instances_reward_key_chk
  check (reward_key is null or length(trim(reward_key)) > 0);

alter table public.reward_instances
  add constraint reward_instances_source_evaluation_fkey
  foreign key (studio_id, source_evaluation_id)
  references public.reward_progress_evaluations(studio_id, id)
  on delete restrict;

create unique index reward_instances_cycle_reward_key_unique
  on public.reward_instances(cycle_id, reward_key)
  where cycle_id is not null and reward_key is not null;

create index reward_instances_source_evaluation_idx
  on public.reward_instances(source_evaluation_id)
  where source_evaluation_id is not null;

comment on column public.reward_instances.reward_key is
  'Stable reward or milestone key inside one rule version. Allows multiple tier rewards in one cycle without duplicates.';

create or replace function private.reward_definition_for_key(
  p_reward_definition jsonb,
  p_reward_key text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if p_reward_definition is null or jsonb_typeof(p_reward_definition) <> 'object' then
    raise exception 'reward_definition_must_be_object';
  end if;

  if trim(coalesce(p_reward_key, '')) = '' then
    raise exception 'reward_key_required';
  end if;

  if p_reward_definition ? 'rewards' then
    if jsonb_typeof(p_reward_definition->'rewards') <> 'array' then
      raise exception 'reward_definition_rewards_must_be_array';
    end if;

    select value
      into v_item
    from jsonb_array_elements(p_reward_definition->'rewards')
    where jsonb_typeof(value) = 'object'
      and value->>'key' = trim(p_reward_key)
    limit 1;

    if v_item is null then
      raise exception 'reward_definition_key_not_found';
    end if;

    return v_item;
  end if;

  if p_reward_definition ? 'key'
     and p_reward_definition->>'key' <> trim(p_reward_key) then
    raise exception 'reward_definition_key_not_found';
  end if;

  return p_reward_definition;
end;
$$;

revoke all on function private.reward_definition_for_key(jsonb,text)
from public, anon, authenticated, service_role;

create or replace function private.reward_kind_from_definition(
  p_definition jsonb
)
returns public.reward_kind
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_kind text := trim(coalesce(p_definition->>'kind', ''));
begin
  case v_kind
    when 'percentage_discount' then return 'percentage_discount';
    when 'fixed_discount' then return 'fixed_discount';
    when 'credits' then return 'credits';
    when 'validity_extension' then return 'validity_extension';
    when 'surcharge_waiver' then return 'surcharge_waiver';
    when 'special_benefit' then return 'special_benefit';
    when 'badge' then return 'badge';
    when 'custom_manual' then return 'custom_manual';
    else raise exception 'reward_definition_kind_invalid';
  end case;
end;
$$;

revoke all on function private.reward_kind_from_definition(jsonb)
from public, anon, authenticated, service_role;

create or replace function private.reward_delivery_from_definition(
  p_definition jsonb
)
returns public.reward_delivery_mode
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_delivery text := coalesce(nullif(trim(p_definition->>'delivery'), ''), 'redeem');
begin
  case v_delivery
    when 'redeem' then return 'redeem';
    when 'auto_apply' then return 'auto_apply';
    when 'achievement' then return 'achievement';
    else raise exception 'reward_definition_delivery_invalid';
  end case;
end;
$$;

revoke all on function private.reward_delivery_from_definition(jsonb)
from public, anon, authenticated, service_role;

create or replace function private.reward_nonnegative_integer(
  p_value jsonb,
  p_key text
)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_text text;
  v_value integer;
begin
  if p_value is null or not (p_value ? p_key) then
    return null;
  end if;

  v_text := p_value->>p_key;

  begin
    v_value := v_text::integer;
  exception
    when invalid_text_representation then
      raise exception 'reward_definition_integer_invalid:%', p_key;
  end;

  if v_value < 0 then
    raise exception 'reward_definition_integer_invalid:%', p_key;
  end if;

  return v_value;
end;
$$;

revoke all on function private.reward_nonnegative_integer(jsonb,text)
from public, anon, authenticated, service_role;

create or replace function public.system_generate_reward_instance(
  p_source_evaluation_id uuid,
  p_reward_key text,
  p_idempotency_key text,
  p_origin_snapshot jsonb default '{}'::jsonb,
  p_available_from timestamptz default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.reward_progress_evaluations%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_definition jsonb;
  v_kind public.reward_kind;
  v_delivery public.reward_delivery_mode;
  v_instance public.reward_instances%rowtype;
  v_now timestamptz := clock_timestamp();
  v_available_from timestamptz;
  v_expires_at timestamptz;
  v_delay_days integer;
  v_validity_days integer;
  v_max_total integer;
  v_cooldown_days integer;
  v_last_granted_at timestamptz;
  v_condition jsonb;
  v_milestone_passed boolean := false;
begin
  if p_source_evaluation_id is null then
    raise exception 'reward_source_evaluation_required';
  end if;

  if trim(coalesce(p_reward_key, '')) = '' then
    raise exception 'reward_key_required';
  end if;

  if trim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'reward_idempotency_key_required';
  end if;

  if p_origin_snapshot is null or jsonb_typeof(p_origin_snapshot) <> 'object' then
    raise exception 'reward_origin_snapshot_must_be_object';
  end if;

  select *
    into v_evaluation
  from public.reward_progress_evaluations
  where id = p_source_evaluation_id;

  if not found then
    raise exception 'reward_source_evaluation_not_found';
  end if;

  select *
    into v_instance
  from public.reward_instances
  where studio_id = v_evaluation.studio_id
    and idempotency_key = trim(p_idempotency_key);

  if found then
    return jsonb_build_object(
      'reward_instance_id', v_instance.id,
      'status', v_instance.status,
      'created', false
    );
  end if;

  select *
    into v_instance
  from public.reward_instances
  where cycle_id = v_evaluation.cycle_id
    and reward_key = trim(p_reward_key);

  if found then
    return jsonb_build_object(
      'reward_instance_id', v_instance.id,
      'status', v_instance.status,
      'created', false
    );
  end if;

  if not v_evaluation.fulfilled then
    for v_condition in
      select value
      from jsonb_array_elements(v_evaluation.condition_results)
    loop
      if v_condition->>'key' = trim(p_reward_key)
         and coalesce((v_condition->>'passed')::boolean, false) then
        v_milestone_passed := true;
        exit;
      end if;
    end loop;

    if not v_milestone_passed then
      raise exception 'reward_source_not_fulfilled';
    end if;
  end if;

  select *
    into v_version
  from public.reward_rule_versions
  where rule_id = v_evaluation.rule_id
    and version_number = v_evaluation.version_number;

  if not found then
    raise exception 'reward_rule_version_not_found';
  end if;

  v_definition := private.reward_definition_for_key(
    v_version.reward_definition,
    trim(p_reward_key)
  );
  v_kind := private.reward_kind_from_definition(v_definition);
  v_delivery := private.reward_delivery_from_definition(v_definition);
  v_delay_days := private.reward_nonnegative_integer(v_definition, 'available_delay_days');
  v_validity_days := private.reward_nonnegative_integer(v_definition, 'validity_days');

  v_available_from := coalesce(
    p_available_from,
    v_now + make_interval(days => coalesce(v_delay_days, 0))
  );

  v_expires_at := coalesce(
    p_expires_at,
    case
      when v_validity_days is null then null
      else v_available_from + make_interval(days => v_validity_days)
    end
  );

  if v_expires_at is not null and v_expires_at < v_available_from then
    raise exception 'reward_validity_window_invalid';
  end if;

  if jsonb_typeof(v_definition->'limits') = 'object' then
    v_max_total := private.reward_nonnegative_integer(
      v_definition->'limits',
      'max_per_student_total'
    );
    v_cooldown_days := private.reward_nonnegative_integer(
      v_definition->'limits',
      'cooldown_days'
    );
  end if;

  if v_max_total is not null
     and (
       select count(*)
       from public.reward_instances r
       where r.rule_id = v_evaluation.rule_id
         and r.student_id = v_evaluation.student_id
         and r.reward_key = trim(p_reward_key)
         and r.status <> 'revoked'
     ) >= v_max_total then
    raise exception 'reward_grant_limit_reached';
  end if;

  if v_cooldown_days is not null and v_cooldown_days > 0 then
    select max(r.created_at)
      into v_last_granted_at
    from public.reward_instances r
    where r.rule_id = v_evaluation.rule_id
      and r.student_id = v_evaluation.student_id
      and r.reward_key = trim(p_reward_key)
      and r.status <> 'revoked';

    if v_last_granted_at is not null
       and v_last_granted_at + make_interval(days => v_cooldown_days) > v_now then
      raise exception 'reward_grant_cooldown_active';
    end if;
  end if;

  insert into public.reward_instances (
    studio_id,
    student_id,
    rule_id,
    version_number,
    cycle_id,
    kind,
    status,
    idempotency_key,
    benefit_definition,
    origin_snapshot,
    available_from,
    expires_at,
    manually_granted,
    reward_key,
    delivery_mode,
    source_evaluation_id
  ) values (
    v_evaluation.studio_id,
    v_evaluation.student_id,
    v_evaluation.rule_id,
    v_evaluation.version_number,
    v_evaluation.cycle_id,
    v_kind,
    'blocked',
    trim(p_idempotency_key),
    v_definition,
    jsonb_build_object(
      'rule_id', v_evaluation.rule_id,
      'version_number', v_evaluation.version_number,
      'cycle_id', v_evaluation.cycle_id,
      'source_evaluation_id', v_evaluation.id
    ) || p_origin_snapshot,
    v_available_from,
    v_expires_at,
    false,
    trim(p_reward_key),
    v_delivery,
    v_evaluation.id
  )
  returning * into v_instance;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    details,
    occurred_at
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'created',
    null,
    'blocked',
    jsonb_build_object(
      'reward_key', v_instance.reward_key,
      'delivery_mode', v_instance.delivery_mode,
      'source_evaluation_id', v_evaluation.id
    ),
    v_now
  );

  if v_delivery = 'redeem'
     and v_available_from <= v_now
     and (v_expires_at is null or v_expires_at >= v_now) then
    update public.reward_instances
    set status = 'available',
        updated_at = v_now
    where id = v_instance.id
    returning * into v_instance;

    insert into public.reward_instance_events (
      studio_id,
      reward_instance_id,
      event_type,
      from_status,
      to_status,
      details,
      occurred_at
    ) values (
      v_instance.studio_id,
      v_instance.id,
      'unlocked',
      'blocked',
      'available',
      jsonb_build_object('reason', 'generated_available'),
      v_now
    );
  end if;

  return jsonb_build_object(
    'reward_instance_id', v_instance.id,
    'status', v_instance.status,
    'created', true
  );
end;
$$;

revoke all on function public.system_generate_reward_instance(
  uuid,text,text,jsonb,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.system_generate_reward_instance(
  uuid,text,text,jsonb,timestamptz,timestamptz
) to service_role;

create or replace function public.system_make_reward_available(
  p_reward_instance_id uuid
)
returns public.reward_instance_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then
    raise exception 'reward_instance_not_found';
  end if;

  if v_reward.status = 'available' then
    return v_reward.status;
  end if;

  if v_reward.status <> 'blocked' or v_reward.delivery_mode <> 'redeem' then
    raise exception 'reward_make_available_transition_invalid';
  end if;

  if v_reward.available_from is null or v_reward.available_from > v_now then
    raise exception 'reward_not_available_yet';
  end if;

  if v_reward.expires_at is not null and v_reward.expires_at < v_now then
    update public.reward_instances
    set status = 'expired',
        updated_at = v_now
    where id = v_reward.id;

    insert into public.reward_instance_events (
      studio_id,
      reward_instance_id,
      event_type,
      from_status,
      to_status,
      details,
      occurred_at
    ) values (
      v_reward.studio_id,
      v_reward.id,
      'expired',
      'blocked',
      'expired',
      jsonb_build_object('reason', 'expired_before_unlock'),
      v_now
    );

    return 'expired';
  end if;

  update public.reward_instances
  set status = 'available',
      updated_at = v_now
  where id = v_reward.id;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    details,
    occurred_at
  ) values (
    v_reward.studio_id,
    v_reward.id,
    'unlocked',
    'blocked',
    'available',
    jsonb_build_object('reason', 'availability_window_opened'),
    v_now
  );

  return 'available';
end;
$$;

revoke all on function public.system_make_reward_available(uuid)
from public, anon, authenticated;
grant execute on function public.system_make_reward_available(uuid)
to service_role;

create or replace function public.system_reserve_reward(
  p_reward_instance_id uuid,
  p_reservation_key text,
  p_reserved_until timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns public.reward_instance_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_now timestamptz := clock_timestamp();
  v_context jsonb;
begin
  if trim(coalesce(p_reservation_key, '')) = '' then
    raise exception 'reward_reservation_key_required';
  end if;

  if p_reserved_until is null or p_reserved_until <= v_now then
    raise exception 'reward_reservation_until_invalid';
  end if;

  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    raise exception 'reward_reservation_context_must_be_object';
  end if;

  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then
    raise exception 'reward_instance_not_found';
  end if;

  if v_reward.status = 'reserved'
     and v_reward.reservation_context->>'reservation_key' = trim(p_reservation_key) then
    return 'reserved';
  end if;

  if v_reward.status <> 'available' then
    raise exception 'reward_reserve_transition_invalid';
  end if;

  if v_reward.available_from is null or v_reward.available_from > v_now then
    raise exception 'reward_not_available_yet';
  end if;

  if v_reward.expires_at is not null and v_reward.expires_at < v_now then
    raise exception 'reward_expired';
  end if;

  v_context := jsonb_build_object('reservation_key', trim(p_reservation_key)) || p_context;

  update public.reward_instances
  set status = 'reserved',
      reserved_at = v_now,
      reserved_until = p_reserved_until,
      reservation_context = v_context,
      updated_at = v_now
  where id = v_reward.id;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    details,
    occurred_at
  ) values (
    v_reward.studio_id,
    v_reward.id,
    'reserved',
    'available',
    'reserved',
    v_context || jsonb_build_object('reserved_until', p_reserved_until),
    v_now
  );

  return 'reserved';
end;
$$;

revoke all on function public.system_reserve_reward(uuid,text,timestamptz,jsonb)
from public, anon, authenticated;
grant execute on function public.system_reserve_reward(uuid,text,timestamptz,jsonb)
to service_role;

create or replace function public.system_release_reward_reservation(
  p_reward_instance_id uuid,
  p_reason text
)
returns public.reward_instance_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_now timestamptz := clock_timestamp();
  v_next public.reward_instance_status;
  v_context jsonb;
begin
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'reward_release_reason_required';
  end if;

  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then
    raise exception 'reward_instance_not_found';
  end if;

  if v_reward.status <> 'reserved' then
    raise exception 'reward_release_transition_invalid';
  end if;

  v_next := case
    when v_reward.expires_at is not null and v_reward.expires_at < v_now then 'expired'
    else 'available'
  end;

  v_context := v_reward.reservation_context;

  update public.reward_instances
  set status = v_next,
      reserved_at = null,
      reserved_until = null,
      reservation_context = '{}'::jsonb,
      updated_at = v_now
  where id = v_reward.id;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    details,
    occurred_at
  ) values (
    v_reward.studio_id,
    v_reward.id,
    case when v_next = 'expired' then 'expired' else 'released' end,
    'reserved',
    v_next,
    jsonb_build_object(
      'reason', trim(p_reason),
      'reservation_context', v_context
    ),
    v_now
  );

  return v_next;
end;
$$;

revoke all on function public.system_release_reward_reservation(uuid,text)
from public, anon, authenticated;
grant execute on function public.system_release_reward_reservation(uuid,text)
to service_role;

create or replace function public.system_redeem_reward(
  p_reward_instance_id uuid,
  p_redemption_context jsonb,
  p_allow_unreserved boolean default false
)
returns public.reward_instance_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_redemption_context is null or jsonb_typeof(p_redemption_context) <> 'object' then
    raise exception 'reward_redemption_context_must_be_object';
  end if;

  if coalesce((p_redemption_context->>'partial')::boolean, false) then
    raise exception 'reward_partial_redemption_not_supported';
  end if;

  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then
    raise exception 'reward_instance_not_found';
  end if;

  if v_reward.status = 'redeemed' then
    return 'redeemed';
  end if;

  if v_reward.delivery_mode <> 'redeem' then
    raise exception 'reward_redemption_delivery_invalid';
  end if;

  if v_reward.status = 'reserved' then
    if v_reward.reserved_until is not null and v_reward.reserved_until < v_now then
      raise exception 'reward_reservation_expired';
    end if;
  elsif v_reward.status = 'available' and p_allow_unreserved then
    if v_reward.expires_at is not null and v_reward.expires_at < v_now then
      raise exception 'reward_expired';
    end if;
  else
    raise exception 'reward_redeem_transition_invalid';
  end if;

  update public.reward_instances
  set status = 'redeemed',
      redeemed_at = v_now,
      redemption_context = p_redemption_context,
      updated_at = v_now
  where id = v_reward.id;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    details,
    occurred_at
  ) values (
    v_reward.studio_id,
    v_reward.id,
    'redeemed',
    v_reward.status,
    'redeemed',
    p_redemption_context || jsonb_build_object(
      'reservation_context', v_reward.reservation_context
    ),
    v_now
  );

  return 'redeemed';
end;
$$;

revoke all on function public.system_redeem_reward(uuid,jsonb,boolean)
from public, anon, authenticated;
grant execute on function public.system_redeem_reward(uuid,jsonb,boolean)
to service_role;

create or replace function public.system_mark_reward_auto_applied(
  p_reward_instance_id uuid,
  p_application_context jsonb
)
returns public.reward_instance_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_application_context is null or jsonb_typeof(p_application_context) <> 'object' then
    raise exception 'reward_application_context_must_be_object';
  end if;

  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then
    raise exception 'reward_instance_not_found';
  end if;

  if v_reward.status = 'redeemed' then
    return 'redeemed';
  end if;

  if v_reward.delivery_mode not in ('auto_apply', 'achievement') then
    raise exception 'reward_auto_apply_delivery_invalid';
  end if;

  if v_reward.status not in ('blocked', 'available') then
    raise exception 'reward_auto_apply_transition_invalid';
  end if;

  if v_reward.expires_at is not null and v_reward.expires_at < v_now then
    raise exception 'reward_expired';
  end if;

  update public.reward_instances
  set status = 'redeemed',
      redeemed_at = v_now,
      redemption_context = p_application_context,
      updated_at = v_now
  where id = v_reward.id;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    details,
    occurred_at
  ) values (
    v_reward.studio_id,
    v_reward.id,
    'auto_applied',
    v_reward.status,
    'redeemed',
    p_application_context,
    v_now
  );

  return 'redeemed';
end;
$$;

revoke all on function public.system_mark_reward_auto_applied(uuid,jsonb)
from public, anon, authenticated;
grant execute on function public.system_mark_reward_auto_applied(uuid,jsonb)
to service_role;

create or replace function public.system_expire_reward(
  p_reward_instance_id uuid
)
returns public.reward_instance_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then
    raise exception 'reward_instance_not_found';
  end if;

  if v_reward.status in ('redeemed', 'expired', 'revoked') then
    return v_reward.status;
  end if;

  if v_reward.expires_at is null or v_reward.expires_at >= v_now then
    return v_reward.status;
  end if;

  if v_reward.status = 'reserved'
     and v_reward.reserved_until is not null
     and v_reward.reserved_until >= v_now then
    return 'reserved';
  end if;

  update public.reward_instances
  set status = 'expired',
      reserved_at = null,
      reserved_until = null,
      reservation_context = '{}'::jsonb,
      updated_at = v_now
  where id = v_reward.id;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    details,
    occurred_at
  ) values (
    v_reward.studio_id,
    v_reward.id,
    'expired',
    v_reward.status,
    'expired',
    jsonb_build_object('reason', 'validity_elapsed'),
    v_now
  );

  return 'expired';
end;
$$;

revoke all on function public.system_expire_reward(uuid)
from public, anon, authenticated;
grant execute on function public.system_expire_reward(uuid)
to service_role;
