import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi reservation confirmation QR", () => {
  const meta = source("supabase/functions/_shared/meta-whatsapp.ts");
  const payload = source("supabase/functions/_shared/meta-whatsapp-template.ts");
  const migration = source(
    "supabase/migrations/20261003173200_demi_reservation_qr_whatsapp.sql",
  );

  it("resolves the canonical per-reservation check-in credential service-side", () => {
    expect(migration).toContain("service_get_reservation_checkin_token");
    expect(migration).toContain("private.checkin_token_value");
    expect(migration).toContain("grant execute");
    expect(migration).toContain("to service_role");
  });

  it("generates and uploads a PNG only for QR confirmation templates", () => {
    expect(meta).toContain('from "npm:qrcode@1.5.4"');
    expect(meta).toContain("reservationQrTemplate");
    expect(meta).toContain("service_get_reservation_checkin_token");
    expect(meta).toContain("reservation-checkin-qr.png");
    expect(meta).toContain("/media");
    expect(meta).toContain("headerImageId = media.mediaId");
  });

  it("adds the Meta IMAGE header before body variables", () => {
    expect(payload).toContain("headerImageId?: string | null");
    expect(payload).toContain('type: "header"');
    expect(payload).toContain('type: "image"');
    expect(payload).toContain("id: input.headerImageId");
    expect(payload).toContain('type: "body"');
  });
});
