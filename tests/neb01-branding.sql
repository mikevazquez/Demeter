-- NEB-01-05 · brand_name per studio (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);
insert into results select 1, 'demeter conserva su marca corta',
  (select brand_name = 'Demeter' from public.studios where slug = 'demeter-fitness');
insert into public.studios (name, slug) values ('Estudio Nuevo', 'estudio-nuevo');
insert into results select 2, 'estudio nuevo sin marca corta usa su nombre',
  (select brand_name is null from public.studios where slug = 'estudio-nuevo');
do $$ begin
  update public.studios set brand_name = '   ' where slug = 'estudio-nuevo';
  insert into results values (3, 'marca vacía rechazada', false);
exception when check_violation then
  insert into results values (3, 'marca vacía rechazada', true);
end $$;
select case when bool_and(coalesce(ok, false)) and count(*) = 3 then 'NEB01 BRANDING OK ' || count(*) else 'NEB01 BRANDING FAIL' end from results;
rollback;
