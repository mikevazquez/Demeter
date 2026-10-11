create or replace function public.admin_retention_students(p_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;today date;
begin
 if not private.has_capability(p_studio_id,'reports.read') then raise exception 'forbidden';end if;
 select (now() at time zone timezone)::date into today from public.studios where id=p_studio_id;
 select coalesce(jsonb_agg(jsonb_build_object('student_id',s.id,'last_attendance',(select max(cs.starts_at) from public.reservations r join public.class_sessions cs on cs.id=r.session_id and cs.studio_id=r.studio_id where r.studio_id=p_studio_id and r.student_id=s.id and r.status='attended'),'first_start',first_package.starts_on,'current_start',current_package.starts_on,'current_expiry',current_package.expires_on,'current_unlimited',current_package.unlimited,'remaining_credits',case when current_package.id is not null and not current_package.unlimited then (select coalesce(sum(quantity),0) from public.credit_ledger where acquisition_id=current_package.id and studio_id=p_studio_id) else null end)),'[]'::jsonb) into result
 from public.students s
 left join lateral(select a.starts_on from public.product_acquisitions a join public.product_templates t on t.id=a.product_template_id and t.studio_id=a.studio_id where a.studio_id=p_studio_id and a.student_id=s.id and t.product_type in ('package','membership') and a.status<>'cancelled' and a.refunded_at is null and a.starts_on is not null order by a.starts_on,a.created_at limit 1) first_package on true
 left join lateral(select a.* from public.product_acquisitions a join public.product_templates t on t.id=a.product_template_id and t.studio_id=a.studio_id where a.studio_id=p_studio_id and a.student_id=s.id and t.product_type in ('package','membership') and a.status='active' and a.refunded_at is null and not a.access_blocked and a.starts_on<=today and (a.expires_on is null or a.expires_on>=today) order by a.starts_on desc,a.created_at desc limit 1) current_package on true
 where s.studio_id=p_studio_id and s.lifecycle_status<>'archived';
 return result;
end $$;
revoke all on function public.admin_retention_students(uuid) from public,anon;
grant execute on function public.admin_retention_students(uuid) to authenticated;
