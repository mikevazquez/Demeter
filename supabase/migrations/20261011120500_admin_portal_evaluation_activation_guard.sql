create or replace function private.guard_evaluation_level_published()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.active and not exists(select 1 from public.evaluation_templates t join public.evaluation_template_versions v on v.template_id=t.id and v.studio_id=t.studio_id where t.discipline_technical_level_id=new.id and t.studio_id=new.studio_id and t.archived_at is null and v.status='active') then raise exception 'level_unpublished'; end if;
 return new;
end; $$;
create trigger evaluation_level_requires_published before insert or update of active on public.discipline_technical_levels for each row execute function private.guard_evaluation_level_published();
update public.discipline_technical_levels l set active=false where active and not exists(select 1 from public.evaluation_templates t join public.evaluation_template_versions v on v.template_id=t.id and v.studio_id=t.studio_id where t.discipline_technical_level_id=l.id and t.studio_id=l.studio_id and t.archived_at is null and v.status='active');
