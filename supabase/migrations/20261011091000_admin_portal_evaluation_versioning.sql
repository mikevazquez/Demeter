create or replace function public.admin_clone_evaluation_five_step_version(p_source_version_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.evaluation_template_versions%rowtype;c public.evaluation_template_criteria%rowtype;e public.evaluation_template_elements%rowtype;k public.evaluation_template_combos%rowtype;v_id uuid:=gen_random_uuid();v_num integer;new_criterion uuid;mapping jsonb:='{}'::jsonb;draft_id uuid;
begin
select * into s from public.evaluation_template_versions where id=p_source_version_id;
if not found then raise exception 'version_not_found';end if;
if auth.uid() is null or not private.has_capability(s.studio_id,'evaluations.configure') then raise exception 'forbidden';end if;
perform 1 from public.evaluation_templates where id=s.template_id and studio_id=s.studio_id for update;
select id into draft_id from public.evaluation_template_versions where template_id=s.template_id and status='draft' and schema_version=1 order by version_number desc limit 1;
if draft_id is not null then return draft_id;end if;
select coalesce(max(version_number),0)+1 into v_num from public.evaluation_template_versions where template_id=s.template_id;
insert into public.evaluation_template_versions select (jsonb_populate_record(null::public.evaluation_template_versions,to_jsonb(s)||jsonb_build_object('id',v_id,'version_number',v_num,'status','draft','schema_version',1,'created_by',auth.uid(),'activated_at',null,'archived_at',null,'created_at',now(),'updated_at',now()))).*;
for c in select * from public.evaluation_template_criteria where template_version_id=s.id order by sort_order loop
new_criterion:=gen_random_uuid();mapping:=mapping||jsonb_build_object(c.id::text,new_criterion);
insert into public.evaluation_template_criteria select (jsonb_populate_record(null::public.evaluation_template_criteria,to_jsonb(c)||jsonb_build_object('id',new_criterion,'template_version_id',v_id))).*;
end loop;
for e in select * from public.evaluation_template_elements where template_version_id=s.id loop
insert into public.evaluation_template_elements select (jsonb_populate_record(null::public.evaluation_template_elements,to_jsonb(e)||jsonb_build_object('id',gen_random_uuid(),'template_version_id',v_id,'criterion_id',mapping->>e.criterion_id::text,'element_snapshot',coalesce(e.element_snapshot,'{}'::jsonb)||jsonb_build_object('name',coalesce(nullif(e.item_label,''),e.element_snapshot->>'name','Elemento técnico'))))).*;
end loop;
for k in select * from public.evaluation_template_combos where template_version_id=s.id loop
insert into public.evaluation_template_combos select (jsonb_populate_record(null::public.evaluation_template_combos,to_jsonb(k)||jsonb_build_object('id',gen_random_uuid(),'template_version_id',v_id,'criterion_id',mapping->>k.criterion_id::text))).*;
end loop;
return v_id;
end;$$;
create or replace function public.admin_publish_evaluation_version(p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.evaluation_template_versions%rowtype;t public.evaluation_templates%rowtype;total numeric;
begin
select * into v from public.evaluation_template_versions where id=p_version_id;
if not found then raise exception 'version_not_found';end if;
if auth.uid() is null or not private.has_capability(v.studio_id,'evaluations.configure') then raise exception 'forbidden';end if;
select * into t from public.evaluation_templates where id=v.template_id and studio_id=v.studio_id for update;
if v.schema_version<>1 then raise exception 'five_step_editor_required';end if;
if v.status not in ('draft','active') then raise exception 'version_not_editable';end if;
select sum(weight_percent) into total from public.evaluation_template_criteria where template_version_id=v.id;
if coalesce(total,0)<>100 or not exists(select 1 from public.evaluation_template_elements where template_version_id=v.id) then raise exception 'rubric_incomplete';end if;
if exists(select 1 from public.evaluation_template_criteria where template_version_id=v.id and (weight_percent<0 or min_percent<0 or min_percent>100)) then raise exception 'rubric_invalid';end if;
update public.evaluation_template_versions set status='archived',archived_at=now(),updated_at=now() where template_id=v.template_id and status='active' and id<>v.id;
update public.evaluation_template_versions set status='active',activated_at=coalesce(activated_at,now()),updated_at=now() where id=v.id;
update public.discipline_technical_levels set active=true where id=t.discipline_technical_level_id and studio_id=v.studio_id;
end;$$;
revoke all on function public.admin_clone_evaluation_five_step_version(uuid),public.admin_publish_evaluation_version(uuid) from public,anon;
grant execute on function public.admin_clone_evaluation_five_step_version(uuid),public.admin_publish_evaluation_version(uuid) to authenticated;
