import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-04B resource and waitlist entitlements", () => {
  const migration = source(
    "supabase/migrations/20260926160404_dev_04b_resource_waitlist_entitlement_gates.sql",
  );
  const capabilities = source("lib/auth/capabilities.ts");

  it("versions the new capability keys and maps them to SaaS modules", () => {
    expect(capabilities).toContain('RESOURCES_READ: "resources.read"');
    expect(capabilities).toContain('RESOURCES_MANAGE: "resources.manage"');
    expect(capabilities).toContain('WAITLIST_USE: "waitlist.use"');
    expect(migration).toContain("('resources.read','resources')");
    expect(migration).toContain("('resources.manage','resources')");
    expect(migration).toContain("('waitlist.use','waitlist')");
  });

  it("gates resource and waitlist RPCs through private.has_capability", () => {
    for (const functionName of [
      "admin_reassign_reservation_resource",
      "admin_restore_session_resource_defaults",
      "admin_save_session_resources",
      "admin_save_space_resource_map",
      "coach_session_resource_map",
      "student_book_session_with_resource",
      "student_book_session_with_reward_credits",
      "student_join_waitlist",
      "student_session_resource_map",
      "student_waitlist_feed",
    ]) {
      expect(migration).toContain(`FUNCTION public.${functionName}`);
    }

    expect(migration).toContain("private.has_capability");
    expect(migration).toContain("resources.manage");
    expect(migration).toContain("resources.read");
    expect(migration).toContain("waitlist.use");
  });
});
