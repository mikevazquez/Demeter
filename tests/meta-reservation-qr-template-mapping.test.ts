import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Demeter QR reservation template mapping", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261006010500_meta_whatsapp_reservation_qr_template.sql",
    ),
    "utf8",
  );

  it("updates only the reservation confirmation mapping and preserves the secret payload", () => {
    expect(sql).toContain("demeter_reserva_confirmada_qr_v3");
    expect(sql).toContain("'reservation_confirmed'");
    expect(sql).toContain("v_payload := jsonb_set");
    expect(sql).toContain("vault.update_secret");
    expect(sql).not.toContain("access_token");
  });
});
