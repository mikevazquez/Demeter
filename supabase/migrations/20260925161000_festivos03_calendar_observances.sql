-- FESTIVOS-03 · cultural and civic Mexican observances for the calendar.
-- Operational rules remain attached only to official holidays or explicit studio overrides.

drop policy if exists official_holidays_read on public.official_holidays;
create policy official_holidays_read
on public.official_holidays
for select
to authenticated
using (country_code = 'MX');

create or replace function private.gregorian_easter_sunday(p_year integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a integer;
  b integer;
  c integer;
  d integer;
  e integer;
  f integer;
  g integer;
  h integer;
  i integer;
  k integer;
  l integer;
  m integer;
  month_number integer;
  day_number integer;
begin
  a := mod(p_year, 19);
  b := p_year / 100;
  c := mod(p_year, 100);
  d := b / 4;
  e := mod(b, 4);
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := mod(19 * a + b - d - g + 15, 30);
  i := c / 4;
  k := mod(c, 4);
  l := mod(32 + 2 * e + 2 * i - h - k, 7);
  m := (a + 11 * h + 22 * l) / 451;
  month_number := (h + l - 7 * m + 114) / 31;
  day_number := mod(h + l - 7 * m + 114, 31) + 1;
  return make_date(p_year, month_number, day_number);
end;
$$;

revoke all on function private.gregorian_easter_sunday(integer)
from public, anon, authenticated, service_role;

create or replace function private.refresh_mexico_calendar_observances(
  p_start_year integer,
  p_end_year integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  y integer;
  easter date;
  first_june date;
  fathers_day date;
  v_rows integer := 0;
  v_count integer;
  v_source_url text := 'https://www.gob.mx/';
  v_source_label text := 'Calendario cultural y cívico de México';
  v_legal text := 'Conmemoración cultural/cívica · no implica descanso obligatorio por la LFT';
begin
  if p_start_year is null
     or p_end_year is null
     or p_start_year < 2024
     or p_end_year < p_start_year
     or p_end_year - p_start_year > 30 then
    raise exception 'holiday_year_range_invalid';
  end if;

  for y in p_start_year..p_end_year loop
    easter := private.gregorian_easter_sunday(y);
    first_june := make_date(y, 6, 1);
    fathers_day := first_june
      + ((7 - extract(isodow from first_june)::integer) % 7)
      + 14;

    insert into public.official_holidays (
      country_code, holiday_code, holiday_date, name, theme_key, default_message,
      source_label, source_url, legal_basis, source_checked_at, is_official, updated_at
    )
    values
      ('MX','reyes',make_date(y,1,6),'Día de Reyes','reyes',
       'Hoy celebramos el Día de Reyes. Que no falten la ilusión y los buenos momentos.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','candelaria',make_date(y,2,2),'Día de la Candelaria','candelaria',
       'Hoy celebramos una de las tradiciones más queridas de México: el Día de la Candelaria.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','san_valentin',make_date(y,2,14),'Día del Amor y la Amistad','san_valentin',
       'Hoy celebramos el amor, la amistad y a las personas que hacen nuestros días más bonitos.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','flag_day',make_date(y,2,24),'Día de la Bandera','bandera',
       'Hoy conmemoramos uno de los símbolos que representan la historia y la identidad de México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','womens_day',make_date(y,3,8),'Día Internacional de la Mujer','mujer',
       'Hoy reconocemos la fuerza, la historia y las aportaciones de las mujeres.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','oil_expropriation',make_date(y,3,18),'Expropiación Petrolera','expropiacion_petrolera',
       'Hoy recordamos un momento importante de la historia contemporánea de México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','holy_thursday',easter - 3,'Jueves Santo','semana_santa',
       'Semana Santa forma parte de las tradiciones religiosas y culturales más reconocidas en México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','good_friday',easter - 2,'Viernes Santo','semana_santa',
       'Semana Santa forma parte de las tradiciones religiosas y culturales más reconocidas en México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','easter',easter,'Domingo de Pascua','pascua',
       'Hoy celebramos el Domingo de Pascua.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','childrens_day',make_date(y,4,30),'Día del Niño y la Niña','dia_nino',
       'Hoy celebramos la alegría, creatividad y curiosidad de las niñas y los niños.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','cinco_de_mayo',make_date(y,5,5),'Batalla de Puebla','batalla_puebla',
       'Hoy recordamos la Batalla de Puebla, una fecha histórica de México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','mothers_day',make_date(y,5,10),'Día de las Madres','dia_madres',
       'Hoy celebramos y reconocemos a las mamás.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','teachers_day',make_date(y,5,15),'Día del Maestro y la Maestra','dia_maestro',
       'Hoy reconocemos a quienes enseñan, acompañan e inspiran.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','fathers_day',fathers_day,'Día del Padre','dia_padre',
       'Hoy celebramos y reconocemos a los papás.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','ninos_heroes',make_date(y,9,13),'Niños Héroes','ninos_heroes',
       'Hoy recordamos a los Niños Héroes y un episodio emblemático de la historia de México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','dia_raza',make_date(y,10,12),'Día de la Raza','dia_raza',
       'Hoy se conmemora el 12 de octubre, una fecha de reflexión sobre la historia y diversidad cultural de América.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','halloween',make_date(y,10,31),'Halloween','halloween',
       'Hoy es Halloween. Que sea una noche divertida y llena de creatividad.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','dia_muertos_1',make_date(y,11,1),'Día de Muertos','dia_muertos',
       'Hoy honramos la memoria y celebramos la vida a través de una de las tradiciones más emblemáticas de México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','dia_muertos_2',make_date(y,11,2),'Día de Muertos','dia_muertos',
       'Hoy honramos la memoria y celebramos la vida a través de una de las tradiciones más emblemáticas de México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','guadalupe',make_date(y,12,12),'Día de la Virgen de Guadalupe','guadalupe',
       'Hoy se celebra el Día de la Virgen de Guadalupe, una fecha profundamente arraigada en la cultura mexicana.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','posadas',make_date(y,12,16),'Inicio de las Posadas','posadas',
       'Comienzan las Posadas, una de las tradiciones decembrinas más queridas de México.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','nochebuena',make_date(y,12,24),'Nochebuena','nochebuena',
       'Te deseamos una Nochebuena llena de momentos especiales.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp()),
      ('MX','new_year_eve',make_date(y,12,31),'Fin de Año','fin_ano',
       'Cerramos el año agradeciendo todo lo vivido y preparándonos para un nuevo comienzo.',
       v_source_label,v_source_url,v_legal,clock_timestamp(),false,clock_timestamp())
    on conflict (country_code, holiday_code, holiday_date)
    do update set
      name = excluded.name,
      theme_key = excluded.theme_key,
      default_message = excluded.default_message,
      source_label = excluded.source_label,
      source_url = excluded.source_url,
      legal_basis = excluded.legal_basis,
      source_checked_at = excluded.source_checked_at,
      is_official = false,
      updated_at = excluded.updated_at;

    get diagnostics v_count = row_count;
    v_rows := v_rows + v_count;
  end loop;

  return v_rows;
end;
$$;

revoke all on function private.refresh_mexico_calendar_observances(integer, integer)
from public, anon, authenticated, service_role;

select private.refresh_mexico_calendar_observances(2026, 2042);

create or replace function public.student_holiday_snapshot(target_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.*
    into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  with candidate as (
    select
      h.id as holiday_id,
      h.holiday_code,
      h.holiday_date,
      h.name,
      coalesce(case when h.is_official then o.theme_key end, h.theme_key) as theme_key,
      h.is_official,
      case when h.is_official then coalesce(o.operation_mode, 'normal') else 'normal' end as operation_mode,
      case
        when h.is_official then coalesce(nullif(trim(o.student_message), ''), h.default_message)
        else h.default_message
      end as message,
      h.is_official and o.id is not null as configured,
      h.source_label,
      h.source_url,
      h.legal_basis,
      case when h.is_official then o.hero_image_path end as hero_image_path,
      case when h.is_official then o.message_image_path end as message_image_path,
      case when h.is_official then 10 else 1 end as priority
    from public.official_holidays h
    left join public.studio_holiday_overrides o
      on h.is_official
     and o.official_holiday_id = h.id
     and o.studio_id = v_student.studio_id
     and o.holiday_date = h.holiday_date
    where h.country_code = 'MX'
      and h.holiday_date = target_date

    union all

    select
      null::uuid as holiday_id,
      'manual'::text as holiday_code,
      o.holiday_date,
      o.custom_name as name,
      coalesce(o.theme_key, 'custom') as theme_key,
      false as is_official,
      o.operation_mode,
      o.student_message as message,
      true as configured,
      'Configuración del estudio'::text as source_label,
      null::text as source_url,
      null::text as legal_basis,
      o.hero_image_path,
      o.message_image_path,
      20 as priority
    from public.studio_holiday_overrides o
    where o.studio_id = v_student.studio_id
      and o.holiday_date = target_date
      and o.source_kind = 'manual'
  )
  select jsonb_build_object(
    'holiday_id', c.holiday_id,
    'holiday_code', c.holiday_code,
    'holiday_date', c.holiday_date,
    'name', c.name,
    'theme_key', c.theme_key,
    'is_official', c.is_official,
    'operation_mode', c.operation_mode,
    'message', c.message,
    'configured', c.configured,
    'source_label', c.source_label,
    'source_url', c.source_url,
    'legal_basis', c.legal_basis,
    'hero_image_path', c.hero_image_path,
    'message_image_path', c.message_image_path
  )
    into v_result
  from candidate c
  order by c.priority desc
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.student_holiday_snapshot(date)
from public, anon, service_role;
grant execute on function public.student_holiday_snapshot(date)
to authenticated;

create or replace function public.student_holiday_week_snapshot(
  target_start date,
  target_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_start is null
     or target_end is null
     or target_end < target_start
     or target_end - target_start > 31 then
    raise exception 'date_range_invalid';
  end if;

  select s.*
    into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  with catalog_rows as (
    select
      h.holiday_date,
      h.name,
      coalesce(case when h.is_official then o.theme_key end, h.theme_key) as theme_key,
      case when h.is_official then coalesce(o.operation_mode, 'normal') else 'normal' end as operation_mode,
      case when h.is_official then 'official'::text else 'observance'::text end as source_kind,
      case when h.is_official then 10 else 1 end as priority
    from public.official_holidays h
    left join public.studio_holiday_overrides o
      on h.is_official
     and o.official_holiday_id = h.id
     and o.studio_id = v_student.studio_id
     and o.holiday_date = h.holiday_date
    where h.country_code = 'MX'
      and h.holiday_date between target_start and target_end
  ),
  manual_rows as (
    select
      o.holiday_date,
      o.custom_name as name,
      coalesce(o.theme_key, 'custom') as theme_key,
      o.operation_mode,
      'manual'::text as source_kind,
      20 as priority
    from public.studio_holiday_overrides o
    where o.studio_id = v_student.studio_id
      and o.source_kind = 'manual'
      and o.holiday_date between target_start and target_end
  ),
  ranked as (
    select
      rows.*,
      row_number() over (partition by rows.holiday_date order by rows.priority desc, rows.name) as rn
    from (
      select * from catalog_rows
      union all
      select * from manual_rows
    ) rows
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'holiday_date', r.holiday_date,
        'name', r.name,
        'theme_key', r.theme_key,
        'operation_mode', r.operation_mode,
        'source_kind', r.source_kind
      )
      order by r.holiday_date
    ),
    '[]'::jsonb
  )
    into v_result
  from ranked r
  where r.rn = 1;

  return v_result;
end;
$$;

revoke all on function public.student_holiday_week_snapshot(date,date)
from public, anon, service_role;
grant execute on function public.student_holiday_week_snapshot(date,date)
to authenticated;
