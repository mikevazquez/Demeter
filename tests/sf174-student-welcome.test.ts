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
    const sendMarker = provision.lastIndexOf("sendAsistianWebhook({");

    expect(linkMarker).toBeGreaterThan(-1);
    expect(sendMarker).toBeGreaterThan(linkMarker);
    expect(provision).toContain('template: "student_welcome"');
    expect(provision).toContain('source: "student_access_provisioning"');
  });

  it("uses activation links instead of temporary passwords", () => {
    expect(provision).toContain("adminClient.auth.admin.generateLink");
    expect(provision).toContain('type: "recovery"');
    expect(provision).toContain("activation_url: activationLink");
    expect(provision).toContain('activationLink.searchParams.set("entry", entryKey)');
    expect(provision).toContain("portal_entry_key");
    expect(provision).not.toContain("temporary_password");
    expect(provision).not.toContain("temporaryPassword");
  });

  it("can intentionally resend student_welcome while activation is pending", () => {
    const resendBlock =
      provision.split('if (mode === "resend")')[1]?.split("if (student.user_id)")[0] ?? "";

    expect(resendBlock).toContain("sendAsistianWebhook");
    expect(resendBlock).toContain('source: "student_access_activation_resend"');
    expect(resendBlock).toContain("account.must_change_password !== true");
  });

  it("keeps account provisioning independent from Asistian delivery success", () => {
    expect(provision).toContain("const welcomeDelivery = await sendAsistianWebhook");
    expect(provision).toContain("ok: true");
    expect(provision).toContain("welcomeDelivery: {");
  });

  it("reads the webhook from Vault through the service-role-only RPC", () => {
    expect(shared).toContain('"service_get_asistian_webhook"');
    expect(shared).toContain("target_studio_id: input.studioId");
    expect(shared).toContain("target_template: input.template");
  });

  it("builds the activation URL from the active environment host", () => {
    expect(actions).toContain('new URL("/login/student/activar", `https://${host}`).toString()');
    expect(actions).toContain("activationUrl");
  });
});
