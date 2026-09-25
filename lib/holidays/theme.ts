export type HolidayTheme = {
  icon: string;
  accent: string;
  secondary: string;
  motif: string;
};

const themes: Record<string, HolidayTheme> = {
  new_year: { icon: "✦", accent: "#ff0a8a", secondary: "#8b5cf6", motif: "✦  ✧  ✦" },
  reyes: { icon: "✶", accent: "#ff0a8a", secondary: "#f59e0b", motif: "✶  ✦  ✶" },
  candelaria: { icon: "✦", accent: "#ff0a8a", secondary: "#f59e0b", motif: "✦  ◇  ✦" },
  constitution: { icon: "▤", accent: "#ff0a8a", secondary: "#16a34a", motif: "▤  ◆  ▤" },
  san_valentin: { icon: "♥", accent: "#ff0a8a", secondary: "#fb7185", motif: "♥  ✦  ♥" },
  bandera: { icon: "◆", accent: "#ff0a8a", secondary: "#16a34a", motif: "◆  ✦  ◆" },
  mujer: { icon: "✿", accent: "#ff0a8a", secondary: "#a855f7", motif: "✿  ✦  ✿" },
  benito_juarez: { icon: "◈", accent: "#ff0a8a", secondary: "#15803d", motif: "◈  ✦  ◈" },
  expropiacion_petrolera: { icon: "◆", accent: "#ff0a8a", secondary: "#f59e0b", motif: "◆  ✦  ◆" },
  semana_santa: { icon: "✦", accent: "#ff0a8a", secondary: "#7c3aed", motif: "✦  ✧  ✦" },
  pascua: { icon: "✿", accent: "#ff0a8a", secondary: "#f59e0b", motif: "✿  ✦  ✿" },
  dia_nino: { icon: "★", accent: "#ff0a8a", secondary: "#22d3ee", motif: "★  ✦  ★" },
  labor_day: { icon: "⚒", accent: "#ff0a8a", secondary: "#16a34a", motif: "⚒  ✦  ⚒" },
  batalla_puebla: { icon: "★", accent: "#ff0a8a", secondary: "#16a34a", motif: "★  ✦  ★" },
  dia_madres: { icon: "✿", accent: "#ff0a8a", secondary: "#fb7185", motif: "✿  ♥  ✿" },
  dia_maestro: { icon: "▤", accent: "#ff0a8a", secondary: "#8b5cf6", motif: "▤  ✦  ▤" },
  dia_padre: { icon: "◆", accent: "#ff0a8a", secondary: "#3b82f6", motif: "◆  ✦  ◆" },
  ninos_heroes: { icon: "★", accent: "#ff0a8a", secondary: "#16a34a", motif: "★  ✦  ★" },
  independence: { icon: "✹", accent: "#ff0a8a", secondary: "#15803d", motif: "✹  ✦  ✹" },
  dia_raza: { icon: "◈", accent: "#ff0a8a", secondary: "#16a34a", motif: "◈  ✦  ◈" },
  halloween: { icon: "✦", accent: "#ff0a8a", secondary: "#f97316", motif: "✦  ◇  ✦" },
  dia_muertos: { icon: "✿", accent: "#ff0a8a", secondary: "#f97316", motif: "✿  ✦  ✿" },
  revolution: { icon: "★", accent: "#ff0a8a", secondary: "#15803d", motif: "★  ✦  ★" },
  guadalupe: { icon: "✦", accent: "#ff0a8a", secondary: "#f59e0b", motif: "✦  ◇  ✦" },
  posadas: { icon: "✶", accent: "#ff0a8a", secondary: "#f59e0b", motif: "✶  ✦  ✶" },
  nochebuena: { icon: "✦", accent: "#ff0a8a", secondary: "#16a34a", motif: "✦  ❄  ✦" },
  christmas: { icon: "✦", accent: "#ff0a8a", secondary: "#16a34a", motif: "✦  ❄  ✦" },
  fin_ano: { icon: "✦", accent: "#ff0a8a", secondary: "#8b5cf6", motif: "✦  ✧  ✦" },
  executive_transfer: { icon: "◇", accent: "#ff0a8a", secondary: "#16a34a", motif: "◇  ◆  ◇" },
  custom: { icon: "✦", accent: "#ff0a8a", secondary: "#8b5cf6", motif: "✦  ✧  ✦" },
};

export function getHolidayTheme(themeKey: string | null | undefined): HolidayTheme {
  return themes[themeKey ?? ""] ?? themes.new_year;
}

export function holidayOperationLabel(mode: string | null | undefined) {
  if (mode === "closed") return "Estudio cerrado";
  if (mode === "special") return "Horario especial";
  return "Horario normal";
}
