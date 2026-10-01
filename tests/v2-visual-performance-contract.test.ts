import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Studio Flow V2 visual + performance contract", () => {
  const adminLayout = source("app/admin/layout.tsx");
  const visualSystem = source("app/admin/admin-v2-system.css");
  const noticeDialog = source("app/admin/components/NoticeDialog.tsx");
  const secondaryCss = source("app/admin/admin-ux-04-secondary.css");
  const secondaryDetailCss = source("app/admin/admin-ux-04-secondary-detail.css");
  const sessionDetailCss = source("app/admin/agenda/session-detail-admin-ux-04.css");
  const notificationCss = source("app/admin/notificaciones/notificaciones.css");
  const sessionResourcesCss = source(
    "app/admin/agenda/[sessionId]/recursos/session-resources.module.css",
  );
  const adminLoading = source("app/admin/loading.tsx");
  const adminError = source("app/admin/error.tsx");
  const today = source("app/admin/page.tsx");
  const todayActions = source("app/admin/actions.ts");
  const quickActions = source("app/admin/hoy/QuickActions.tsx");
  const quickActionServer = source("app/admin/hoy/quick-actions.ts");
  const agenda = source("app/admin/agenda/page.tsx");
  const sessionDetail = source("app/admin/agenda/[sessionId]/page.tsx");
  const studentLayout = source("app/student/layout.tsx");
  const studentLoading = source("app/student/loading.tsx");
  const reserve = source("app/student/reservar/page.tsx");
  const packagePage = source("app/student/paquete/page.tsx");
  const adminContext = source("lib/auth/admin-context.ts");
  const balanceMigration = source(
    "supabase/migrations/20261001150000_perf_batch_acquisition_credit_balances.sql",
  );
  const indexMigration = source("supabase/migrations/20261001153500_perf_hot_read_indexes.sql");

  it("applies the shared light V2 visual system to every admin route", () => {
    expect(adminLayout).toContain('import "./admin-v2-system.css"');
    expect(visualSystem).toContain(".admin-shell");
    expect(visualSystem).toContain("--accent: #17a878");
    expect(visualSystem).toContain(".sf-admin-dialog");
    expect(visualSystem).toContain(".sf-admin-loading");
  });

  it("eliminates the remaining dark islands from secondary admin modules", () => {
    expect(secondaryCss).toContain("Studio Flow V2 · light visual consolidation");
    expect(secondaryDetailCss).toContain("Studio Flow V2 · light detail/editor consolidation");
    expect(sessionDetailCss).toContain("Studio Flow V2 · light session-detail consolidation");
    expect(notificationCss).toContain("Studio Flow V2 · light notification surfaces");
    expect(sessionResourcesCss).toContain("Studio Flow V2 · light session-resource surfaces");
    expect(sessionDetailCss).toContain("--session-v2-accent: #17a878");
    expect(notificationCss).toContain("--notification-accent: #17a878");
  });

  it("standardizes admin confirmation, error and loading surfaces", () => {
    expect(noticeDialog).toContain("sf-admin-dialog-backdrop");
    expect(noticeDialog).toContain("sf-admin-dialog-action");
    expect(noticeDialog).not.toContain("bg-black/75");
    expect(adminLoading).toContain("sf-skeleton");
    expect(adminError).toContain("admin-state-card");
  });

  it("keeps the student portal on its tenant-specific dark language while adding loading feedback", () => {
    expect(studentLayout).toContain('bg-[#090a0f]');
    expect(studentLoading).toContain("Cargando tu información");
    expect(studentLoading).toContain("animate-pulse");
  });

  it("does not preload booking eligibility for every active student on Today", () => {
    expect(today).not.toContain('rpc("booking_eligibility"');
    expect(todayActions).toContain("searchStudentsForToday");
    expect(todayActions).toContain('rpc("booking_eligibility"');
    expect(quickActions).toContain("searchQuickSaleStudents");
  });

  it("defers quick-sale students, products and history until the shortcut is opened", () => {
    expect(today).not.toContain("quickSaleHistory");
    expect(today).not.toContain("quickSaleProducts");
    expect(today).not.toContain("preferredProductByStudent={");
    expect(quickActionServer).toContain("loadQuickSaleProducts");
    expect(quickActionServer).toContain("searchQuickSaleStudents");
  });

  it("batches acquisition balance reads instead of one RPC per acquisition", () => {
    expect(today).toContain('rpc("acquisition_credit_balances"');
    expect(sessionDetail).toContain('rpc("acquisition_credit_balances"');
    expect(balanceMigration).toContain("public.acquisition_credit_balances");
    expect(balanceMigration).toContain("public.acquisition_credit_balance");
  });

  it("removes eager student eligibility from Agenda detail and parallelizes schedule materialization", () => {
    expect(sessionDetail).not.toContain('rpc("booking_eligibility"');
    expect(sessionDetail).not.toContain("operationCandidates");
    expect(agenda).toContain("Promise.all(");
    expect(agenda).toContain('rpc("materialize_recurring_schedule"');
  });

  it("shares one base admin auth/studio context across layout and pages", () => {
    expect(adminContext).toContain("const getAdminBaseContext = cache(resolveAdminBaseContext)");
    expect(adminContext).toContain("export async function getAdminContext");
    expect(adminContext).toContain("getAdminDisplayName");
  });

  it("collapses student reservation and package reads into parallel rounds", () => {
    expect(reserve).toContain("student_schedule_feed");
    expect(reserve).toContain("student_waitlist_feed");
    expect(reserve).toContain("student_reward_status_snapshot");
    expect(packagePage).toContain("Promise.all([");
    expect(packagePage).toContain("student_enrollment_purchase_option");
  });

  it("adds only targeted indexes for hot read paths", () => {
    expect(indexMigration).toContain("evaluation_invitations_reservation_status_idx");
    expect(indexMigration).toContain("payments_studio_effective_on_idx");
    expect(indexMigration).toContain("app_notifications_student_unread_idx");
    expect(indexMigration).toContain("product_acquisitions_active_window_idx");
  });
});
