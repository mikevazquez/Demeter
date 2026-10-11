create or replace function public.admin_extend_reward_instance(p_reward_instance_id uuid, p_days integer, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_reward public.reward_instances%rowtype; v_expiry timestamptz; v_status public.reward_instance_status;
begin
 if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
 if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'reward_adjustment_reason_required'; end if;
 if p_days is null or p_days not in (7,14,30) then raise exception 'reward_extension_invalid'; end if;
 select * into v_reward from public.reward_instances where id=p_reward_instance_id for update;
 if not found then raise exception 'reward_instance_not_found'; end if;
 if not private.has_capability(v_reward.studio_id,'rewards.manage') then raise exception 'forbidden'; end if;
 if v_reward.status not in ('available','expired') or v_reward.expires_at is null then raise exception 'reward_adjustment_not_allowed'; end if;
 v_expiry := greatest(now(),v_reward.expires_at)+make_interval(days=>p_days);
 v_status := 'available';
 update public.reward_instances set expires_at=v_expiry,status=v_status,updated_at=now() where id=v_reward.id;
 insert into public.reward_instance_events(studio_id,reward_instance_id,event_type,from_status,to_status,details,actor_user_id)
 values(v_reward.studio_id,v_reward.id,'adjusted',v_reward.status,v_status,
 jsonb_build_object('reason',trim(p_reason),'old_expires_at',v_reward.expires_at,'new_expires_at',v_expiry,'days',p_days),
 (select auth.uid()));
 return jsonb_build_object('reward_instance_id',v_reward.id,'expires_at',v_expiry,'status',v_status);
end; $$;
revoke all on function public.admin_extend_reward_instance(uuid,integer,text) from public,anon;
grant execute on function public.admin_extend_reward_instance(uuid,integer,text) to authenticated;
