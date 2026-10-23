/**
 * P360-V2-01 · Pestañas del Perfil 360.
 *
 * Un solo nivel de navegación con cinco pestañas. Los enlaces históricos con `?view=` siguen
 * funcionando: cada vista anterior se traduce a la pestaña donde ahora vive su contenido.
 */
export const PROFILE_TABS = ["summary", "packages", "progress", "activity", "record"] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number];

export const PROFILE_TAB_LABELS: Record<ProfileTab, string> = {
  summary: "Resumen",
  packages: "Paquetes y pagos",
  progress: "Progreso",
  activity: "Actividad",
  record: "Expediente",
};

const LEGACY_VIEW_TABS: Record<string, ProfileTab> = {
  summary: "summary",
  followup: "summary",
  packages: "packages",
  rewards: "progress",
  evaluations: "progress",
  progress: "progress",
  conversation: "activity",
  history: "activity",
  activity: "activity",
  documents: "record",
  profile: "record",
  record: "record",
};

export function resolveProfileTab(view: string | null | undefined): ProfileTab {
  return LEGACY_VIEW_TABS[String(view ?? "")] ?? "summary";
}

export const ACTIVITY_FILTERS = ["all", "messages", "classes", "payments", "status"] as const;

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  all: "Todo",
  messages: "Mensajes",
  classes: "Clases",
  payments: "Pagos",
  status: "Estado",
};

export function resolveActivityFilter(
  value: string | null | undefined,
  view: string | null | undefined,
): ActivityFilter {
  if (view === "conversation") return "messages";
  return (ACTIVITY_FILTERS as readonly string[]).includes(String(value))
    ? (value as ActivityFilter)
    : "all";
}

export function profileTabHref(studentId: string, tab: ProfileTab, extra = "") {
  return `/admin/alumnas/${studentId}?view=${tab}${extra}`;
}
