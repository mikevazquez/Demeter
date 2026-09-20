// SF-253 contract coverage for the approved Admin P01–P11 experience.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const nav = read("app/admin/recompensas/RewardsNav.tsx");
const actions = read("app/admin/recompensas/actions.ts");
const challenges = read("app/admin/recompensas/retos/page.tsx");
const tracking = read("app/admin/recompensas/seguimiento/page.tsx");
const studentProgress = read("app/admin/recompensas/seguimiento/[studentId]/page.tsx");
const rewardDetail = read("app/admin/recompensas/generadas/[rewardId]/page.tsx");
const programDetail = read("app/admin/recompensas/programas/[programId]/page.tsx");
const achievementDetail = read("app/admin/recompensas/logros/[ruleId]/page.tsx");
const challengeDetail = read("app/admin/recompensas/retos/[ruleId]/page.tsx");
const challengeSavedNotice = read("app/admin/recompensas/retos/ChallengeSavedNotice.tsx");
const achievementSavedNotice = read("app/admin/recompensas/logros/AchievementSavedNotice.tsx");
const programSavedNotice = read(
  "app/admin/recompensas/programas/[programId]/ProgramSavedNotice.tsx",
);
const runtimeHardening = read(
  "supabase/migrations/20260920135932_sf253_rewards_admin_runtime_hardening.sql",
);
const copyOverrides = read(
  "supabase/migrations/20260920140131_sf253_rewards_rule_copy_overrides.sql",
);
const loyaltySupport = read(
  "supabase/migrations/20260920140918_sf253_rewards_loyalty_condition_family.sql",
);

describe("SF-253 Rewards admin control center", () => {
  it("exposes the approved product navigation", () => {
    for (const label of ["Inicio", "Programas", "Logros", "Retos", "Seguimiento", "Recompensas"]) {
      expect(nav).toContain(label);
    }
    expect(nav).not.toContain("Incidencias");
  });

  it("keeps manual reward grants out of the new admin surface", () => {
    expect(actions).not.toContain("admin_grant_manual_reward");
    expect(actions).toContain("admin_adjust_reward_instance");
    expect(rewardDetail).toContain("AJUSTE EXCEPCIONAL");
  });

  it("implements the approved challenge filters and progress monitoring", () => {
    expect(challenges).toContain("Programados");
    expect(challenges).toContain("Borradores");
    expect(challenges).toContain("Finalizados");
    expect(tracking).toContain("Más cerca de completar");
    expect(tracking).toContain("faltan");
  });

  it("implements individual trajectory tabs without progress mutation", () => {
    for (const label of ["Resumen", "Logros", "Recompensas", "Historial"]) {
      expect(studentProgress).toContain(label);
    }
    expect(studentProgress).not.toContain("editar progreso");
  });

  it("runs scheduled lifecycle and supports loyalty-backed challenges", () => {
    expect(runtimeHardening).toContain("cron.schedule");
    expect(runtimeHardening).toContain("system_sync_reward_rule_schedules");
    expect(runtimeHardening).toContain("v_condition_family");
    expect(loyaltySupport).toContain("condition_family");
  });

  it("uses the approved dialog pattern for program success feedback", () => {
    expect(programDetail).toContain("ProgramSavedNotice");
    expect(programDetail).not.toContain("notice success");
    expect(programSavedNotice).toContain("NoticeDialog");
    expect(programSavedNotice).toContain("Cambio guardado correctamente");
  });

  it("uses the approved dialog pattern for achievement success feedback", () => {
    expect(achievementDetail).toContain("AchievementSavedNotice");
    expect(achievementDetail).not.toContain("notice success");
    expect(achievementSavedNotice).toContain("NoticeDialog");
    expect(achievementSavedNotice).toContain("Cambio guardado correctamente");
  });

  it("uses the approved dialog pattern for challenge success feedback", () => {
    expect(challengeDetail).toContain("ChallengeSavedNotice");
    expect(challengeDetail).not.toContain("notice success");
    expect(challengeSavedNotice).toContain("NoticeDialog");
    expect(challengeSavedNotice).toContain("Cambio guardado correctamente");
  });

  it("keeps active copy edits outside structural versions", () => {
    expect(copyOverrides).toContain("reward_rule_copy_overrides");
    expect(copyOverrides).toContain("admin_update_reward_rule_copy");
  });
});
