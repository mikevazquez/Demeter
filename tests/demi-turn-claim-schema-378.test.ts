import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261023183000_demi378_atomic_send_claims.sql",
  ),
  "utf8",
);

describe("DEMI-378 claim schema contract", () => {
  it("uses the same advisory lock in capture and claim", () => {
    expect(sql).toContain("create trigger assistant_whatsapp_lock_inbound_text");
    expect(sql).toContain("create or replace function public.assistant_whatsapp_claim_current_text");
    const lockKey = "hashtextextended(";
    expect(sql.split(lockKey).length - 1).toBe(2);
    expect(sql).toContain("pg_advisory_xact_lock(");
  });

  it("denies public execution and prevents duplicate active claims", () => {
    expect(sql).toContain("create unique index if not exists assistant_whatsapp_one_active_claim");
    expect(sql).toContain("where state in ('claimed', 'uncertain')");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role;");
  });
});
