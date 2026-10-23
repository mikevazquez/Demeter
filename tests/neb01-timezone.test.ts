import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_TIME_ZONE,
  MEXICO_TIME_ZONES,
  resolveStudioTimeZone,
  studioDateTimeLocalValue,
  studioLocalDateKey,
  studioLocalDateTimeToIso,
} from "../lib/studio-time";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("NEB-01-35 hora del estudio", () => {
  it("usa la zona del estudio y cae a CDMX si falta o no es válida", () => {
    expect(resolveStudioTimeZone("America/Tijuana")).toBe("America/Tijuana");
    expect(resolveStudioTimeZone("")).toBe(DEFAULT_STUDIO_TIME_ZONE);
    expect(resolveStudioTimeZone(null)).toBe(DEFAULT_STUDIO_TIME_ZONE);
    expect(resolveStudioTimeZone("Marte/Olympus")).toBe(DEFAULT_STUDIO_TIME_ZONE);
    for (const zone of MEXICO_TIME_ZONES)
      expect(resolveStudioTimeZone(zone.value)).toBe(zone.value);
  });

  it("'hoy' de noche sigue siendo hoy en México aunque en UTC ya sea mañana", () => {
    const evening = new Date("2026-11-02T01:30:00Z"); // 19:30 CDMX del 1-nov
    expect(evening.toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(studioLocalDateKey("America/Mexico_City", evening)).toBe("2026-11-01");
    expect(studioLocalDateKey("America/Tijuana", evening)).toBe("2026-11-01");
    expect(studioLocalDateKey("America/Cancun", evening)).toBe("2026-11-01");
  });

  it("la hora que escribe el estudio se guarda con su zona", () => {
    expect(studioLocalDateTimeToIso("2026-11-10T18:30", "America/Mexico_City")).toBe(
      "2026-11-11T00:30:00.000Z",
    );
    expect(studioLocalDateTimeToIso("2026-11-10T18:30", "America/Cancun")).toBe(
      "2026-11-10T23:30:00.000Z",
    );
    expect(studioLocalDateTimeToIso("2026-11-10T18:30", "America/Tijuana")).toBe(
      "2026-11-11T02:30:00.000Z",
    );
    // Tijuana en horario de verano (UTC-7).
    expect(studioLocalDateTimeToIso("2026-07-10T18:30", "America/Tijuana")).toBe(
      "2026-07-11T01:30:00.000Z",
    );
    expect(studioLocalDateTimeToIso("2026-11-10T18:30:00Z", "America/Tijuana")).toBe(
      "2026-11-10T18:30:00.000Z",
    );
    expect(studioLocalDateTimeToIso("mañana", "America/Tijuana")).toBeNull();
  });

  it("muestra en el formulario la misma hora que se guardó", () => {
    const iso = studioLocalDateTimeToIso("2026-11-10T18:30", "America/Hermosillo")!;
    expect(studioDateTimeLocalValue(iso, "America/Hermosillo")).toBe("2026-11-10T18:30");
  });

  it("ya no quedan zonas ni desfases fijos de CDMX en la app", () => {
    for (const file of [
      "app/admin/recompensas/actions.ts",
      "app/admin/recompensas/ui.tsx",
      "app/admin/recompensas/RuleEditorForm.tsx",
      "app/admin/hoy/birthdays.ts",
      "app/admin/mas/demi/page.tsx",
      "app/admin/ventas/actions.ts",
      "app/admin/actividades/ActivityWizard.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toContain('"America/Mexico_City"');
      expect(source, file).not.toContain("-06:00");
    }
    for (const file of [
      "app/admin/ventas/actions.ts",
      "app/admin/actividades/ActivityWizard.tsx",
    ]) {
      expect(read(file), file).not.toContain("new Date().toISOString().slice(0, 10)");
    }
  });

  it("la base guarda pagos con la fecha local del estudio", () => {
    const migration = read("supabase/migrations/20261022216000_neb01_studio_local_time.sql");
    expect(migration).toContain(
      "alter table public.payments alter column effective_on drop default;",
    );
    expect(migration).toContain("before insert on public.payments");
    expect(migration).toContain(
      "private.studio_local_today(v_sale.studio_id),(select auth.uid()));",
    );
    expect(migration).not.toMatch(/^\s+current_date,\(select auth\.uid\(\)\)\);/m);
  });
});
