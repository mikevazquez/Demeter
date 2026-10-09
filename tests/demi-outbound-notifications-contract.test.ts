import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi outbound WhatsApp notifications", () => {
  const metaTemplate = source("supabase/functions/_shared/meta-whatsapp-template.ts");
  const variables = source("supabase/functions/_shared/notification-asistian-variables.ts");
  const migration = source(
    "supabase/migrations/20261003173100_meta_whatsapp_demi_operational_templates.sql",
  );
  const processPage = source("app/admin/notificaciones/[processKey]/page.tsx");
  const notificationsPage = source("app/admin/notificaciones/page.tsx");
  const marketingCatalog = source("lib/notifications/admin-catalog.ts");
  const marketingPage = source("app/admin/notificaciones/marketing/[marketingKey]/page.tsx");
  const marketingTemplateMigration = source(
    "supabase/migrations/20261007130000_notification_template_event_coverage.sql",
  );
  const deliveryWorker = source("supabase/functions/notification-delivery-worker/index.ts");
  const packageRecoveryMigration = source(
    "supabase/migrations/20261007212357_package_recovery_notification_runtime.sql",
  );
  const notificationEngine = source("supabase/functions/notification-engine-worker/index.ts");

  it("supports Meta templates for class cancellation and schedule changes", () => {
    expect(metaTemplate).toContain('"class_cancelled_student"');
    expect(metaTemplate).toContain('"class_rescheduled"');
    expect(metaTemplate).toContain('class_cancelled_student: ["nombre", "clase", "fecha", "hora"]');
    expect(metaTemplate).toContain('"fecha_anterior"');
    expect(metaTemplate).toContain('"fecha_nueva"');
  });

  it("maps old and new session times for the reschedule template", () => {
    expect(variables).toContain('case "class_rescheduled"');
    expect(variables).toContain("variables.old_starts_at");
    expect(variables).toContain("variables.session_starts_at ?? variables.new_starts_at");
    expect(variables).toContain("fecha_anterior");
    expect(variables).toContain("hora_nueva");
  });

  it("allows the two new template keys in encrypted Meta configuration", () => {
    expect(migration).toContain("'class_cancelled_student'");
    expect(migration).toContain("'class_rescheduled'");
    expect(migration).toContain("admin_update_meta_whatsapp_templates");
  });

  it("does not present WhatsApp as Assistian-specific in Studio Flow UI", () => {
    expect(processPage).not.toContain("Plantilla administrada en Assistian");
    expect(notificationsPage).not.toContain("Mensajes mediante Assistian");
    expect(notificationsPage).toContain("proveedor conectado");
  });

  it("maps the five approved marketing templates to their internal delivery keys", () => {
    for (const [key, name] of [
      ["challenge_invitation", "demeter_reto_invitation"],
      ["workshop_event", "demeter_evento_taller"],
      ["referral_invitation", "demeter_referidos"],
      ["package_recovery_1", "demeter_recuperacion_paquete_1"],
      ["package_recovery_2", "demeter_recuperacion_paquete_2"],
    ]) {
      expect(metaTemplate).toContain(`"${key}"`);
      expect(marketingCatalog).toContain(`whatsappTemplateKey: "${key}"`);
      expect(marketingCatalog).toContain(`whatsappTemplateName: "${name}"`);
      expect(marketingTemplateMigration).toContain(`'${key}'`);
      expect(variables).toContain(`case "${key}"`);
      expect(deliveryWorker).toContain(`case "${key}"`);
    }
    expect(marketingPage).toContain("item.whatsappTemplateName");
    expect(metaTemplate).toContain('challenge_invitation: ["nombre", "reto"]');
    expect(metaTemplate).toContain('workshop_event: ["nombre", "evento", "fecha"]');
    expect(metaTemplate).toContain(
      'package_recovery_1: ["nombre", "paquete", "fecha_vencimiento"]',
    );
  });

  it("connects package recovery to independent central rules that stay disabled until activated", () => {
    expect(marketingCatalog).toContain('key: "package-recovery-1"');
    expect(marketingCatalog).toContain('key: "package-recovery-2"');
    expect(marketingCatalog).toContain('eventDrivenRuleKeys: ["marketing.package_recovery_1"]');
    expect(marketingCatalog).toContain('eventDrivenRuleKeys: ["marketing.package_recovery_2"]');
    expect(packageRecoveryMigration).toContain("'package.expired_due', false, 1");
    expect(packageRecoveryMigration).toContain("'payload_student'");
    expect(notificationEngine).toContain('case "payload_student"');
    expect(notificationEngine).toContain('rule.timing_strategy_key === "after_event"');
    expect(deliveryWorker).toContain("packageRecoveryStillEligible");
    expect(deliveryWorker).toContain('"package_renewed_before_recovery"');
    expect(marketingPage).toContain("const packageRecoveryFirstDelay");
    expect(marketingPage).toContain("packageRecoveryFirstDelay * 2");
  });

  it("keeps student-facing push copy warm and uses emojis in the message body", () => {
    expect(deliveryWorker).toContain("Alista todo, te esperamos con gusto 💚");
    expect(deliveryWorker).toContain("¡Nos encantará verte! 💚");
    expect(deliveryWorker).toContain("aquí estamos para ayudarte 💚");
    expect(deliveryWorker).not.toContain("la reserva quedó registrada como no show");
    expect(deliveryWorker).toContain("💚 Tenemos una actualización para ti");
  });
});
