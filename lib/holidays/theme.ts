export type HolidayThemeKey =
  | "new_year"
  | "constitution"
  | "benito_juarez"
  | "labor_day"
  | "independence"
  | "revolution"
  | "executive_transfer"
  | "christmas";

export type HolidayTheme = {
  icon: string;
  accent: string;
  secondary: string;
  motif: string;
};

const themes: Record<HolidayThemeKey, HolidayTheme> = {
  new_year: {
    icon: "✦",
    accent: "#ff0a8a",
    secondary: "#8b5cf6",
    motif: "✦  ✧  ✦",
  },
  constitution: {
    icon: "▤",
    accent: "#ff0a8a",
    secondary: "#16a34a",
    motif: "▤  ◆  ▤",
  },
  benito_juarez: {
    icon: "◈",
    accent: "#ff0a8a",
    secondary: "#15803d",
    motif: "◈  ✦  ◈",
  },
  labor_day: {
    icon: "⚒",
    accent: "#ff0a8a",
    secondary: "#16a34a",
    motif: "⚒  ✦  ⚒",
  },
  independence: {
    icon: "✹",
    accent: "#ff0a8a",
    secondary: "#15803d",
    motif: "✹  ✦  ✹",
  },
  revolution: {
    icon: "★",
    accent: "#ff0a8a",
    secondary: "#15803d",
    motif: "★  ✦  ★",
  },
  executive_transfer: {
    icon: "◇",
    accent: "#ff0a8a",
    secondary: "#16a34a",
    motif: "◇  ◆  ◇",
  },
  christmas: {
    icon: "✦",
    accent: "#ff0a8a",
    secondary: "#16a34a",
    motif: "✦  ❄  ✦",
  },
};

export function getHolidayTheme(themeKey: string | null | undefined): HolidayTheme {
  return themes[(themeKey ?? "") as HolidayThemeKey] ?? themes.new_year;
}

export function holidayOperationLabel(mode: string | null | undefined) {
  if (mode === "closed") return "Estudio cerrado";
  if (mode === "special") return "Horario especial";
  return "Horario normal";
}
