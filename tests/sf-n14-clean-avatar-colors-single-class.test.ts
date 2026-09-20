import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 clean avatar, activity colors and single-class purchase", () => {
  const profile = source("app/student/perfil/page.tsx");
  const avatar = source("app/student/perfil/ProfileAvatarUploader.tsx");
  const agenda = source("app/admin/agenda/page.tsx");
  const agendaActions = source("app/admin/agenda/recurring-actions.ts");
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const colorMigration = source(
    "supabase/migrations/20260920054000_n14_profile_avatar_activity_colors.sql",
  );
  const singleMigration = source(
    "supabase/migrations/20260920061000_n14_single_class_checkout.sql",
  );
  const checkoutEdge = source("supabase/functions/create-mercadopago-order/index.ts");

  it("keeps the approved profile server render independent from avatar storage", () => {
    expect(profile).toContain("ProfileAvatarUploader");
    expect(profile).not.toContain("createSignedUrl");
    expect(profile).not.toContain('select("avatar_url")');
    expect(avatar).toContain("createSignedUrl");
    expect(avatar).toContain(".upload(avatarPath, file");
    expect(avatar).toContain("Perfil debe seguir funcionando aunque Storage falle");
  });

  it("stores avatars privately and restricts each user to their own folder", () => {
    expect(colorMigration).toContain("'profile-avatars'");
    expect(colorMigration).toContain("5242880");
    expect(colorMigration).toContain("image/jpeg");
    expect(colorMigration).toContain("image/png");
    expect(colorMigration).toContain("image/webp");
    expect(colorMigration).toContain("(storage.foldername(name))[1]");
    expect(colorMigration).toContain("(select auth.uid())::text");
  });

  it("persists a configurable color per activity and shows it only on schedule surfaces", () => {
    expect(colorMigration).toContain("add column if not exists color_hex");
    expect(agendaActions).toContain("updateActivityColor");
    expect(agendaActions).toContain(".update({ color_hex: colorHex })");
    expect(agenda).toContain('type="color"');
    expect(agenda).toContain("borderLeftColor: template?.color_hex");
    expect(reserve).toContain("borderLeftColor: activityColor");
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

  it("offers Danza Aérea outside the package as a $150 single-class purchase", () => {
    expect(singleMigration).toContain("set drop_in_price_minor = 15000");
    expect(singleMigration).toContain("'Clase suelta · Danza Aérea'");
    expect(singleMigration).toContain("'single_class'::public.product_type");
    expect(reserve).toContain("Esta clase no está incluida en tu paquete");
    expect(reserve).toContain("PurchaseSingleClassButton");
    expect(reserve).toContain("Ver paquetes");
    expect(detail).toContain("PurchaseSingleClassButton");
  });

  it("keeps single-class checkout server-priced and routed through Mercado Pago", () => {
    expect(singleMigration).toContain("student_create_single_class_checkout_attempt");
    expect(checkoutEdge).toContain("student_create_single_class_checkout_attempt");
    expect(checkoutEdge).toContain('"/student/reservar/checkout"');
    expect(checkoutEdge).toContain("moneyFromMinor(attemptRow.amount_minor)");
  });

  it("does not touch the global stylesheet or student home layout for these changes", () => {
    expect(source("app/globals.css")).not.toContain("activity-color-list");
    expect(source("app/student/page.tsx")).not.toContain("ProfileAvatarUploader");
  });
});
