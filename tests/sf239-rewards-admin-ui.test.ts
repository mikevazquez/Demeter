import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("SF-239 rewards admin UI", () => {
  it("registers Rewards as an admin capability and company surface", () => {
    const capabilities = read("lib/auth/capabilities.ts");
    const layout = read("app/admin/layout.tsx");
    const company = read("app/admin/empresa/page.tsx");

    expect(capabilities).toContain('REWARDS_READ: "rewards.read"');
    expect(capabilities).toContain('REWARDS_MANAGE: "rewards.manage"');
    expect(layout).toContain('"/admin/recompensas"');
    expect(company).toContain('title: "Recompensas"');
  });

  it("implements approved A01-A09 routes without a parallel shell", () => {
    const files = [
      "app/admin/recompensas/page.tsx",
      "app/admin/recompensas/reglas/page.tsx",
      "app/admin/recompensas/reglas/nueva/page.tsx",
      "app/admin/recompensas/reglas/[ruleId]/page.tsx",
      "app/admin/recompensas/reglas/[ruleId]/participantes/page.tsx",
      "app/admin/recompensas/reglas/[ruleId]/participantes/[studentId]/page.tsx",
      "app/admin/recompensas/alumnas/[studentId]/page.tsx",
      "app/admin/recompensas/incidencias/page.tsx",
      "app/admin/recompensas/incidencias/[incidentId]/page.tsx",
    ];

    for (const file of files) {
      expect(read(file)).toContain("getAdminContext");
      expect(read(file)).not.toContain("admin-shell");
    }
  });

  it("keeps structural edits versioned and historical rewards immutable", () => {
    const actions = read("app/admin/recompensas/actions.ts");
    const support = read("supabase/migrations/20260919230000_sf239_rewards_admin_ui_support.sql");

    expect(actions).toContain("admin_create_reward_rule_version");
    expect(support).toContain("structural_edit_from_admin_ui");
    expect(support).toContain("current_version_number = v_next");
    expect(support).not.toContain("update public.reward_rule_versions");
  });

  it("requires an audited reason for manual grants", () => {
    const support = read("supabase/migrations/20260919230000_sf239_rewards_admin_ui_support.sql");
    const profile = read("app/admin/recompensas/alumnas/[studentId]/page.tsx");

    expect(support).toContain("reward_manual_reason_required");
    expect(support).toContain("manually_granted");
    expect(support).toContain("admin_manual_grant");
    expect(profile).toContain("Motivo obligatorio");
  });

  it("uses public invoker wrappers over private definer implementations", () => {
    const hardening = read(
      "supabase/migrations/20260919230500_sf239_rewards_admin_rpc_hardening.sql",
    );

    expect(hardening).toContain("security invoker");
    expect(hardening).toContain("private.admin_transition_reward_rule_internal");
    expect(hardening).toContain("private.admin_grant_manual_reward_internal");
    expect(hardening).toContain("to authenticated");
  });

  it("keeps incident resolution on the audited SF-243 action path", () => {
    const detail = read("app/admin/recompensas/incidencias/[incidentId]/page.tsx");
    const actions = read("app/admin/recompensas/actions.ts");

    expect(detail).toContain("resolveRewardIncidentAction");
    expect(actions).toContain("admin_resolve_reward_incident");
    expect(detail).not.toContain("update public.reward_instances");
  });
});
