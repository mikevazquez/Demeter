import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Equipo WhatsApp templates — Meta UAT contracts", () => {
  const template = source("supabase/functions/_shared/meta-whatsapp-template.ts");
  const variables = source("supabase/functions/_shared/notification-asistian-variables.ts");
  const engine = source("supabase/functions/notification-engine-worker/index.ts");
  const delivery = source("supabase/functions/notification-delivery-worker/index.ts");
  const cron = source("supabase/migrations/20261008101500_team_coach_roster_due.sql");

  it("maps six roster parameters in the approved Meta template order", () => {
    expect(template).toContain(
      'coach_roster_reminder: ["coach", "clase", "fecha", "hora", "total", "alumnas"]',
    );
    expect(variables).toContain('case "coach_roster_reminder":');
    expect(variables).toContain("total: safeNumber(variables.roster_count) ?? 0");
    expect(variables).toContain(
      'alumnas: safeText(variables.roster_names) ?? "Sin alumnas reservadas"',
    );
  });

  it("maps six minimum-cancellation parameters, with actual and required reservations", () => {
    expect(template).toMatch(
      /class_cancelled_coach:\s*\[\s*"coach",\s*"clase",\s*"fecha",\s*"hora",\s*"minimo_reservas",\s*"reservas_al_revisar"/,
    );
    expect(variables).toContain('case "class_cancelled_coach":');
    expect(variables).toContain("minimo_reservas: safeNumber(variables.minimum_required)");
    expect(variables).toContain(
      "reservas_al_revisar: safeNumber(variables.reservations_at_review)",
    );
  });

  it("uses reserved bookings and the coach phone, not the student phone", () => {
    expect(engine).toContain('event.event_type === "team.coach_roster_due"');
    expect(engine).toContain('.eq("status", "reserved")');
    expect(engine).toContain("payload.roster_count = studentIds.length");
    expect(engine).toContain('contact.kind === "phone" && contact.phone_role === "coach"');
    expect(delivery).toContain('case "coach_roster_reminder"');
    expect(delivery).toContain('case "class_cancelled_coach"');
  });

  it("keeps the roster disabled until UAT and deduplicates events per session", () => {
    expect(cron).toContain("enabled=false");
    expect(cron).toContain("'notification:team.coach_roster_due:'||rec.id::text");
    expect(cron).toContain("*/5 * * * *");
  });
});
