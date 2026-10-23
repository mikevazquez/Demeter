import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { averageCostPerConversation, parseDemiUsage } from "@/lib/platform/demi-usage";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261023166000_neb01_demi_usage.sql");

describe("NEB-01-21 uso de Demi por estudio", () => {
  it("lee totales, días y conversaciones", () => {
    const usage = parseDemiUsage({
      days: 30,
      totals: { calls: 3, errors: 1, cost_usd_micros: 4700, conversations: 2 },
      daily: [{ day: "2026-10-23", calls: 2, tokens: 1310, cost_usd_micros: 3200 }],
      models: [{ model: "m1", calls: 2, cost_usd_micros: 4500 }],
      top_conversations: [{ conversation_id: "c1", calls: 2, cost_usd_micros: 4500, last_at: "x" }],
    });
    expect(usage?.totals.costUsdMicros).toBe(4700);
    expect(usage?.daily[0].tokens).toBe(1310);
    expect(averageCostPerConversation(usage!)).toBe(2350);
    expect(parseDemiUsage(null)).toBeNull();
  });

  it("no expone texto de mensajes y es solo de plataforma", () => {
    expect(migration).toContain("perform private.platform_require_admin();");
    expect(migration).not.toMatch(/content|message_text|body/);
    expect(migration).toContain(
      "revoke all on function public.platform_studio_demi_usage(uuid, integer) from public, anon;",
    );
  });
});
