import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  exactMissingLabel,
  isStudentRewardProgressActive,
  isStudentRewardProgressFinalized,
  singleNumericProgress,
  type StudentConditionProgress,
} from "../lib/student/reward-progress-ui";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("SF-240 student Rewards portal", () => {
  it("keeps Rewards contextual without changing established student navigation", () => {
    const nav = read("app/student/StudentNav.tsx");

    expect(nav).toContain('href: "/student"');
    expect(nav).toContain('href: "/student/reservar"');
    expect(nav).toContain('href: "/student/mis-clases"');
    expect(nav).toContain('href: "/student/perfil"');
    expect(nav).not.toContain('href: "/student/recompensas"');
    expect(nav).toContain("grid-cols-4");
    expect(nav).not.toContain("grid-cols-5");
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
    expect(exactMissingLabel(conditions).toLowerCase()).toContain("asistencias");
  });

  it("does not present cancelled or expired reward progress as active", () => {
    const participation = { status: "in_progress" };
    const activeRule = { status: "active" };
    const cancelledRule = { status: "cancelled" };
    const openFutureCycle = { status: "open", window_end_at: "2026-09-27T06:00:00.000Z" };
    const openExpiredCycle = { status: "open", window_end_at: "2026-09-19T23:59:59.999Z" };
    const now = new Date("2026-09-20T06:30:00.000Z");

    expect(isStudentRewardProgressActive(participation, activeRule, openFutureCycle, now)).toBe(true);
    expect(
      isStudentRewardProgressActive(participation, cancelledRule, openFutureCycle, now),
    ).toBe(false);
    expect(isStudentRewardProgressActive(participation, activeRule, openExpiredCycle, now)).toBe(false);
    expect(
      isStudentRewardProgressFinalized(participation, cancelledRule, openFutureCycle, now),
    ).toBe(true);
    expect(
      isStudentRewardProgressFinalized(participation, activeRule, openExpiredCycle, now),
    ).toBe(true);
  });

  it("marks stale progress detail as finalized instead of in progress", () => {
    const detail = read("app/student/recompensas/progreso/[participationId]/page.tsx");

    expect(detail).toContain("isStudentRewardProgressFinalized");
    expect(detail).not.toContain("Date.now()");
    expect(detail).toContain("Este reto ya terminó");
    expect(detail).toContain("No completada");
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

  it("returns a signed-out student to Rewards after login", () => {
    const proxy = read("lib/supabase/proxy.ts");
    const loginPage = read("app/login/student/page.tsx");
    const loginCard = read("app/login/login-card.tsx");
    const authActions = read("app/auth/actions.ts");

    expect(proxy).toContain('request.nextUrl.pathname === "/student/recompensas"');
    expect(proxy).toContain('loginUrl.searchParams.set("next", destination)');
    expect(loginPage).toContain("next?: string");
    expect(loginCard).toContain('name="return_to"');
    expect(authActions).toContain("safeReturnTo");
    expect(authActions).toContain('redirect(returnTo ?? "/student")');
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
