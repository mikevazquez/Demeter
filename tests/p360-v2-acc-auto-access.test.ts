import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  autoAccessMessage,
  classifyAutoAccessResponse,
  isAutoAccessStatus,
} from "@/lib/student/auto-access-copy";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("P360-V2-ACC · clasificación del resultado de provisión", () => {
  it("marca como enviado cuando el WhatsApp de bienvenida fue aceptado", () => {
    expect(
      classifyAutoAccessResponse(
        { ok: true, activationLinkGenerated: true, welcomeDelivery: { status: "accepted" } },
        null,
      ),
    ).toEqual({ status: "sent", errorCode: null });
  });

  it("deja el acceso pendiente cuando la cuenta existe pero el mensaje no salió", () => {
    expect(
      classifyAutoAccessResponse(
        {
          ok: true,
          activationLinkGenerated: true,
          welcomeDelivery: { status: "skipped", errorCode: "notification_process_paused" },
        },
        null,
      ),
    ).toEqual({ status: "pending_delivery", errorCode: "notification_process_paused" });
    const noLink = { ok: true, activationLinkGenerated: false };
    const withoutLink = classifyAutoAccessResponse(noLink, null);
    expect(withoutLink.status).toBe("pending_delivery");
    expect(withoutLink.errorCode).toBe("activation_link_failed");
  });

  it("no duplica el acceso si ya estaba vinculado", () => {
    expect(classifyAutoAccessResponse(null, "student_already_linked")).toEqual({
      status: "already_linked",
      errorCode: null,
    });
  });

  it("reporta fallo sin lanzar error", () => {
    expect(classifyAutoAccessResponse(null, "forbidden")).toEqual({
      status: "failed",
      errorCode: "forbidden",
    });
    expect(classifyAutoAccessResponse(null, null).status).toBe("failed");
  });

  it("solo acepta estados conocidos en la URL y tiene texto para cada uno", () => {
    for (const status of ["sent", "pending_delivery", "already_linked", "failed"] as const) {
      expect(isAutoAccessStatus(status)).toBe(true);
      expect(autoAccessMessage(status).length).toBeGreaterThan(10);
    }
    expect(isAutoAccessStatus("<script>")).toBe(false);
  });
});

describe("P360-V2-ACC · toda alta dispara el acceso automático", () => {
  const entryPoints = [
    ["alta rápida en Alumnas", "app/admin/alumnas/actions.ts", "admin_create_student"],
    ["alta rápida en Hoy", "app/admin/hoy/quick-actions.ts", "admin_create_student"],
    [
      "clase de prueba desde contacto",
      "app/admin/alumnas/contactos/[contactId]/agendar/actions.ts",
      "admin_schedule_prospect_trial",
    ],
    ["walk-in desde admin", "app/admin/actions.ts", "create_walkin_student"],
    ["walk-in desde coach", "app/coach/actions.ts", "create_walkin_student"],
  ] as const;

  for (const [label, path, rpc] of entryPoints) {
    it(`${label} provisiona después de crear`, () => {
      const code = source(path);
      const created = code.indexOf(`"${rpc}"`);
      const provisioned = code.indexOf("autoProvisionStudentAccess(", created);
      expect(created).toBeGreaterThan(-1);
      expect(provisioned).toBeGreaterThan(created);
    });
  }

  it("ya no existe el paso manual de habilitar acceso ni se pide solicitarlo al estudio", () => {
    expect(source("app/admin/alumnas/[studentId]/StudentAccessProvisioner.tsx")).not.toContain(
      "Habilitar acceso al portal",
    );
    expect(source("app/acceso/page.tsx")).not.toContain("solicita al estudio");
  });

  it("la Edge Function permite la provisión inicial a quien da de alta, no el reenvío", () => {
    const fn = source("supabase/functions/provision-student-access/index.ts");
    expect(fn).toContain('"students.write"');
    expect(fn).toContain('"attendance.write"');
    expect(fn).toContain(
      'mode === "provision" && delivery === "provider" ? canProvisionOnCreate : canManageAccess',
    );
  });
});
