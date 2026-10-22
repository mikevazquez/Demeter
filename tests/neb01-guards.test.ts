import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const guards = read("supabase/migrations/20261022212000_neb01_entitlement_guards.sql");

describe("NEB-01-03 bloqueo de lo no contratado", () => {
  it("la base bloquea vender y reservar en solo lectura", () => {
    expect(guards).toContain("before insert on public.sales");
    expect(guards).toContain("before insert on public.reservations");
    expect(guards).toContain("raise exception 'studio_read_only'");
  });

  it("la base bloquea los módulos en sus puntos de entrada", () => {
    for (const [table, moduleKey] of [
      ["reward_programs", "recompensas"],
      ["reward_challenge_enrollments", "recompensas"],
      ["evaluation_templates", "catalogo"],
      ["technical_evaluations", "catalogo"],
      ["evaluation_invitations", "catalogo"],
      ["resources", "recursos"],
      ["space_maps", "recursos"],
      ["reservation_resource_assignments", "recursos"],
    ]) {
      expect(guards).toContain(
        `before insert on public.${table}\n  for each row execute function private.neb_guard_module('${moduleKey}')`,
      );
    }
  });

  it("las secciones del admin y del portal tienen guardia de módulo", () => {
    for (const [path, moduleKey] of [
      ["app/admin/recompensas/layout.tsx", "recompensas"],
      ["app/admin/retos/layout.tsx", "recompensas"],
      ["app/admin/evaluaciones/layout.tsx", "catalogo"],
      ["app/admin/integraciones/demi/layout.tsx", "demi"],
      ["app/admin/mas/demi/layout.tsx", "demi"],
      ["app/admin/configuracion/recursos/layout.tsx", "recursos"],
      ["app/student/recompensas/layout.tsx", "recompensas"],
      ["app/student/retos/layout.tsx", "recompensas"],
      ["app/student/evaluaciones/layout.tsx", "catalogo"],
    ]) {
      expect(read(path)).toContain(`module="${moduleKey}"`);
    }
  });

  it("Demi no procesa mensajes de un estudio sin el módulo", () => {
    const webhook = read("app/api/integrations/meta-whatsapp/webhook/route.ts");
    expect(webhook).toContain("loadStudioEntitlementsService(supabase, studioId)");
    expect(webhook).toContain('skipped: "module_not_contracted"');
  });

  it("sin datos de Nébora no se bloquea nada", () => {
    const lib = read("lib/platform/entitlements.ts");
    expect(lib).toContain("if (!entitlements) return true;");
  });
});
