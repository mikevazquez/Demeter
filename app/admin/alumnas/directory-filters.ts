/**
 * P360-V2-07 · Filtros del directorio de Alumnas.
 *
 * El estado de la persona es un selector único; las situaciones que piden atención son un
 * filtro aparte que se combina con él. Los enlaces anteriores (`?status=expiring`, etc.)
 * se traducen al filtro de Atención equivalente.
 */
export const DIRECTORY_STAGES = ["all", "prospect", "trial", "student", "former"] as const;
export type DirectoryStage = (typeof DIRECTORY_STAGES)[number];

export const DIRECTORY_STAGE_LABELS: Record<DirectoryStage, string> = {
  all: "Todas",
  prospect: "Prospectos",
  trial: "Prueba",
  student: "Alumnas",
  former: "Exalumnas",
};

export const DIRECTORY_ATTENTION = ["pending", "expiring", "expired", "no_show"] as const;
export type DirectoryAttention = (typeof DIRECTORY_ATTENTION)[number];

export const DIRECTORY_ATTENTION_LABELS: Record<DirectoryAttention, string> = {
  pending: "Con pendientes",
  expiring: "Por vencer",
  expired: "Vencidas",
  no_show: "No show",
};

const LEGACY_STATUS: Record<
  string,
  { stage: DirectoryStage; attention: DirectoryAttention | null }
> = {
  all: { stage: "all", attention: null },
  prospect: { stage: "prospect", attention: null },
  trial: { stage: "trial", attention: null },
  student: { stage: "student", attention: null },
  active: { stage: "student", attention: null },
  former: { stage: "former", attention: null },
  inactive: { stage: "former", attention: null },
  followup: { stage: "student", attention: "pending" },
  expiring: { stage: "all", attention: "expiring" },
  expired: { stage: "all", attention: "expired" },
  no_show: { stage: "all", attention: "no_show" },
};

export function resolveDirectoryFilters(
  status: string | null | undefined,
  att: string | null | undefined,
): { stage: DirectoryStage; attention: DirectoryAttention | null } {
  const legacy = LEGACY_STATUS[String(status ?? "all")] ?? LEGACY_STATUS.all;
  const attention = (DIRECTORY_ATTENTION as readonly string[]).includes(String(att))
    ? (att as DirectoryAttention)
    : legacy.attention;
  return { stage: legacy.stage, attention };
}

export function directoryHref(
  stage: DirectoryStage,
  attention: DirectoryAttention | null,
  query: string,
) {
  const params = new URLSearchParams();
  if (stage !== "all") params.set("status", stage);
  if (attention) params.set("att", attention);
  if (query) params.set("q", query);
  const suffix = params.toString();
  return suffix ? `/admin/alumnas?${suffix}` : "/admin/alumnas";
}
