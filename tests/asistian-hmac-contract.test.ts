import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Asistian signed incoming webhook contract", () => {
  const shared = source("supabase/functions/_shared/asistian-messaging.ts");
  const actions = source("app/admin/integraciones/asistian/actions.ts");
  const migration = source(
    "supabase/migrations/20260922222000_asistian_template_signing_credentials.sql",
  );

  it("signs the exact serialized body and sends the documented headers", () => {
    expect(shared).toContain("const body = JSON.stringify(payload);");
    expect(shared).toContain("createAsistianSignature(signingSecret, body)");
    expect(shared).toContain('"X-Webhook-Signature": signature');
    expect(shared).toContain('"Idempotency-Key": input.eventId');
    expect(shared).toContain("body,");
  });

  it("stores signing secrets per Asistian automation/template", () => {
    expect(migration).toContain(
      "'asistian_signing_secret:' || target_studio_id::text || ':' || v_template",
    );
    expect(shared).toContain('"service_get_asistian_signing_secret"');
    expect(shared).toContain("target_template: input.template");
  });

  it("uses the same HMAC and idempotency contract for the admin handshake", () => {
    expect(actions).toContain(
      'createHmac("sha256", signingSecret).update(body, "utf8").digest("hex")',
    );
    expect(actions).toContain('"X-Webhook-Signature": signature');
    expect(actions).toContain('"Idempotency-Key": eventId');
    expect(actions).toContain('const ASISTIAN_TEMPLATE = "reservation_confirmed"');
  });
});
