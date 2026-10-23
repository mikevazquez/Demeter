import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261023183000_demi378_atomic_send_claims.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("DEMI-378 claim schema contract", () => {
  it("shares a lock across capture and claim", () => {
    expect(sql).toContain("create trigger assistant_whatsapp_lock_inbound_text");
    expect(sql).toContain("assistant_whatsapp_claim_current_text");
    expect(sql).toContain("after insert on public.assistant_whatsapp_events");
    expect(sql).toContain("for update;");
  });

  it("restricts claim ownership", () => {
    expect(sql).toContain("assistant_whatsapp_one_active_claim");
    expect(sql).toContain("where state in ('reserved', 'dispatching')");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role;");
  });

  it("finishes claims only through the owner token", () => {
    expect(sql).toContain("assistant_whatsapp_finish_text_claim");
    expect(sql).toContain("where claim_token = p_claim_token");
  });
});
