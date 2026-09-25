import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const onboarding = source("supabase/migrations/20260923160000_rewards_bronze_onboarding.sql");
const cleanup = source("supabase/migrations/20260923160500_rewards_bronze_onboarding_cleanup.sql");
const pwaPush = source("supabase/migrations/20260923211000_rewards_onboarding_pwa_push.sql");
const monthlyMedals = source("supabase/migrations/20260923222500_rewards_monthly_medals.sql");
const medalsAcknowledgeFix = source(
  "supabase/migrations/20260924073000_rewards_medals_acknowledgement_fix.sql",
);
const existingActiveOnboarding = source(
  "supabase/migrations/20260924143000_rewards_existing_active_onboarding.sql",
);
const documentosDomain = source("supabase/migrations/20260923180328_documentos01_domain.sql");
const rewardsPage = source("app/student/recompensas/page.tsx");
const onboardingUi = source("app/student/recompensas/OnboardingActivation.tsx");
const installUi = source("app/student/recompensas/OnboardingInstallStep.tsx");
const pushUi = source("app/student/components/PushNotificationSettings.tsx");
const medallero = source("app/student/recompensas/medallero/page.tsx");
const medalInfo = source("app/student/recompensas/medallero/MedalInfoDialog.tsx");
const homePage = source("app/student/page.tsx");
const profilePage = source("app/student/perfil/page.tsx");
const studentActions = source("app/student/actions.ts");
const rewardsActions = source("app/student/recompensas/actions.ts");
const adminStudent = source("app/admin/alumnas/[studentId]/page.tsx");
const adminActions = source("app/admin/alumnas/[studentId]/actions.ts");
const adminOverview = source("app/admin/alumnas/[studentId]/Profile360Overview.tsx");
const adminRewards = source("app/admin/recompensas/page.tsx");
const adminMedals = source("app/admin/recompensas/medallas/page.tsx");

