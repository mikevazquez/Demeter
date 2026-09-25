import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 clean avatar, activity colors and single-class purchase", () => {
  const home = source("app/student/page.tsx");
  const layout = source("app/student/layout.tsx");
  const profile = source("app/student/perfil/page.tsx");
  const studentActions = source("app/student/actions.ts");
  const avatarRoute = source("app/student/perfil/avatar/route.ts");
  const agenda = source("app/admin/agenda/page.tsx");
  const activityWizard = source("app/admin/actividades/ActivityWizard.tsx");
  const activityActions = source("app/admin/actividades/actions.ts");
  const atomicActivitySave = source(
    "supabase/migrations/20260922155500_actividades01_atomic_save.sql",
  );
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const colorMigration = source(
    "supabase/migrations/20260920054000_n14_profile_avatar_activity_colors.sql",
  );
  const avatarInsertMigration = source(
    "supabase/migrations/20260920064000_n14_profile_avatar_insert_policy.sql",
  );
  const singleMigration = source(
    "supabase/migrations/20260920061000_n14_single_class_checkout.sql",
  );
  const checkoutEdge = source("supabase/functions/create-mercadopago-order/index.ts");

  it("keeps Perfil independent from avatar reads and uploads during page render", () => {
    expect(profile).not.toContain("ProfileAvatarUploader");
    expect(profile).not.toContain("createSignedUrl");
    expect(profile).not.toContain('select("avatar_url")');
    expect(profile).toContain("updateStudentAvatarAction");
    expect(profile).toContain('src="/student/perfil/avatar"');
    expect(studentActions).toContain("updateStudentAvatarAction");
    expect(studentActions).toContain('.from("profile-avatars")');
    expect(studentActions).toContain(".upsert(");
    expect(avatarRoute).toContain("createSignedUrl");
    expect(avatarRoute).toContain("transparentAvatar");
  });

  it("stores avatars privately and lets a student create their own profile row", () => {
    expect(colorMigration).toContain("'profile-avatars'");
    expect(colorMigration).toContain("5242880");
    expect(colorMigration).toContain("image/jpeg");
    expect(colorMigration).toContain("image/png");
    expect(colorMigration).toContain("image/webp");
    expect(colorMigration).toContain("(storage.foldername(name))[1]");
    expect(colorMigration).toContain("(select auth.uid())::text");
    expect(avatarInsertMigration).toContain('create policy "profiles_insert_self"');
    expect(avatarInsertMigration).toContain("(select auth.uid()) = id");
  });

  it("persists a configurable color per activity and shows it only on schedule surfaces", () => {
    expect(colorMigration).toContain("add column if not exists color_hex");
    expect(activityWizard).toContain('type="color"');
    expect(activityWizard).toContain("Color en el horario");
    expect(activityActions).toContain("p_color_hex: colorHex");
    expect(atomicActivitySave).toContain("color_hex = upper(p_color_hex)");
    expect(agenda).toContain('"--agenda-session-color": session.color');
    expect(reserve).toContain("style={{ color: activityColor }}");
    expect(reserve).toContain("${activityColor}66");
    expect(detail).toContain("activityColor");
    expect(detail).toContain("${activityColor}77");
    expect(detail).toContain("linear-gradient(145deg");
  });

  it("seeds the requested reference colors", () => {
    expect(colorMigration).toContain("when 'twerk' then '#AE51BB'");
    expect(colorMigration).toContain("when 'pole fitness' then '#0877B9'");
    expect(colorMigration).toContain("when 'exotic pole' then '#D52473'");
    expect(colorMigration).toContain("when 'heels' then '#D1A340'");
    expect(colorMigration).toContain("when 'yoga' then '#AD9ACD'");
    expect(colorMigration).toContain("when 'espiral' then '#B2CC0B'");
    expect(colorMigration).toContain("when 'danza aérea' then '#07C0B3'");
  });

  it("offers Danza Aérea outside the package as a $150 single-class purchase from detail", () => {
    expect(singleMigration).toContain("set drop_in_price_minor = 15000");
    expect(singleMigration).toContain("'Clase suelta · Danza Aérea'");
    expect(singleMigration).toContain("'single_class'::public.product_type");
    expect(reserve).not.toContain("PurchaseSingleClassButton");
    expect(detail).toContain("PurchaseSingleClassButton");
    expect(detail).toContain("Ver paquetes");
  });

  it("keeps single-class checkout server-priced and routed through Mercado Pago", () => {
    expect(singleMigration).toContain("student_create_single_class_checkout_attempt");
    expect(checkoutEdge).toContain("student_create_single_class_checkout_attempt");
    expect(checkoutEdge).toContain('"/student/reservar/checkout"');
    expect(checkoutEdge).toContain("moneyFromMinor(attemptRow.amount_minor)");
  });

  it("shows the profile photo in the global student shell without coupling Home to avatar writes", () => {
    expect(layout).toContain('src="/student/perfil/avatar"');
    expect(layout).toContain('aria-label="Abrir mi perfil"');
    expect(home).not.toContain("updateStudentAvatarAction");
  });

  it("does not touch the global stylesheet for these changes", () => {
    expect(source("app/globals.css")).not.toContain("activity-color-list");
  });
});
