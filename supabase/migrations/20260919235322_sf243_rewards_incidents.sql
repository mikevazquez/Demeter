alter table public.reward_incidents
  add column if not exists idempotency_key text;

create unique index if not exists reward_incidents_idempotency_unique
  on public.reward_incidents(studio_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists reward_incidents_reward_open_idx
  on public.reward_incidents(studio_id, reward_instance_id, status, opened_at desc)
  where reward_instance_id is not null;

create or replace function private.reward_incident_priority_from_text(
  p_priority text
)
returns public.reward_incident_priority
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  case trim(coalesce(p_priority, ''))
    when 'normal' then return 'normal';
    when 'high' then return 'high';
    when 'critical' then return 'critical';
    else raise exception 'reward_incident_priority_invalid';
  end case;
end;
$$;

revoke all on function private.reward_incident_priority_from_text(text)
from public, anon, authenticated, service_role;

create or replace function private.open_reward_incident_internal(
  p_studio_id uuid,
  p_student_id uuid,
  p_rule_id uuid,
  p_reward_instance_id uuid,
  p_incident_type text,
  p_priority public.reward_incident_priority,
  p_summary text,
  p_details jsonb,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_existing public.reward_incidents%rowtype;
  v_incident_id uuid;
begin
  if p_studio_id is null then raise exception 'reward_incident_studio_required'; end if;
  if trim(coalesce(p_incident_type, '')) = '' then
    raise exception 'reward_incident_type_required';
  end if;
  if trim(coalesce(p_summary, '')) = '' then
    raise exception 'reward_incident_summary_required';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'reward_incident_details_must_be_object';
  end if;

  if p_reward_instance_id is not null then
    select *
      into v_reward
    from public.reward_instances
    where id = p_reward_instance_id;

    if not found then raise exception 'reward_instance_not_found'; end if;
    if v_reward.studio_id <> p_studio_id then
      raise exception 'reward_incident_reward_studio_mismatch';
    end if;
    if p_student_id is not null and v_reward.student_id <> p_student_id then
      raise exception 'reward_incident_reward_student_mismatch';
    end if;
    if p_rule_id is not null and v_reward.rule_id is distinct from p_rule_id then
      raise exception 'reward_incident_reward_rule_mismatch';
    end if;
  end if;

  if p_student_id is not null
     and not exists (
       select 1 from public.students s
       where s.id = p_student_id and s.studio_id = p_studio_id
     ) then
    raise exception 'reward_incident_student_studio_mismatch';
  end if;

  if p_rule_id is not null
     and not exists (
       select 1 from public.reward_rules r
       where r.id = p_rule_id and r.studio_id = p_studio_id
     ) then
    raise exception 'reward_incident_rule_studio_mismatch';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    select *
      into v_existing
    from public.reward_incidents
    where studio_id = p_studio_id
      and idempotency_key = trim(p_idempotency_key);

    if found then return v_existing.id; end if;
  end if;

  insert into public.reward_incidents (
    studio_id,
    student_id,
    rule_id,
    reward_instance_id,
    incident_type,
    priority,
    status,
    summary,
    details,
    idempotency_key,
    created_by_user_id,
    updated_by_user_id
  ) values (
    p_studio_id,
    p_student_id,
    p_rule_id,
    p_reward_instance_id,
    trim(p_incident_type),
    p_priority,
    'detected',
    trim(p_summary),
    p_details,
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_incident_id;

  insert into public.reward_incident_events (
    studio_id,
    incident_id,
    from_status,
    to_status,
    action,
    reason,
    actor_user_id,
    details
  ) values (
    p_studio_id,
    v_incident_id,
    null,
    'detected',
    'detected',
    null,
    p_actor_user_id,
    p_details
  );

  return v_incident_id;
end;
$$;

revoke all on function private.open_reward_incident_internal(
  uuid,uuid,uuid,uuid,text,public.reward_incident_priority,text,jsonb,text,uuid
) from public, anon, authenticated, service_role;

create or replace function private.revoke_reward_available_internal(
  p_reward_instance_id uuid,
  p_reason text,
  p_actor_user_id uuid
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
  if p_reward_instance_id is null then raise exception 'reward_instance_id_required'; end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'reward_revocation_reason_required'; end if;

  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then raise exception 'reward_instance_not_found'; end if;

  if v_reward.status = 'revoked' then return 'revoked'; end if;
  if v_reward.status = 'reserved' then
    raise exception 'reward_reserved_requires_incident_review';
  end if;
  if v_reward.status = 'redeemed' then
    raise exception 'reward_redeemed_never_reopened';
  end if;
  if v_reward.status not in ('blocked', 'available') then
    raise exception 'reward_revocation_transition_invalid:%', v_reward.status;
  end if;

  update public.reward_instances
  set status = 'revoked',
      revoked_at = v_now,
      revoked_reason = trim(p_reason),
      updated_at = v_now
  where id = v_reward.id;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    actor_user_id,
    details,
    occurred_at
  ) values (
    v_reward.studio_id,
    v_reward.id,
    'revoked',
    v_reward.status,
    'revoked',
    p_actor_user_id,
    jsonb_build_object('reason', trim(p_reason)),
    v_now
  );

  return 'revoked';
end;
$$;

revoke all on function private.revoke_reward_available_internal(uuid,text,uuid)
from public, anon, authenticated, service_role;

create or replace function public.system_open_reward_incident(
  p_studio_id uuid,
  p_student_id uuid,
  p_rule_id uuid,
  p_reward_instance_id uuid,
  p_incident_type text,
  p_priority text,
  p_summary text,
  p_details jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.open_reward_incident_internal(
    p_studio_id,
    p_student_id,
    p_rule_id,
    p_reward_instance_id,
    p_incident_type,
    private.reward_incident_priority_from_text(p_priority),
    p_summary,
    p_details,
    p_idempotency_key,
    null
  );
$$;

revoke all on function public.system_open_reward_incident(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,text
) from public, anon, authenticated;
grant execute on function public.system_open_reward_incident(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,text
) to service_role;

create or replace function public.system_revoke_reward(
  p_reward_instance_id uuid,
  p_reason text
)
returns public.reward_instance_status
language sql
security definer
set search_path = ''
as $$
  select private.revoke_reward_available_internal(
    p_reward_instance_id,
    p_reason,
    null
  );
$$;

revoke all on function public.system_revoke_reward(uuid,text)
from public, anon, authenticated;
grant execute on function public.system_revoke_reward(uuid,text)
to service_role;

create or replace function public.system_reconcile_reward_correction(
  p_new_evaluation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new public.reward_progress_evaluations%rowtype;
  v_previous public.reward_progress_evaluations%rowtype;
  v_reward public.reward_instances%rowtype;
  v_incident_id uuid;
  v_revoked integer := 0;
  v_review integer := 0;
  v_critical integer := 0;
  v_unchanged integer := 0;
begin
  if p_new_evaluation_id is null then
    raise exception 'reward_correction_evaluation_required';
  end if;

  select *
    into v_new
  from public.reward_progress_evaluations
  where id = p_new_evaluation_id;

  if not found then raise exception 'reward_progress_evaluation_not_found'; end if;
  if v_new.evaluation_kind <> 'recalculation' or v_new.outcome <> 'recalculated' then
    raise exception 'reward_correction_recalculation_required';
  end if;
  if v_new.supersedes_evaluation_id is null then
    raise exception 'reward_correction_supersedes_required';
  end if;

  select *
    into v_previous
  from public.reward_progress_evaluations
  where id = v_new.supersedes_evaluation_id;

  if not found then raise exception 'reward_correction_previous_evaluation_not_found'; end if;
  if v_previous.studio_id <> v_new.studio_id
     or v_previous.cycle_id <> v_new.cycle_id
     or v_previous.student_id <> v_new.student_id then
    raise exception 'reward_correction_context_mismatch';
  end if;

  if v_new.fulfilled then
    return jsonb_build_object(
      'evaluation_id', v_new.id,
      'previous_fulfilled', v_previous.fulfilled,
      'now_fulfilled', true,
      'grant_required', not v_previous.fulfilled,
      'revoked', 0,
      'review_incidents', 0,
      'critical_incidents', 0,
      'unchanged', 0
    );
  end if;

  if not v_previous.fulfilled then
    return jsonb_build_object(
      'evaluation_id', v_new.id,
      'previous_fulfilled', false,
      'now_fulfilled', false,
      'grant_required', false,
      'revoked', 0,
      'review_incidents', 0,
      'critical_incidents', 0,
      'unchanged', 0
    );
  end if;

  for v_reward in
    select *
    from public.reward_instances
    where studio_id = v_new.studio_id
      and student_id = v_new.student_id
      and cycle_id = v_new.cycle_id
      and (
        source_evaluation_id = v_previous.id
        or source_evaluation_id = v_new.supersedes_evaluation_id
      )
    order by created_at, id
    for update
  loop
    if v_reward.status in ('blocked', 'available') then
      perform private.revoke_reward_available_internal(
        v_reward.id,
        'progress_correction:' || v_new.id::text,
        null
      );
      v_revoked := v_revoked + 1;
    elsif v_reward.status = 'reserved' then
      v_incident_id := private.open_reward_incident_internal(
        v_reward.studio_id,
        v_reward.student_id,
        v_reward.rule_id,
        v_reward.id,
        'correction_while_reserved',
        'high',
        'La recompensa está reservada durante un recálculo de progreso.',
        jsonb_build_object(
          'new_evaluation_id', v_new.id,
          'previous_evaluation_id', v_previous.id,
          'reward_status', v_reward.status
        ),
        'correction:' || v_new.id::text || ':reward:' || v_reward.id::text,
        null
      );
      v_review := v_review + 1;
    elsif v_reward.status = 'redeemed' then
      v_incident_id := private.open_reward_incident_internal(
        v_reward.studio_id,
        v_reward.student_id,
        v_reward.rule_id,
        v_reward.id,
        'correction_after_redemption',
        'critical',
        'Una corrección invalidó el origen de una recompensa ya utilizada.',
        jsonb_build_object(
          'new_evaluation_id', v_new.id,
          'previous_evaluation_id', v_previous.id,
          'reward_status', v_reward.status,
          'redemption_context', v_reward.redemption_context
        ),
        'correction:' || v_new.id::text || ':reward:' || v_reward.id::text,
        null
      );
      v_critical := v_critical + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'evaluation_id', v_new.id,
    'previous_fulfilled', true,
    'now_fulfilled', false,
    'grant_required', false,
    'revoked', v_revoked,
    'review_incidents', v_review,
    'critical_incidents', v_critical,
    'unchanged', v_unchanged
  );
end;
$$;

revoke all on function public.system_reconcile_reward_correction(uuid)
from public, anon, authenticated;
grant execute on function public.system_reconcile_reward_correction(uuid)
to service_role;

create or replace function private.admin_request_reward_review_internal(
  p_reward_instance_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_existing public.reward_incidents%rowtype;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'reward_incident_reason_required';
  end if;

  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id;

  if not found then raise exception 'reward_instance_not_found'; end if;
  if not private.has_capability(v_reward.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;

  select *
    into v_existing
  from public.reward_incidents
  where studio_id = v_reward.studio_id
    and reward_instance_id = v_reward.id
    and incident_type = 'manual_reward_review'
    and status <> 'closed'
  order by opened_at desc
  limit 1;

  if found then return v_existing.id; end if;

  return private.open_reward_incident_internal(
    v_reward.studio_id,
    v_reward.student_id,
    v_reward.rule_id,
    v_reward.id,
    'manual_reward_review',
    'normal',
    'Revisar o ajustar una recompensa disponible.',
    jsonb_build_object(
      'reason', trim(p_reason),
      'reward_status', v_reward.status
    ),
    null,
    v_user_id
  );
end;
$$;

revoke all on function private.admin_request_reward_review_internal(uuid,text)
from public, anon;
grant execute on function private.admin_request_reward_review_internal(uuid,text)
to authenticated;

create or replace function public.admin_request_reward_review(
  p_reward_instance_id uuid,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_request_reward_review_internal(
    p_reward_instance_id,
    p_reason
  );
$$;

revoke all on function public.admin_request_reward_review(uuid,text)
from public, anon;
grant execute on function public.admin_request_reward_review(uuid,text)
to authenticated;

create or replace function private.admin_resolve_reward_incident_internal(
  p_incident_id uuid,
  p_action text,
  p_reason text,
  p_resolution_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.reward_incidents%rowtype;
  v_reward public.reward_instances%rowtype;
  v_user_id uuid := (select auth.uid());
  v_action text := trim(coalesce(p_action, ''));
  v_reason text := trim(coalesce(p_reason, ''));
  v_next public.reward_incident_status;
  v_resolution jsonb;
  v_now timestamptz := clock_timestamp();
  v_reward_status public.reward_instance_status;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if v_action = '' then raise exception 'reward_incident_action_required'; end if;
  if v_reason = '' then raise exception 'reward_incident_reason_required'; end if;
  if p_resolution_details is null or jsonb_typeof(p_resolution_details) <> 'object' then
    raise exception 'reward_incident_resolution_must_be_object';
  end if;

  select *
    into v_incident
  from public.reward_incidents
  where id = p_incident_id
  for update;

  if not found then raise exception 'reward_incident_not_found'; end if;
  if not private.has_capability(v_incident.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;
  if v_incident.status = 'closed' then
    raise exception 'reward_incident_already_closed';
  end if;

  if v_incident.reward_instance_id is not null then
    select *
      into v_reward
    from public.reward_instances
    where id = v_incident.reward_instance_id
    for update;
  end if;

  case v_action
    when 'mark_review' then
      if v_incident.status not in ('detected', 'in_review') then
        raise exception 'reward_incident_review_transition_invalid';
      end if;
      v_next := 'in_review';
      v_resolution := p_resolution_details || jsonb_build_object(
        'action', v_action,
        'reason', v_reason
      );

    when 'revoke_reward' then
      if v_incident.reward_instance_id is null then
        raise exception 'reward_incident_reward_required';
      end if;
      v_reward_status := private.revoke_reward_available_internal(
        v_incident.reward_instance_id,
        v_reason,
        v_user_id
      );
      v_next := 'resolved_manual';
      v_resolution := p_resolution_details || jsonb_build_object(
        'action', v_action,
        'reason', v_reason,
        'reward_status', v_reward_status
      );

    when 'keep_exception' then
      v_next := 'resolved_manual';
      v_resolution := p_resolution_details || jsonb_build_object(
        'action', v_action,
        'reason', v_reason,
        'reward_status', case when v_reward.id is null then null else v_reward.status::text end
      );

    when 'close_no_action' then
      v_next := 'no_action_required';
      v_resolution := p_resolution_details || jsonb_build_object(
        'action', v_action,
        'reason', v_reason
      );

    when 'close' then
      if v_incident.status not in (
        'resolved_automatic',
        'resolved_manual',
        'no_action_required',
        'in_review'
      ) then
        raise exception 'reward_incident_close_transition_invalid';
      end if;
      v_next := 'closed';
      v_resolution := case
        when v_incident.resolution = '{}'::jsonb
          then p_resolution_details || jsonb_build_object('action', v_action, 'reason', v_reason)
        else v_incident.resolution || p_resolution_details || jsonb_build_object(
          'closed_reason', v_reason
        )
      end;

    else
      raise exception 'reward_incident_action_invalid';
  end case;

  update public.reward_incidents
  set status = v_next,
      resolution = v_resolution,
      resolved_at = case
        when v_next in ('resolved_automatic', 'resolved_manual', 'no_action_required')
          then coalesce(resolved_at, v_now)
        else resolved_at
      end,
      closed_at = case when v_next = 'closed' then v_now else closed_at end,
      updated_by_user_id = v_user_id,
      updated_at = v_now
  where id = v_incident.id;

  insert into public.reward_incident_events (
    studio_id,
    incident_id,
    from_status,
    to_status,
    action,
    reason,
    actor_user_id,
    details,
    occurred_at
  ) values (
    v_incident.studio_id,
    v_incident.id,
    v_incident.status,
    v_next,
    v_action,
    v_reason,
    v_user_id,
    p_resolution_details,
    v_now
  );

  return jsonb_build_object(
    'incident_id', v_incident.id,
    'status', v_next,
    'reward_status', case
      when v_incident.reward_instance_id is null then null
      else (select status::text from public.reward_instances where id = v_incident.reward_instance_id)
    end
  );
end;
$$;

revoke all on function private.admin_resolve_reward_incident_internal(uuid,text,text,jsonb)
from public, anon;
grant execute on function private.admin_resolve_reward_incident_internal(uuid,text,text,jsonb)
to authenticated;

create or replace function public.admin_resolve_reward_incident(
  p_incident_id uuid,
  p_action text,
  p_reason text,
  p_resolution_details jsonb default '{}'::jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_resolve_reward_incident_internal(
    p_incident_id,
    p_action,
    p_reason,
    p_resolution_details
  );
$$;

revoke all on function public.admin_resolve_reward_incident(uuid,text,text,jsonb)
from public, anon;
grant execute on function public.admin_resolve_reward_incident(uuid,text,text,jsonb)
to authenticated;