describe("REWARDS · onboarding access + monthly Medals", () => {
  it("keeps the six persistent onboarding milestones but unlocks access instead of Bronze", () => {
    expect(pwaPush).toContain("documents_completed_at is null");
    expect(pwaPush).toContain("profile_completed_at is null");
    expect(pwaPush).toContain("app_installed_at is null");
    expect(pwaPush).toContain("notifications_enabled_at is null");
    expect(pwaPush).toContain("first_reservation_at is null");
    expect(pwaPush).toContain("first_attendance_at is null");

    expect(monthlyMedals).toContain("access_unlocked_at");
    expect(monthlyMedals).toContain("'access_unlocked'");
    expect(monthlyMedals).toContain("current_level_key,activated_on,level_effective_from");
    expect(monthlyMedals).toContain("v_student.id,");
    expect(monthlyMedals).toContain("null,");
    expect(monthlyMedals).toContain("student_acknowledge_medals_access");
  });

  it("preserves legacy Medal memberships while removing automatic Bronze from new onboarding", () => {
    expect(monthlyMedals).toContain("Membresías previas se consideran legado");
    expect(monthlyMedals).toContain("access_method = coalesce(access_method,'legacy')");
    expect(monthlyMedals).toContain("current_level_key = null");
    expect(monthlyMedals).toContain("m.last_closed_period_start is null");
    expect(onboarding).toContain("'legacy'");
  });

  it("rolls existing active regular students into onboarding without erasing their Medal", () => {
    expect(existingActiveOnboarding).toContain("s.student_type = 'regular'");
    expect(existingActiveOnboarding).toContain("s.lifecycle_status = 'active'");
    expect(existingActiveOnboarding).toContain("access_unlocked_at = null");
    expect(existingActiveOnboarding).toContain("perform private.reward_onboarding_refresh_profile");
    expect(existingActiveOnboarding).toContain(
      "perform private.document_refresh_rewards_onboarding",
    );
    expect(existingActiveOnboarding).toContain("'existing_membership_preserved',v_had_membership");
    expect(existingActiveOnboarding).not.toContain("set current_level_key = null");
    expect(homePage).toContain("const currentMedal = rewardStatus?.access_unlocked");
  });

  it("keeps PWA, Push, reservation and attendance milestones auditable", () => {
    expect(pwaPush).toContain("student_confirm_reward_app_installation");
    expect(pwaPush).toContain("first_push_subscription_id");
    expect(pwaPush).toContain("reward_onboarding_capture_push_subscription");
    expect(pwaPush).toContain("push_subscriptions");
    expect(installUi).toContain("Agregar a pantalla de inicio");
    expect(installUi).toContain("display-mode: standalone");
    expect(pushUi).toContain("Activar notificaciones");
    expect(pushUi).toContain("elige Permitir");

    expect(onboarding).toContain("first_reservation_id");
    expect(onboarding).toContain("first_attendance_reservation_id");
    expect(onboarding).toContain("after insert on public.reservations");
    expect(onboarding).toContain("new.status = 'attended'");
  });

  it("uses the native DOCUMENTOS-01 hook for the first onboarding milestone", () => {
    expect(onboarding).toContain("reward_onboarding_mark_documents_complete");
    expect(documentosDomain).toContain("document_refresh_rewards_onboarding");
    expect(documentosDomain).toContain("reward_onboarding_mark_documents_complete(uuid,jsonb)");
    expect(documentosDomain).toContain("document_acceptance_after_insert");
    expect(onboardingUi).toContain('href="/student/documentos"');
  });

  it("lets the student complete the profile fields required by onboarding", () => {
    expect(profilePage).toContain("Fecha de nacimiento");
    expect(profilePage).toContain('name="birth_date"');
    expect(profilePage).toContain("Datos que puedes cambiar");
    expect(studentActions).toContain("student_update_reward_onboarding_profile");
    expect(onboarding).toContain("student_set_reward_onboarding_birth_date");
  });

  it("celebrates access to Medals once without granting Bronze", () => {
    expect(rewardsPage).toContain("RewardsOnboardingActivation");
    expect(rewardsPage).toContain("MedalsAccessUnlocked");
    expect(rewardsPage).toContain("access_acknowledged_at");
    expect(onboardingUi).toContain("Activa tus");
    expect(onboardingUi).toContain("¡Medallas desbloqueadas!");
    expect(onboardingUi).toContain("Ir a mi Medallero");
    expect(medalsAcknowledgeFix).toContain("security definer");
    expect(medalsAcknowledgeFix).toContain("access_acknowledged_at");
    expect(rewardsActions).toContain('redirect("/student/recompensas/medallero")');
    expect(onboardingUi).not.toContain("¡Desbloqueaste tu primera medalla!");
  });

  it("uses the approved monthly requirements and evaluates all Medals directly", () => {
    expect(monthlyMedals).toContain("required_active_days");
    expect(monthlyMedals).toContain("max_no_shows");
    expect(monthlyMedals).toContain("min_continuity_months");
    expect(monthlyMedals).toContain("max_renewal_gap_days");
    expect(monthlyMedals).toContain("when 'bronze' then 6");
    expect(monthlyMedals).toContain("when 'silver' then 9");
    expect(monthlyMedals).toContain("when 'gold' then 12");
    expect(monthlyMedals).toContain("when 'diamond' then 16");
    expect(monthlyMedals).toContain("order by d.level_order desc");
    expect(monthlyMedals).toContain("'eligible_level_key'");
    expect(monthlyMedals).toContain("'projected_medal'");
  });

  it("counts distinct attended days but counts no-shows per reservation", () => {
    expect(monthlyMedals).toContain(
      "count(distinct (cs.starts_at at time zone v_timezone)::date)::integer",
    );
    expect(monthlyMedals).toContain("r.status = 'attended'");
    expect(monthlyMedals).toContain("r.status = 'no_show'");
    expect(monthlyMedals).toContain("select count(*)::integer");
  });

  it("resets Medal continuity after 30 consecutive days without attendance", () => {
    expect(monthlyMedals).toContain("(p_as_of - v_last_attendance) >= 30");
    expect(monthlyMedals).toContain("(day - previous_day) > 30");
    expect(monthlyMedals).toContain("'started_on'");
  });

  it("closes due Medal months automatically in each studio timezone", () => {
    expect(monthlyMedals).toContain("reward_status_close_due_months");
    expect(monthlyMedals).toContain("studio_flow_close_reward_medal_months");
    expect(monthlyMedals).toContain("'12 * * * *'");
    expect(monthlyMedals).toContain("perform private.reward_status_sync_student");
    expect(monthlyMedals).toContain("at time zone coalesce(s.timezone");
  });

  it("keeps no-Medal students in the waitlist with base priority zero", () => {
    expect(monthlyMedals).toContain("left join public.reward_status_memberships");
    expect(monthlyMedals).toContain("left join public.reward_status_level_definitions");
    expect(monthlyMedals).toContain("coalesce(d.level_order,0) desc");
  });

  it("shows the current Medal separately and links to the Medallero", () => {
    expect(homePage).toContain("Medalla actual");
    expect(homePage).toContain('href="/student/recompensas/medallero"');
    expect(homePage).not.toContain("Siguiente medalla");
    expect(homePage).toContain("Sin medalla");
    expect(homePage).toContain("Por activar");
    expect(rewardsPage).toContain('href="/student/recompensas/medallero"');
  });

  it("shows all four independent Medal requirements with help popups", () => {
    expect(medallero).toContain("Medallero");
    expect(medallero).toContain("No necesitas avanzar una por una");
    expect(medallero).toContain("Días activos");
    expect(medallero).toContain("No show");
    expect(medallero).toContain("Continuidad");
    expect(medallero).toContain("Renovación");
    expect(medallero).toContain("MedalInfoDialog");
    expect(medalInfo).toContain("día cuenta una sola vez");
    expect(medalInfo).toContain("cada una se evalúa por separado");
    expect(medalInfo).toContain("30 días consecutivos");
  });

  it("uses Medal language for Rewards and keeps technical levels distinct", () => {
    expect(homePage).toContain("Medalla actual");
    expect(homePage).toContain("Nivel técnico");
    expect(adminOverview).toContain('"Medalla " + levelTitle');
    expect(adminStudent).toContain("Medalla actual");
    expect(adminStudent).toContain("niveles técnicos por disciplina");
    expect(adminStudent).not.toContain("Nivel general actual");
  });

  it("allows audited admin access exceptions without manually awarding Bronze", () => {
    expect(monthlyMedals).toContain("admin_unlock_medals_access");
    expect(monthlyMedals).toContain("reward_onboarding_reason_required");
    expect(adminActions).toContain("unlockMedalsAccess");
    expect(adminActions).toContain("admin_unlock_medals_access");
    expect(adminStudent).toContain("Motivo de la excepción");
    expect(adminStudent).toContain("Habilitar acceso a Medallas");
    expect(adminStudent).not.toContain("Otorgar Medalla Bronce");
  });

  it("documents onboarding access and monthly Medal rules in Rewards admin", () => {
    expect(adminRewards).toContain("Acceso al sistema de Medallas");
    expect(adminRewards).toContain("Aceptar documentos obligatorios");
    expect(adminRewards).toContain("Asistir a primera clase");
    expect(adminRewards).toContain("No existe una");
    expect(adminRewards).toContain("escalera.");
    expect(adminMedals).toContain("Días activos");
    expect(adminMedals).toContain("No show");
    expect(adminMedals).toContain("Continuidad");
    expect(adminMedals).toContain("Renovación");
  });

  it("removes obsolete Sandbox prototype hooks", () => {
    expect(cleanup).toContain("reward_onboarding_student_sync");
    expect(cleanup).toContain("reward_medal_onboarding");
  });
});
