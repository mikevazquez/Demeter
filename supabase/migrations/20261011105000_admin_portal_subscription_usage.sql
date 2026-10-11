alter table public.saas_plans add column max_active_students integer check(max_active_students>0),add column ai_included_mxn_minor bigint check(ai_included_mxn_minor>=0);
create or replace function public.owner_get_subscription_usage(p_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tz text; active_students integer; costs bigint; tokens bigint;
begin
 if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
 if not exists(select 1 from public.studio_memberships where studio_id=p_studio_id and user_id=(select auth.uid()) and role='owner' and active) then raise exception 'forbidden'; end if;
 select timezone into tz from public.studios where id=p_studio_id;
 select count(*) into active_students from public.students s where s.studio_id=p_studio_id and s.active and s.lifecycle_status='active' and exists(
 select 1 from public.student_enrollments e where e.student_id=s.id and e.studio_id=p_studio_id and e.status='active' and e.refunded_at is null and e.starts_on <= (now() at time zone tz)::date and (e.expires_on is null or e.expires_on >= (now() at time zone tz)::date));
 select coalesce(sum(estimated_cost_usd_micros),0),coalesce(sum(input_tokens+output_tokens),0) into costs,tokens
 from public.assistant_model_calls where studio_id=p_studio_id and created_at >= (date_trunc('month',now() at time zone tz) at time zone tz);
 return jsonb_build_object('active_students',active_students,'estimated_cost_usd_micros',costs,'tokens',tokens,'month_start',(date_trunc('month',now() at time zone tz) at time zone tz));
end; $$;
revoke all on function public.owner_get_subscription_usage(uuid) from public,anon;
grant execute on function public.owner_get_subscription_usage(uuid) to authenticated;
