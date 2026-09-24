import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260924144500_rewards_existing_profile_email_backfill.sql",
  ),
  "utf8",
);

describe("REWARDS · existing profile email backfill", () => {
  it("accepts persisted email evidence from Students, Auth or Person Contacts", () => {
    expect(migration).toContain("v_student.email");
    expect(migration).toContain("from auth.users u");
    expect(migration).toContain("from public.person_contacts pc");
    expect(migration).toContain("pc.kind = 'email'");
  });

  it("re-evaluates only active regular students", () => {
    expect(migration).toContain("s.lifecycle_status = 'active'");
    expect(migration).toContain("s.student_type = 'regular'");
    expect(migration).toContain("perform private.reward_onboarding_refresh_profile");
  });
});
