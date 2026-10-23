-- NEB-01-21 · Demi: costo por estudio para la consola (sin texto de mensajes).
-- Ya se registra cada llamada en assistant_model_calls; aquí solo se resume por día, modelo y conversación.

create or replace function public.platform_studio_demi_usage(p_studio uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_tz text;
  v_since timestamptz;
begin
  perform private.platform_require_admin();
  select coalesce(nullif(timezone, ''), 'America/Mexico_City') into v_tz from public.studios where id = p_studio;
  if not found then
    raise exception 'studio_not_found';
  end if;
  v_since := ((now() at time zone v_tz)::date - (v_days - 1)) at time zone v_tz;

  return jsonb_build_object(
    'days', v_days,
    'totals', (
      select jsonb_build_object(
        'calls', count(*),
        'errors', count(*) filter (where c.status = 'error'),
        'input_tokens', coalesce(sum(c.input_tokens), 0),
        'cached_input_tokens', coalesce(sum(c.cached_input_tokens), 0),
        'output_tokens', coalesce(sum(c.output_tokens), 0),
        'cost_usd_micros', coalesce(sum(c.estimated_cost_usd_micros), 0),
        'conversations', count(distinct c.conversation_id))
      from public.assistant_model_calls c
      where c.studio_id = p_studio and c.created_at >= v_since),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'calls', d.calls, 'tokens', d.tokens, 'cost_usd_micros', d.cost)
        order by d.day)
      from (
        select (c.created_at at time zone v_tz)::date as day, count(*) as calls,
          coalesce(sum(c.input_tokens + c.output_tokens), 0) as tokens,
          coalesce(sum(c.estimated_cost_usd_micros), 0) as cost
        from public.assistant_model_calls c
        where c.studio_id = p_studio and c.created_at >= v_since
        group by 1) d), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object('model', m.model, 'calls', m.calls, 'cost_usd_micros', m.cost) order by m.cost desc)
      from (
        select coalesce(c.model, '—') as model, count(*) as calls, coalesce(sum(c.estimated_cost_usd_micros), 0) as cost
        from public.assistant_model_calls c
        where c.studio_id = p_studio and c.created_at >= v_since
        group by 1) m), '[]'::jsonb),
    'top_conversations', coalesce((
      select jsonb_agg(jsonb_build_object('conversation_id', t.conversation_id, 'calls', t.calls,
        'cost_usd_micros', t.cost, 'last_at', t.last_at) order by t.cost desc)
      from (
        select c.conversation_id, count(*) as calls, coalesce(sum(c.estimated_cost_usd_micros), 0) as cost,
          max(c.created_at) as last_at
        from public.assistant_model_calls c
        where c.studio_id = p_studio and c.created_at >= v_since and c.conversation_id is not null
        group by 1
        order by 3 desc
        limit 10) t), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_studio_demi_usage(uuid, integer) from public, anon;
grant execute on function public.platform_studio_demi_usage(uuid, integer) to authenticated;
