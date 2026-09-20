import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("SF-242 Rewards integrations I03-I04", () => {
  it("keeps reward confirmation decoupled from reward generation", () => {
    const migration = read(
      "supabase/migrations/20260920021000_sf242_reward_notices.sql",
    );
    const notices = read("lib/student/reward-notices.ts");

    expect(migration).toContain("presentation-only acknowledgement state");
    expect(migration).toContain("Reward generation remains independent");
    expect(notices).toContain("reward_instance_events");
    expect(notices).toContain("reward_achievement_unlocks");
    expect(notices).not.toContain("system_generate_reward_instance");
  });

  it("groups multiple unlocks into one student-shell confirmation", () => {
    const component = read("app/student/components/RewardUnlockedNotice.tsx");
    const layout = read("app/student/layout.tsx");

    expect(component).toContain("Desbloqueaste");
    expect(component).toContain("notices.length");
    expect(component).toContain("data-reward-unlock-notice");
    expect(layout).toContain("RewardUnlockedNotice");
    expect(layout).toContain("getPendingStudentRewardNotices");
  });

  it("supports high, light and silent notification behavior", () => {
    const notices = read("lib/student/reward-notices.ts");

    expect(notices).toContain('"high"');
    expect(notices).toContain('"light"');
    expect(notices).toContain('"silent"');
    expect(notices).toContain("unlock_visibility");
    expect(notices).toContain("unlock_notice === false");
  });

  it("uses accurate pending language for automatic benefits", () => {
    const notices = read("lib/student/reward-notices.ts");

    expect(notices).toContain('"automatic_pending"');
    expect(notices).toContain("Estamos terminando de aplicarlo");
    expect(notices).toContain("todavía no aparece como utilizado");
  });

  it("acknowledges notices through an invoker wrapper and self context", () => {
    const migration = read(
      "supabase/migrations/20260920021000_sf242_reward_notices.sql",
    );

    expect(migration).toContain("private.student_ack_reward_notices_internal");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("reward_notice_receipts_student_read");
    expect(migration).toContain("private.is_reward_student_self");
    expect(migration).not.toContain("using (true)");
  });

  it("embeds I04 inside the existing admin student profile", () => {
    const profile = read("app/admin/alumnas/[studentId]/page.tsx");
    const summary = read("app/admin/alumnas/[studentId]/StudentRewardsSummary.tsx");

    expect(profile).toContain("StudentRewardsSummary");
    expect(profile).toContain("canReadRewards");
    expect(summary).toContain("data-rewards-summary");
    expect(summary).toContain("Ver perfil Rewards");
    expect(summary).toContain("Disponibles");
    expect(summary).toContain("Progresos activos");
    expect(summary).toContain("Fidelidad actual");
    expect(summary).toContain("Logros");
    expect(summary).toContain("Incidencias");
  });

  it("keeps sensitive Rewards actions out of the compact I04 summary", () => {
    const summary = read("app/admin/alumnas/[studentId]/StudentRewardsSummary.tsx");

    expect(summary).not.toContain("admin_grant_manual_reward");
    expect(summary).not.toContain("admin_resolve_reward_incident");
    expect(summary).not.toContain("Revocar");
    expect(summary).not.toContain("Otorgar recompensa");
  });
});
