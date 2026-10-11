create or replace function public.admin_configure_calendar_event(p_studio_id uuid,p_event_id uuid,p_days jsonb,p_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.calendar_events%rowtype; item jsonb; official_id uuid; source text; result jsonb; total integer:=0; day_name text;
begin
  if (select auth.uid()) is null or not private.has_capability(p_studio_id,'settings.write') then raise exception 'forbidden'; end if;
  select * into e from public.calendar_events where id=p_event_id and (studio_id is null or studio_id=p_studio_id) for update;
  if not found then raise exception 'event_not_found'; end if;
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days)<>jsonb_array_length(e.days) then raise exception 'all_days_required'; end if;
  if (select count(distinct value->>'date') from jsonb_array_elements(p_days))<>jsonb_array_length(e.days) then raise exception 'duplicate_day'; end if;
  for item in select value from jsonb_array_elements(p_days) loop
    if not exists(select 1 from jsonb_array_elements(e.days) d where d->>'date'=item->>'date') or item->>'mode' not in ('normal','closed','special') or item->>'mode' is null then raise exception 'invalid_day'; end if;
    if (item->>'date')::date < (select (now() at time zone timezone)::date from public.studios where id=p_studio_id) then continue; end if;
    select id into official_id from public.official_holidays where country_code='MX' and holiday_date=(item->>'date')::date and is_official limit 1;
    source:=case when official_id is not null then 'official' else 'manual' end;
    select d->>'name' into day_name from jsonb_array_elements(e.days) d where d->>'date'=item->>'date';
    result:=public.admin_save_calendar_day(p_studio_id,(item->>'date')::date,source,
      case when e.kind='propia' then 'Cierre del estudio · '||e.name when jsonb_array_length(e.days)>1 then e.name||' · '||day_name else 'Día festivo · '||e.name end,
      item->>'mode',coalesce(nullif(btrim(p_message),''),e.message),
      array(select value::uuid from jsonb_array_elements_text(coalesce(item->'keep','[]'::jsonb))),e.code,null,null);
    update public.studio_holiday_overrides set calendar_event_id=e.id,custom_name=case when source_kind='manual' then e.name else custom_name end where studio_id=p_studio_id and holiday_date=(item->>'date')::date;
    total:=total+1;
  end loop;
  if total=0 then raise exception 'past_day'; end if;
  return jsonb_build_object('ok',true,'days',total);
end;
$$;
revoke all on function public.admin_configure_calendar_event(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.admin_configure_calendar_event(uuid,uuid,jsonb,text) to authenticated;


-- Verified 2026-10-11 against INE's published PEF 2026–2027 calendar.
-- https://www.ine.mx/voto-y-elecciones/elecciones-2027/
insert into public.official_holidays(country_code,holiday_code,holiday_date,name,theme_key,default_message,source_label,source_url,legal_basis,source_checked_at,is_official)
values('MX','federal_election_2027','2027-06-06','Jornada electoral federal','elections','Hoy es día de elecciones. Ve a votar y revisa los horarios del estudio.','Instituto Nacional Electoral · Proceso Electoral Federal 2026–2027','https://www.ine.mx/voto-y-elecciones/elecciones-2027/','LFT Art. 74 fracción IX · INE/CG480/2026','2026-10-11T07:00:00Z',true)
on conflict(country_code,holiday_code,holiday_date) do nothing;
insert into public.calendar_events(code,name,starts_on,ends_on,kind,icon,accent,secondary,message,legal_basis,days)
values('elecciones','Jornada electoral federal','2027-06-06','2027-06-06','oficial','🗳','#7c3aed','#0e7490','Hoy es día de elecciones. Ve a votar y revisa los horarios del estudio.','LFT Art. 74 fracción IX · INE/CG480/2026','[{"date":"2027-06-06","name":"Jornada electoral federal","official":true,"suggest":"closed"}]'::jsonb)
on conflict(studio_id,code,starts_on) do nothing;
