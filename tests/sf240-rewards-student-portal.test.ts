import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  exactMissingLabel,
  singleNumericProgress,
  type StudentConditionProgress,
} from "../lib/student/reward-progress-ui";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("SF-240 student Rewards portal", () => {
  it("adds Rewards to the established student navigation", () => {
    const nav = read("app/student/StudentNav.tsx");

    expect(nav).toContain('href: "/student/recompensas"');
    expect(nav).toContain('label: "Recompensas"');
    expect(nav).toContain("grid-cols-5");
    expect(nav).not.toContain("admin-shell");
  });

  it("implements S01-S05 routes", () => {
    const files = [
      "app/student/recompensas/page.tsx",
      "app/student/recompensas/progreso/[participationId]/page.tsx",
      "app/student/recompensas/[rewardId]/page.tsx",
      "app/student/recompensas/logros/page.tsx",
      "app/student/recompensas/historial/page.tsx",
    ];

    for (const file of files) {
      expect(read(file)).toContain("getStudentRewardsContext");
    }
  });

  it("does not create a combined percentage for multi-condition progress", () => {
    const conditions: StudentConditionProgress[] = [
      {
        key: "a",
        metric: "attendance.count",
        label: "Asistencias",
        comparator: "gte",
        target: 8,
        current: 7,
        completed: false,
      },
      {
        key: "b",
        metric: "attendance.distinct_disciplines",
        label: "Disciplinas distintas",
        comparator: "gte",
        target: 3,
        current: 3,
        completed: true,
      },
    ];

    expect(singleNumericProgress(conditions)).toBeNull();
    expect(exactMissingLabel(conditions)).toContain("Asistencias");
  });

  it("keeps the achievements experience free of XP and rankings", () => {
    const achievements = read("app/student/recompensas/logros/page.tsx").toLowerCase();

    expect(achievements).toContain("no hay puntos");
    expect(achievements).toContain("rankings");
    expect(achievements).not.toContain("leaderboard");
    expect(achievements).not.toContain(" xp ");
  });

  it("uses approved user-facing reward states", () => {
    const rewards = read("lib/student/rewards.ts");

    expect(rewards).toContain('reserved: "En uso"');
    expect(rewards).toContain('revoked: "Ajustada"');
    expect(rewards).toContain('redeemed: "Utilizada"');
    expect(rewards).toContain('expired: "Vencida"');
  });

  it("keeps fixed rewards non-partial and links available rewards to purchase", () => {
    const detail = read("app/student/recompensas/[rewardId]/page.tsx");

    expect(detail).toContain("no se utiliza parcialmente");
    expect(detail).toContain("el sobrante no se guarda como saldo");
    expect(detail).toContain('href="/student/paquete"');
    expect(detail).toContain("Usar recompensa");
  });

  it("shows chronological history filters without a total-saved KPI", () => {
    const history = read("app/student/recompensas/historial/page.tsx");

    expect(history).toContain("Utilizadas");
    expect(history).toContain("Vencidas");
    expect(history).toContain("Ajustadas");
    expect(history).not.toContain("Total ahorrado");
  });

  it("restricts student rule reads to linked reward context", () => {
    const sql = read("supabase/migrations/20260920014500_sf240_rewards_student_read.sql");

    expect(sql).toContain("reward_rules_student_self_read");
    expect(sql).toContain("reward_rule_versions_student_self_read");
    expect(sql).toContain("private.is_reward_student_self");
    expect(sql).toContain("reward_participations");
    expect(sql).toContain("reward_instances");
    expect(sql).toContain("reward_achievement_unlocks");
    expect(sql).not.toContain("using (true)");
  });
});
