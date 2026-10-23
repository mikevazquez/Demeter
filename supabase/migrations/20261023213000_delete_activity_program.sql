-- TALLERES-LEGACY-DELETE: safe operational deletion for activity_programs.
-- The program and its generated records remain for audit/history. Operational surfaces stop exposing them.

create or replace function public.admin_delete_activity_program(p_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.activity_programs%rowtype;
  v_net_paid bigint := 0;
  v_reserved integer := 0;
  v_sessions integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_program
  from public.activity_programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'program_not_found';
  end if;

  if not private.has_capability(v_program.studio_id, 'schedule.write')
     or not private.has_capability(v_program.studio_id, 'products.write') then
    raise exception 'forbidden';
  end if;

  if not v_program.active then
    return jsonb_build_object(
      'ok', true,
      'program_id', v_program.id,
      'program_name', v_program.name,
      'replayed', true,
      'sessions_cancelled', 0,
      'reservations_cancelled', 0
    );
  end if;

  select coalesce(sum(case when pay.kind::text = 'refund' then -pay.amount_minor else pay.amount_minor end), 0)
    into v_net_paid
  from public.payments pay
  where pay.studio_id = v_program.studio_id
    and pay.sale_id in (
      select distinct sl.sale_id
      from public.sale_lines sl
      where sl.studio_id = v_program.studio_id
        and (
          sl.product_template_id = v_program.full_product_id
          or sl.product_template_id in (
            select aps.single_product_id
            from public.activity_program_sessions aps
            where aps.program_id = v_program.id
              and aps.studio_id = v_program.studio_id
              and aps.single_product_id is not null
          )
        )
    );

  if v_net_paid <> 0 then
    raise exception 'program_has_recorded_payments';
  end if;

  select count(*)
    into v_reserved
  from public.reservations r
  join public.activity_program_sessions aps
    on aps.session_id = r.session_id
   and aps.studio_id = r.studio_id
  where aps.program_id = v_program.id
    and aps.studio_id = v_program.studio_id
    and r.status::text = 'reserved';

  -- The existing class_session_cancel_reservations trigger performs the actual
  -- reservation cancellation, credit release and waitlist expiration.
  update public.class_sessions s
  set status = 'cancelled',
      assistant_visible = false
  from public.activity_program_sessions aps
  where aps.program_id = v_program.id
    and aps.studio_id = v_program.studio_id
    and aps.session_id = s.id
    and s.studio_id = v_program.studio_id
    and s.status = 'scheduled';

  get diagnostics v_sessions = row_count;

  update public.class_templates
  set active = false
  where studio_id = v_program.studio_id
    and program_id = v_program.id;

  update public.product_templates pt
  set active = false,
      assistant_visible = false
  where pt.studio_id = v_program.studio_id
    and (
      pt.id = v_program.full_product_id
      or pt.id in (
        select aps.single_product_id
        from public.activity_program_sessions aps
        where aps.program_id = v_program.id
          and aps.studio_id = v_program.studio_id
          and aps.single_product_id is not null
      )
    );

  update public.activity_programs
  set active = false
  where id = v_program.id
    and studio_id = v_program.studio_id;

  return jsonb_build_object(
    'ok', true,
    'program_id', v_program.id,
    'program_name', v_program.name,
    'replayed', false,
    'sessions_cancelled', v_sessions,
    'reservations_cancelled', v_reserved
  );
end;
$$;

revoke all on function public.admin_delete_activity_program(uuid) from public, anon;
grant execute on function public.admin_delete_activity_program(uuid) to authenticated;
