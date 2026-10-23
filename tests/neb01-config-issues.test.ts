import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  configIssuesSummary,
  parseConfigIssueCounts,
  parseConfigIssues,
} from "@/lib/platform/config-issues";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261023162000_neb01_config_issues.sql");

describe("NEB-01-18 revisión de configuración", () => {
  it("ordena por gravedad y descarta vínculos fuera del admin", () => {
    const issues = parseConfigIssues([
      {
        code: "b",
        severity: "suggestion",
        count: 3,
        title: "B",
        detail: "",
        href: "/admin/alumnas",
      },
      { code: "a", severity: "error", count: 1, title: "A", detail: "", href: "https://malo.mx" },
      { code: "c", severity: "warning", count: 0, title: "C", detail: "", href: null },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(["a", "b"]);
    expect(issues[0].href).toBeNull();
    expect(parseConfigIssues(null)).toEqual([]);
  });

  it("resume para el renglón de Más", () => {
    expect(
      configIssuesSummary(
        parseConfigIssues([
          { code: "a", severity: "error", count: 1 },
          { code: "b", severity: "error", count: 2 },
          { code: "c", severity: "warning", count: 1 },
        ]),
      ),
    ).toBe("2 por corregir · 1 por revisar");
    expect(configIssuesSummary([])).toBeNull();
  });

  it("lee los conteos de la consola", () => {
    expect(parseConfigIssueCounts({ s1: { errors: 2, warnings: 1 } })).toEqual({
      s1: { errors: 2, warnings: 1 },
    });
    expect(parseConfigIssueCounts([])).toEqual({});
  });

  it("las lecturas exigen permiso de ajustes o plataforma y no se abren a anon", () => {
    expect(migration).toContain("private.has_capability(p_studio, 'settings.write')");
    expect(migration).toContain("perform private.platform_require_admin();");
    expect(migration).toContain(
      "revoke all on function public.studio_config_issues(uuid) from public, anon;",
    );
    expect(migration).toContain(
      "revoke all on function private.studio_config_issues(uuid) from public, anon, authenticated;",
    );
    for (const code of [
      "product_price_missing",
      "package_credits_missing",
      "package_validity_missing",
      "session_coach_missing",
      "session_capacity_zero",
      "activity_drop_in_missing",
      "operating_policy_missing",
      "payment_methods_missing",
      "student_birth_date_missing",
    ]) {
      expect(migration).toContain(`'${code}'`);
    }
  });
});
