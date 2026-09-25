const HOLIDAY_ASSET_BY_THEME: Record<string, string> = {
  new_year: "/student/holidays/new-year.webp",
  reyes: "/student/holidays/reyes.webp",
  candelaria: "/student/holidays/candelaria.webp",
  constitution: "/student/holidays/constitucion.webp",
  san_valentin: "/student/holidays/san-valentin.webp",
  bandera: "/student/holidays/bandera.webp",
  mujer: "/student/holidays/mujer.webp",
  benito_juarez: "/student/holidays/benito-juarez.webp",
  expropiacion_petrolera: "/student/holidays/expropiacion-petrolera.webp",
  semana_santa: "/student/holidays/semana-santa.webp",
  pascua: "/student/holidays/pascua.webp",
  dia_nino: "/student/holidays/dia-nino.webp",
  labor_day: "/student/holidays/dia-trabajo.webp",
  batalla_puebla: "/student/holidays/batalla-puebla.webp",
  dia_madres: "/student/holidays/dia-madres.webp",
  dia_maestro: "/student/holidays/dia-maestro.webp",
  dia_padre: "/student/holidays/dia-padre.webp",
  ninos_heroes: "/student/holidays/ninos-heroes.webp",
  independence: "/student/holidays/independencia.webp",
  dia_raza: "/student/holidays/bandera.webp",
  halloween: "/student/holidays/halloween.webp",
  dia_muertos: "/student/holidays/dia-muertos.webp",
  revolution: "/student/holidays/revolucion.webp",
  guadalupe: "/student/holidays/candelaria.webp",
  posadas: "/student/holidays/navidad.webp",
  nochebuena: "/student/holidays/navidad.webp",
  christmas: "/student/holidays/navidad.webp",
  fin_ano: "/student/holidays/new-year.webp",
  executive_transfer: "/student/holidays/independencia.webp",
};

export function getHolidayAsset(themeKey: string | null | undefined) {
  return HOLIDAY_ASSET_BY_THEME[themeKey ?? ""] ?? null;
}

export const holidayAssetEntries = Object.entries(HOLIDAY_ASSET_BY_THEME);
