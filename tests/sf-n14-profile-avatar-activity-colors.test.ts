import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14-H01 profile avatar and activity colors", () => {
  const migration = source(
    "supabase/migrations/20260920054000_n14_profile_avatar_activity_colors.sql",
  );
  const singleClassMigration = source(
    "supabase/migrations/20260920061000_n14_single_class_checkout.sql",
  );
  const profile = source("app/student/perfil/page.tsx");
  const avatar = source("app/student/perfil/ProfileAvatarUploader.tsx");
  const agenda = source("app/admin/agenda/page.tsx");
  const agendaActions = source("app/admin/agenda/recurring-actions.ts");
  const studentSchedule = source("app/student/reservar/page.tsx");
  const singleClassButton = source("app/student/reservar/PurchaseSingleClassButton.tsx");
  const singleClassReturn = source("app/student/reservar/checkout/page.tsx");
  const studentActions = source("app/student/actions.ts");
  const checkoutEdge = source("supabase/functions/create-mercadopago-order/index.ts");

  it("creates a private avatar bucket with size, mime and owner-folder policies", () => {
    expect(migration).toContain("'profile-avatars'");
    expect(migration).toContain("false,");
    expect(migration).toContain("5242880");
    expect(migration).toContain("image/jpeg");
    expect(migration).toContain("image/png");
    expect(migration).toContain("image/webp");
    expect(migration).toContain("profile_avatars_select_own");
    expect(migration).toContain("profile_avatars_insert_own");
    expect(migration).toContain("profile_avatars_update_own");
    expect(migration).toContain("(storage.foldername(name))[1]");
    expect(migration).toContain("(select auth.uid())::text");
  });

  it("keeps Perfil available if avatar storage fails and lets the student upload a photo", () => {
    expect(profile).toContain("ProfileAvatarUploader");
    expect(profile).not.toContain("createSignedUrl");
    expect(profile).not.toContain('select("avatar_url")');
    expect(avatar).toContain("useEffect");
    expect(avatar).toContain('from("profile-avatars")');
    expect(avatar).toContain("createSignedUrl");
    expect(avatar).toContain(".upload(avatarPath, file");
    expect(avatar).toContain('from("profiles")');
    expect(avatar).toContain("avatar_url: avatarPath");
    expect(avatar).toContain("Avatar is optional");
    expect(avatar).toContain("5 * 1024 * 1024");
    expect(avatar).toContain('"image/jpeg"');
    expect(avatar).toContain('"image/png"');
    expect(avatar).toContain('"image/webp"');
  });

  it("persists a validated color per activity and exposes it in admin", () => {
    expect(migration).toContain("add column if not exists color_hex");
    expect(migration).toContain("^#[0-9A-Fa-f]{6}$");
    expect(agenda).toContain("drop_in_price_minor,color_hex");
    expect(agenda).toContain('type="color"');
    expect(agenda).toContain("updateActivityColor");
    expect(agendaActions).toContain("normalizeColorHex");
    expect(agendaActions).toContain(".update({ color_hex: colorHex })");
    expect(agendaActions).toContain('.eq("studio_id", studio.id)');
  });

  it("seeds the requested visual reference colors", () => {
    expect(migration).toContain("when 'twerk' then '#AE51BB'");
    expect(migration).toContain("when 'pole fitness' then '#0877B9'");
    expect(migration).toContain("when 'exotic pole' then '#D52473'");
    expect(migration).toContain("when 'heels' then '#D1A340'");
    expect(migration).toContain("when 'yoga' then '#AD9ACD'");
    expect(migration).toContain("when 'espiral' then '#B2CC0B'");
    expect(migration).toContain("when 'danza aérea' then '#07C0B3'");
  });

  it("reflects the configured activity color in admin and student schedules", () => {
    expect(agenda).toContain("borderLeftColor: template?.color_hex");
    expect(agenda).toContain("templateMap.get(schedule.template_id)?.color_hex");
    expect(studentSchedule).toContain("drop_in_price_minor");
    expect(studentSchedule).toContain("activityStyleMap");
    expect(studentSchedule).toContain("borderLeftColor: activityColor");
    expect(studentSchedule).toContain("style={{ color: activityColor }}");
  });

  it("offers Danza Aérea as a real $150 single-class purchase when outside the package", () => {
    expect(singleClassMigration).toContain("set drop_in_price_minor = 15000");
    expect(singleClassMigration).toContain("'single_class'::public.product_type");
    expect(singleClassMigration).toContain("'Clase suelta · Danza Aérea'");
    expect(singleClassMigration).toContain("15000");
    expect(singleClassMigration).toContain("student_create_single_class_checkout_attempt");
    expect(studentSchedule).toContain("Esta clase no está incluida en tu paquete");
    expect(studentSchedule).toContain("PurchaseSingleClassButton");
    expect(studentSchedule).toContain("Ver paquetes");
    expect(singleClassButton).toContain("createSingleClassMercadoPagoOrderAction");
    expect(studentActions).toContain("createSingleClassMercadoPagoOrderAction");
  });

  it("routes single-class Mercado Pago orders back to the class flow", () => {
    expect(checkoutEdge).toContain("student_create_single_class_checkout_attempt");
    expect(checkoutEdge).toContain('"single_class"');
    expect(checkoutEdge).toContain('"/student/reservar/checkout"');
    expect(singleClassReturn).toContain("Tu clase suelta ya está disponible");
    expect(singleClassReturn).toContain("Reservar mi lugar");
    expect(singleClassReturn).toContain("reconcile-mercadopago-order");
  });
});
