-- EVALUACIONES-01 · Case 8 completion gate.
-- Every configured technical item must be evaluated before the technical phase can close.
-- "mandatory" remains a progression requirement; it is not the capture-completeness flag.

create or replace function private.evaluations_capture_incomplete(
  p_evaluation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
begin
  select *
    into v_evaluation
  from public.technical_evaluations
  where id = p_evaluation_id;

  if v_evaluation.id is null then
    raise exception 'evaluation_not_found';
  end if;

  return exists (
    select 1
    from public.evaluation_template_elements te
    left join public.technical_evaluation_element_results er
      on er.template_element_id = te.id
     and er.evaluation_id = p_evaluation_id
    where te.template_version_id = v_evaluation.template_version_id
      and (
        coalesce(er.result_status, 'not_evaluated') = 'not_evaluated'
        or (te.scored and er.score is null)
      )
  )
  or exists (
    select 1
    from public.evaluation_template_combos tc
    left join public.technical_evaluation_combo_results cr
      on cr.template_combo_id = tc.id
     and cr.evaluation_id = p_evaluation_id
    where tc.template_version_id = v_evaluation.template_version_id
      and (
        coalesce(cr.result_status, 'not_evaluated') = 'not_evaluated'
        or (tc.scored and cr.score is null)
      )
  );
end;
$$;

revoke all on function private.evaluations_capture_incomplete(uuid)
from public, anon, authenticated, service_role;

create or replace function public.admin_recalculate_technical_evaluation(
  p_evaluation_id uuid
)
returns table (
  total_score numeric,
  automatic_outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
  v_total numeric;
  v_outcome text;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  select r.total_score, r.automatic_outcome
    into v_total, v_outcome
  from private.evaluations_recalculate(p_evaluation_id) r;

  if private.evaluations_capture_incomplete(p_evaluation_id) then
    v_outcome := 'incomplete';

    update public.technical_evaluations
    set
      automatic_outcome = 'incomplete',
      updated_at = now(),
      last_saved_at = now()
    where id = p_evaluation_id;
  end if;

  total_score := v_total;
  automatic_outcome := v_outcome;
  return next;
end;
$$;

revoke all on function public.admin_recalculate_technical_evaluation(uuid)
from public, anon;

grant execute on function public.admin_recalculate_technical_evaluation(uuid)
to authenticated;

create or replace function private.evaluations_block_incomplete_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published'
     and old.status is distinct from 'published'
     and (
       new.automatic_outcome = 'incomplete'
       or new.final_outcome = 'incomplete'
       or private.evaluations_capture_incomplete(new.id)
     ) then
    raise exception 'evaluation_incomplete';
  end if;

  return new;
end;
$$;

revoke all on function private.evaluations_block_incomplete_publish()
from public, anon, authenticated, service_role;

drop trigger if exists technical_evaluations_completion_gate
on public.technical_evaluations;

create trigger technical_evaluations_completion_gate
before update of status, automatic_outcome, final_outcome
on public.technical_evaluations
for each row
execute function private.evaluations_block_incomplete_publish();
