import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("admin session minimum and activity save regressions", () => {
  const sessionPage = source("app/admin/agenda/[sessionId]/page.tsx");
  const sessionActions = source("app/admin/agenda/[sessionId]/actions.ts");
  const agendaPage = source("app/admin/agenda/page.tsx");
  const activityActions = source("app/admin/actividades/actions.ts");
  const packageActions = source("app/admin/productos/por-clases/actions.ts");
  const overloadFix = source("supabase/migrations/20261012141153_activities_rpc_overload_fix.sql");

  it("lets admins change minimum cancellation settings for one session", () => {
    expect(sessionPage).toContain('name="minimum_reservations_enabled"');
    expect(sessionPage).toContain('name="minimum_reservations"');
    expect(sessionPage).toContain('name="minimum_review_minutes_before"');
    expect(sessionPage).toContain("no modifica la actividad ni las demás");
    expect(sessionActions).toContain("minimumSettingsProvided");
    expect(sessionActions).toContain("minimum_reservations_enabled: minimumReservationsEnabled");
    expect(sessionActions).toContain("minimumReservations > capacity");
    expect(sessionActions).toContain("minimumReviewMinutesBefore > 10080");
    expect(sessionActions).toContain('formData.has("minimum_settings_present")');
    expect(sessionActions).toContain("item.id === sessionId ? minimumUpdate : {}");
  });

  it("shows and saves minimum settings in the agenda session editor", () => {
    expect(agendaPage).toContain(
      "minimum_reservations_enabled,minimum_reservations,minimum_review_minutes_before",
    );
    expect(agendaPage).toContain('name="minimum_settings_present"');
    expect(agendaPage).toContain('name="minimum_reservations_enabled"');
    expect(agendaPage).toContain('name="minimum_reservations"');
    expect(agendaPage).toContain('name="minimum_review_minutes_before"');
    expect(agendaPage).toContain('"Sin mínimo de personas"');
  });

  it("removes the ambiguous public RPC overload used by the activity wizard", () => {
    expect(activityActions).toContain('.rpc("admin_save_activity"');
    expect(overloadFix).toContain("set schema private");
    expect(overloadFix).toContain("rename to admin_save_activity_core");
    expect(overloadFix).toContain("private.admin_save_activity_core(");
    expect(overloadFix).toContain("grant execute on function public.admin_save_activity(");
  });

  it("explains package name conflicts instead of showing a generic save error", () => {
    expect(packageActions).toContain('productError?.code === "23505"');
    expect(packageActions).toContain("Ya existe un producto con ese nombre en el estudio");
  });
});
