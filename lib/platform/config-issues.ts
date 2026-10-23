// NEB-01-18 · Revisión de configuración (migración 20261023162000_neb01_config_issues).

export type ConfigIssueSeverity = "error" | "warning" | "suggestion";

export type ConfigIssue = {
  code: string;
  severity: ConfigIssueSeverity;
  count: number;
  title: string;
  detail: string;
  href: string | null;
};

const ORDER: Record<ConfigIssueSeverity, number> = { error: 0, warning: 1, suggestion: 2 };

export const SEVERITY_LABEL: Record<ConfigIssueSeverity, string> = {
  error: "Por corregir",
  warning: "Revisar",
  suggestion: "Sugerencia",
};

export function parseConfigIssues(raw: unknown): ConfigIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const data = (item ?? {}) as Record<string, unknown>;
      const severity: ConfigIssueSeverity =
        data.severity === "error" || data.severity === "warning" ? data.severity : "suggestion";
      return {
        code: String(data.code ?? ""),
        severity,
        count: Number(data.count) || 0,
        title: String(data.title ?? ""),
        detail: String(data.detail ?? ""),
        href: typeof data.href === "string" && data.href.startsWith("/admin/") ? data.href : null,
      };
    })
    .filter((issue) => issue.code && issue.count > 0)
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.count - a.count);
}

/** Texto corto para el renglón de Más: «2 por corregir · 1 por revisar». */
export function configIssuesSummary(issues: ConfigIssue[]): string | null {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const parts = [
    errors ? `${errors} por corregir` : null,
    warnings ? `${warnings} por revisar` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export type ConfigIssueCounts = Record<string, { errors: number; warnings: number }>;

export function parseConfigIssueCounts(raw: unknown): ConfigIssueCounts {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: ConfigIssueCounts = {};
  for (const [studioId, value] of Object.entries(raw as Record<string, unknown>)) {
    const data = (value ?? {}) as Record<string, unknown>;
    result[studioId] = { errors: Number(data.errors) || 0, warnings: Number(data.warnings) || 0 };
  }
  return result;
}
