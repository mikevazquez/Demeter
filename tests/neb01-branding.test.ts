import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("NEB-01-05 sin «Demeter» fijo dentro del estudio", () => {
  it("las pantallas del estudio usan la marca configurada", () => {
    for (const path of [
      "app/student/layout.tsx",
      "app/student/page.tsx",
      "app/student/notificaciones/page.tsx",
      "app/student/perfil/notificaciones/page.tsx",
      "app/student/recompensas/page.tsx",
      "app/student/recompensas/medallero/page.tsx",
      "app/admin/recompensas/medallas/page.tsx",
      "app/api/integrations/meta-whatsapp/webhook/route.ts",
    ]) {
      expect(read(path), path).toContain("loadStudioBrandName");
    }
  });

  it("ya no queda «Demeter» escrito en esas superficies", () => {
    for (const path of [
      "app/student/layout.tsx",
      "app/student/page.tsx",
      "app/student/notificaciones/page.tsx",
      "app/student/components/NotificationChannelPreferences.tsx",
      "app/student/components/PushNotificationSettings.tsx",
      "app/student/recompensas/medallero/page.tsx",
      "app/admin/recompensas/medallas/page.tsx",
      "app/admin/recompensas/programas/nuevo/page.tsx",
      "app/admin/alumnas/[studentId]/alta/StudentOnboardingForm.tsx",
      "app/admin/integraciones/demi/DemiWorkbench.tsx",
      "app/admin/mas/demi/DemiLayers.tsx",
      "lib/student/rewards.ts",
    ]) {
      expect(read(path), path).not.toMatch(/\bDemeter\b/);
    }
    expect(read("app/api/integrations/meta-whatsapp/webhook/route.ts")).not.toContain(
      "Gracias por escribir a Demeter",
    );
  });

  it("Demeter conserva su marca corta y la app tolera que falte la columna", () => {
    expect(read("supabase/migrations/20261023154000_neb01_studio_brand_name.sql")).toContain(
      "set brand_name = 'Demeter'",
    );
    expect(read("lib/platform/branding.ts")).toContain("return brand || fallback;");
  });
});
