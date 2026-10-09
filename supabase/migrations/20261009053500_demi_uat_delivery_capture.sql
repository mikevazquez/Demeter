create function public.service_capture_demi_uat_delivery(p_studio uuid,p_kind text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.demi_uat_runs%rowtype; artifact uuid:=gen_random_uuid(); remaining integer; failed boolean;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into r from public.demi_uat_runs where studio_id=p_studio for update;
 if not found then return null; end if;
 remaining:=coalesce((r.faults->>'delivery_failures_remaining')::integer,0);
 failed:=remaining>0;
 if failed then update public.demi_uat_runs set faults=jsonb_set(faults,'{delivery_failures_remaining}',to_jsonb(remaining-1)) where id=r.id; end if;
 insert into public.demi_uat_artifacts(id,run_id,kind,payload) values(artifact,r.id,p_kind,p_payload||jsonb_build_object('captured',true,'failed',failed,'error_code',case when failed then 'demi_uat_injected_delivery_failure' else null end));
 return jsonb_build_object('artifact_id',artifact,'run_id',r.id,'captured',true,'failed',failed);
end;
$$;
revoke all on function public.service_capture_demi_uat_delivery(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.service_capture_demi_uat_delivery(uuid,text,jsonb) to service_role;

create function public.service_acquire_demi_uat_run(p_run uuid,p_owner uuid,p_source uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'forbidden'; end if;
 update public.demi_uat_runs set lease_until=clock_timestamp()+interval '5 minutes'
 where id=p_run and owner_id=p_owner and source_studio_id=p_source and (lease_until is null or lease_until<clock_timestamp());
 return found;
end;
$$;
revoke all on function public.service_acquire_demi_uat_run(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_acquire_demi_uat_run(uuid,uuid,uuid) to service_role;
