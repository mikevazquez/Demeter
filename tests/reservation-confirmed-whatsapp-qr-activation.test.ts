import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("reservation confirmation WhatsApp QR activation", () => {
  const migration = source(
    "supabase/migrations/20261006002500_restore_reservation_confirmed_whatsapp_qr.sql",
  );
  const meta = source("supabase/functions/_shared/meta-whatsapp.ts");

  it("adds WhatsApp to the active booking confirmation rule without rewriting history", () => {
    expect(migration).toContain("p0.booking.confirmed");
    expect(migration).toContain("provider_key = 'meta_whatsapp'");
    expect(migration).toContain("not exists");
    expect(migration).toContain("v_new_version");
    expect(migration).toContain("'whatsapp'");
    expect(migration).toContain("current_version_number = v_new_version");
  });

  it("uses the existing per-reservation QR delivery path", () => {
    expect(meta).toContain("service_get_reservation_checkin_token");
    expect(meta).toContain("reservationQrTemplate");
    expect(meta).toContain("headerImageId");
    expect(meta).toContain("reservation-checkin-qr.png");
  });
});
