-- NEB-01-05 · Nébora: nombre corto de marca por estudio.
-- Antes, «Demeter» estaba escrito fijo en el portal, en notificaciones y en Demi. Ahora cada
-- estudio tiene su nombre corto de marca (por ejemplo «Demeter» para «Demeter Fitness Studio»).
-- Si un estudio no lo define, la app usa su nombre completo. Demeter queda exactamente igual.
-- Aplicar ANTES de publicar el código que lo lee (si falta la columna, la app usa el nombre).

alter table public.studios
  add column if not exists brand_name text;

alter table public.studios
  drop constraint if exists studios_brand_name_length_chk,
  add constraint studios_brand_name_length_chk
    check (brand_name is null or length(trim(brand_name)) between 1 and 40);

comment on column public.studios.brand_name is
  'Nombre corto de marca que ve la alumna (portal, avisos, Demi). Null = usar studios.name.';

update public.studios
set brand_name = 'Demeter'
where slug = 'demeter-fitness' and brand_name is null;
