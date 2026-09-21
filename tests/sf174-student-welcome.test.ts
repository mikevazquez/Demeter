import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-174 student welcome integration", () => {
  const provision = source("supabase/functions/provision-student-access/index.ts");
  const shared = source("supabase/functions/_shared/asistian-messaging.ts");
  const actions = source("app/admin/alumnas/[studentId]/actions.ts");

  it("sends student_welcome only after a successful initial access link", () => {
    const linkMarker = provision.indexOf('rpc("service_link_student_access"');
    const sendMarker = provision.indexOf("sendAsistianWebhook({");
    const resetReturnMarker = provision.indexOf('if (mode === "reset")');

    expect(linkMarker).toBeGreaterThan(-1);
    expect(sendMarker).toBeGreaterThan(linkMarker);
    expect(resetReturnMarker).toBeGreaterThan(-1);
    expect(provision).toContain('template: "student_welcome"');
    expect(provision).toContain('source: "student_access_provisioning"');
  });

  it("does not route password resets through student_welcome", () => {
    const resetBlock =
      provision.split('if (mode === "reset")')[1]?.split("if (student.user_id)")[0] ?? "";

    expect(resetBlock).not.toContain("sendAsistianWebhook");
    expect(resetBlock).not.toContain("student_welcome");
  });

  it("keeps the account success response independent from Asistian delivery success", () => {
    expect(provision).toContain("const welcomeDelivery = await sendAsistianWebhook");
    expect(provision).toContain("ok: true");
    expect(provision).toContain("welcomeDelivery: {");
  });

  it("sends the temporary password only inside the Asistian payload variables", () => {
    expect(provision).toContain("temporary_password: temporaryPassword");
    expect(provision).toContain('sensitive_variable_keys: ["temporary_password"]');
    expect(shared).not.toContain("console.log");
    expect(shared).not.toContain("console.error");
  });

  it("reads the webhook from Vault through the service-role-only RPC", () => {
    expect(shared).toContain('"service_get_asistian_webhook"');
    expect(shared).toContain("target_studio_id: input.studioId");
    expect(shared).toContain("target_template: input.template");
  });

  it("builds the student login URL from the active environment host", () => {
    expect(actions).toContain('new URL("/login/student", `https://${host}`).toString()');
    expect(actions).toContain("loginUrl");
  });
});
