create or replace function public.admin_upsert_profile_field_definition(p_studio_id uuid,p_label text,p_field_type text,p_options jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
 if not private.has_capability(p_studio_id,'settings.write') then raise exception 'forbidden'; end if;
 if length(trim(coalesce(p_label,''))) not between 2 and 80 then raise exception 'profile_field_label_invalid'; end if;
 if p_field_type not in ('short_text','long_text','number','date','boolean','single_select','multi_select') then raise exception 'profile_field_type_invalid'; end if;
 if p_field_type in ('single_select','multi_select') and (p_options is null or jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options)=0) then raise exception 'profile_field_options_required'; end if;
 v_id:=gen_random_uuid();
 insert into public.profile_field_definitions(id,studio_id,entity_type,key,label,field_type,options,sort_order)
 values(v_id,p_studio_id,'student','custom_'||replace(v_id::text,'-',''),trim(p_label),p_field_type::public.profile_field_type,p_options,100);
 return v_id;
end; $$;
create or replace function public.admin_deactivate_profile_field_definition(p_definition_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_studio uuid;
begin
 if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
 select studio_id into v_studio from public.profile_field_definitions where id=p_definition_id and entity_type='student' and key like 'custom_%' for update;
 if not found then raise exception 'profile_field_not_custom'; end if;
 if not private.has_capability(v_studio,'settings.write') then raise exception 'forbidden'; end if;
 update public.profile_field_definitions set active=false,updated_at=now() where id=p_definition_id;
end; $$;
revoke all on function public.admin_upsert_profile_field_definition(uuid,text,text,jsonb),public.admin_deactivate_profile_field_definition(uuid) from public,anon;
grant execute on function public.admin_upsert_profile_field_definition(uuid,text,text,jsonb),public.admin_deactivate_profile_field_definition(uuid) to authenticated;
