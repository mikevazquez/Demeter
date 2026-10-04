import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi service waitlist runtime", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const migration = source(
    "supabase/migrations/20261004014000_demi_service_waitlist_runtime.sql",
  );

  it("uses service RPCs for WhatsApp waitlist preview and join", () => {
    expect(actions).toContain('ctx.serviceMode');
    expect(actions).toContain('"service_waitlist_preview"');
    expect(actions).toContain('"service_join_waitlist"');
    expect(actions).toContain('"admin_waitlist_preview"');
    expect(actions).toContain('"admin_join_waitlist"');
  });

  it("limits service waitlist RPCs to service_role and studio scope", () => {
    expect(migration).toContain("target_studio_id uuid");
    expect(migration).toContain("<> 'service_role'");
    expect(migration).toContain("and studio_id = target_studio_id");
    expect(migration).toContain(
      "grant execute on function public.service_waitlist_preview(uuid,uuid,uuid) to service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.service_join_waitlist(uuid,uuid,uuid) to service_role",
    );
    expect(migration).toContain(
      "revoke all on function public.service_join_waitlist(uuid,uuid,uuid) from public, anon, authenticated",
    );
  });
});
