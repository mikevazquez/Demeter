import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const onboarding = readFileSync(
  join(process.cwd(), "supabase/migrations/20260923160000_rewards_bronze_onboarding.sql"),
  "utf8",
);
const cleanup = readFileSync(
  join(process.cwd(), "supabase/migrations/20260923160500_rewards_bronze_onboarding_cleanup.sql"),
  "utf8",
);
const rewardsPage = readFileSync(
  join(process.cwd(), "app/student/recompensas/page.tsx"),
  "utf8",
);
const onboardingUi = readFileSync(
  join(process.cwd(), "app/student/recompensas/OnboardingActivation.tsx"),
  "utf8",
);
const homePage = readFileSync(join(process.cwd(), "app/student/page.tsx"), "utf8");
const profilePage = readFileSync(join(process.cwd(), "app/student/perfil/page.tsx"), "utf8");
const studentActions = readFileSync(join(process.cwd(), "app/student/actions.ts"), "utf8");
const adminStudent = readFileSync(
  join(process.cwd(), "app/admin/alumnas/[studentId]/page.tsx"),
  "utf8",
);
const adminOverview = readFileSync(
  join(process.cwd(), "app/admin/alumnas/[studentId]/Profile360Overview.tsx"),
  "utf8",
);
const adminRewards = readFileSync(
  join(process.cwd(), "app/admin/recompensas/page.tsx"),
  "utf8",
);

describe("REWARDS Bronze onboarding", () => {
  it("stops granting Bronze merely for creating a student", () => {
    expect(onboarding).toContain("drop trigger if exists reward_status_seed_student");
    expect(onboarding).toContain("create trigger reward_onboarding_seed_student");
    expect(onboarding).toContain("'not_activated', true");
    expect(onboarding).toContain("reward_onboarding_try_unlock");
  });

  it("requires four persistent milestones before automatic Bronze unlock", () => {
    expect(onboarding).toContain("documents_completed_at is null");
    expect(onboarding).toContain("profile_completed_at is null");
    expect(onboarding).toContain("first_reservation_at is null");
    expect(onboarding).toContain("first_attendance_at is null");
    expect(onboarding).toContain("'onboarding'");
    expect(onboarding).toContain("'bronze'");
  });

  it("preserves existing medal memberships and does not force legacy students through onboarding", () => {
    expect(onboarding).toContain("'legacy'");
    expect(onboarding).toContain("bronze_acknowledged_at");
    expect(onboarding).toContain("left join public.reward_status_memberships");
  });

  it("keeps reservation and attendance milestones auditable", () => {
    expect(onboarding).toContain("first_reservation_id");
    expect(onboarding).toContain("first_attendance_reservation_id");
    expect(onboarding).toContain("after insert on public.reservations");
    expect(onboarding).toContain("new.status = 'attended'");
  });

  it("supports future Documentos integration without inventing acceptance evidence", () => {
    expect(onboarding).toContain("reward_onboarding_mark_documents_complete");
    expect(onboarding).toContain("documents_evidence");
    expect(onboardingUi).toContain('href="/student/documentos"');
  });

  it("lets the student complete profile data required by onboarding", () => {
    expect(profilePage).toContain("Fecha de nacimiento");
    expect(profilePage).toContain('name="birth_date"');
    expect(studentActions).toContain("student_update_reward_onboarding_profile");
    expect(onboarding).toContain("student_set_reward_onboarding_birth_date");
  });

  it("gates the student Rewards surface until Bronze is unlocked and shows the celebration once", () => {
    expect(rewardsPage).toContain("RewardsOnboardingActivation");
    expect(rewardsPage).toContain("BronzeMedalUnlocked");
    expect(rewardsPage).toContain("bronze_acknowledged_at");
    expect(onboardingUi).toContain("Desbloquea tu primera");
    expect(onboardingUi).toContain("¡Desbloqueaste tu primera medalla!");
  });

  it("uses medal language for Rewards and keeps technical levels distinct", () => {
    expect(homePage).toContain("Mi medalla");
    expect(homePage).toContain("Medalla ");
    expect(homePage).toContain("Niveles técnicos");
    expect(homePage).toContain("En activación");
    expect(adminOverview).toContain('"Medalla " + levelTitle');
    expect(adminStudent).toContain("Medalla actual");
    expect(adminStudent).toContain("niveles técnicos por disciplina");
    expect(adminStudent).not.toContain("Nivel general actual");
  });

  it("allows exceptional admin Bronze grants only through the audited RPC", () => {
    expect(onboarding).toContain("admin_grant_bronze_medal");
    expect(onboarding).toContain("reward_onboarding_reason_required");
    expect(onboarding).toContain("'reward_onboarding_admin'");
    expect(adminStudent).toContain("Motivo de la excepción");
    expect(adminStudent).toContain("Otorgar Medalla Bronce");
  });

  it("shows the fixed v1 activation configuration in Rewards admin", () => {
    expect(adminRewards).toContain("Activación de Medalla Bronce");
    expect(adminRewards).toContain("Aceptar documentos obligatorios");
    expect(adminRewards).toContain("Completar perfil");
    expect(adminRewards).toContain("Realizar primera reserva");
    expect(adminRewards).toContain("Asistir a primera clase");
    expect(adminRewards).toContain("Requisitos fijos en v1");
  });

  it("removes obsolete Sandbox prototype hooks", () => {
    expect(cleanup).toContain("reward_onboarding_student_sync");
    expect(cleanup).toContain("reward_medal_onboarding");
  });
});
