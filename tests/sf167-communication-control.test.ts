import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getAutomationCommunicationWindow,
  recordAutomationCommunicationControl,
  resolveAutomationCommunication,
} from "../lib/automations/communication-control";
import type {
  AutomationInstanceRpcClient,
  AutomationInstanceRpcResult,
} from "../lib/automations/instances";

class FakeCommunicationRpcClient implements AutomationInstanceRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<AutomationInstanceRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "system_get_automation_communication_window") {
      return {
        data: {
          open: false,
          next_open_at: "2026-09-19T15:00:00.000Z",
          timezone: "America/Mexico_City",
          global_window: "09:00-20:00",
          automation_window: null,
          reason_code: "outside_send_window",
        } as T,
        error: null,
      };
    }

    if (functionName === "system_record_automation_communication_control") {
      return {
        data: {
          control_id: "11111111-1111-1111-1111-111111111111",
          decision: args.p_decision,
          created: true,
          requires_revalidation: args.p_decision === "defer",
          deferred_until: args.p_deferred_until ?? null,
        } as T,
        error: null,
      };
    }

    return { data: null, error: { message: "unexpected_rpc" } };
  }
}

describe("SF-167 communication control", () => {
  it("suppresses inactivity when a future reservation makes it irrelevant", () => {
    const result = resolveAutomationCommunication({
      key: "inactive:student-1",
      catalogCode: "AUT-CAT-14",
      contextKeys: ["future_reservation"],
    });

    expect(result).toMatchObject({
      priority: "P2",
      decision: "suppress",
      reasonCode: "context_suppressed",
      dominantKey: "future_reservation",
      requiresRevalidation: false,
    });
  });

  it("substitutes a generic inactivity message when package-expiring is more specific", () => {
    const result = resolveAutomationCommunication(
      {
        key: "inactive:student-1",
        catalogCode: "AUT-CAT-14",
        groupKey: "student-1:retention",
      },
      [
        {
          key: "package-expiring:package-1",
          catalogCode: "AUT-CAT-13",
          groupKey: "student-1:retention",
        },
      ],
    );

    expect(result).toMatchObject({
      decision: "substitute",
      reasonCode: "dominated_by_more_relevant_communication",
      dominantKey: "package-expiring:package-1",
    });
  });

  it("combines payment confirmation and package activation into one related communication", () => {
    const primary = resolveAutomationCommunication(
      {
        key: "payment:1",
        catalogCode: "AUT-CAT-05",
        groupKey: "sale:1",
      },
      [
        {
          key: "package-activation:1",
          catalogCode: "AUT-CAT-06",
          groupKey: "sale:1",
        },
      ],
    );

    const secondary = resolveAutomationCommunication(
      {
        key: "package-activation:1",
        catalogCode: "AUT-CAT-06",
        groupKey: "sale:1",
      },
      [{ key: "payment:1", catalogCode: "AUT-CAT-05", groupKey: "sale:1" }],
    );

    expect(primary).toMatchObject({
      decision: "combine",
      reasonCode: "related_events_combined",
    });
    expect(secondary).toMatchObject({
      decision: "substitute",
      reasonCode: "combined_into_primary_communication",
      dominantKey: "payment:1",
    });
  });

  it("defers a lower-priority communication when an unrelated higher priority is active", () => {
    const result = resolveAutomationCommunication(
      {
        key: "campaign:commercial",
        externalKey: "campaign.custom",
        priority: "P3",
        groupKey: "student-1",
      },
      [
        {
          key: "service:urgent",
          externalKey: "service.custom",
          priority: "P1",
          groupKey: "student-1",
        },
      ],
    );

    expect(result).toMatchObject({
      decision: "defer",
      reasonCode: "higher_priority_communication_active",
      dominantKey: "service:urgent",
      requiresRevalidation: true,
    });
  });

  it("does not let commercial limits block an operational P1 message", () => {
    const result = resolveAutomationCommunication({
      key: "reservation:1",
      catalogCode: "AUT-CAT-01",
      commercialLimitHit: true,
    });

    expect(result).toMatchObject({
      priority: "P1",
      decision: "send",
      reasonCode: "communication_allowed",
    });
    expect(result.details).toMatchObject({
      commercial_limit_ignored: true,
    });
  });

  it("defers P3 when a commercial limit applies", () => {
    const result = resolveAutomationCommunication({
      key: "recovery:1",
      catalogCode: "AUT-CAT-16",
      commercialLimitHit: true,
      commercialNextAllowedAt: "2026-09-20T15:00:00.000Z",
    });

    expect(result).toMatchObject({
      priority: "P3",
      decision: "defer",
      reasonCode: "commercial_limit_deferred",
      deferredUntil: "2026-09-20T15:00:00.000Z",
      requiresRevalidation: true,
    });
  });

  it("defers outside the resolved global/per-automation send window", () => {
    const result = resolveAutomationCommunication({
      key: "package-expiring:1",
      catalogCode: "AUT-CAT-13",
      window: {
        open: false,
        nextOpenAt: "2026-09-19T15:00:00.000Z",
        timezone: "America/Mexico_City",
        globalWindow: "09:00-20:00",
        automationWindow: "10:00-18:00",
        reasonCode: "outside_send_window",
      },
    });

    expect(result).toMatchObject({
      decision: "defer",
      reasonCode: "outside_send_window",
      deferredUntil: "2026-09-19T15:00:00.000Z",
      requiresRevalidation: true,
    });
  });

  it("keeps internal coach/admin communication outside AUT-05 student limits", () => {
    const result = resolveAutomationCommunication({
      key: "coach-summary:1",
      catalogCode: "AUT-CAT-07",
      commercialLimitHit: true,
      window: {
        open: false,
        nextOpenAt: "2026-09-19T15:00:00.000Z",
      },
    });

    expect(result).toMatchObject({
      scope: "internal",
      priority: null,
      decision: "send",
      reasonCode: "internal_communication_independent",
    });
  });

  it("uses the promotional override for first-class no-purchase when a promotion is included", () => {
    const result = resolveAutomationCommunication({
      key: "first-class-no-purchase:1",
      catalogCode: "AUT-CAT-12",
      promotional: true,
    });

    expect(result.priority).toBe("P3");
  });

  it("maps resolved windows and audited decisions to service-role RPCs", async () => {
    const client = new FakeCommunicationRpcClient();
    const window = await getAutomationCommunicationWindow(client, {
      instanceId: "22222222-2222-2222-2222-222222222222",
      at: "2026-09-19T04:00:00.000Z",
    });

    const resolution = resolveAutomationCommunication({
      key: "package-expiring:1",
      catalogCode: "AUT-CAT-13",
      groupKey: "student-1:package",
      window,
    });

    const recorded = await recordAutomationCommunicationControl(client, {
      eligibilityEvaluationId: "33333333-3333-3333-3333-333333333333",
      resolution,
    });

    expect(window).toEqual({
      open: false,
      nextOpenAt: "2026-09-19T15:00:00.000Z",
      timezone: "America/Mexico_City",
      globalWindow: "09:00-20:00",
      automationWindow: null,
      reasonCode: "outside_send_window",
    });

    expect(recorded).toMatchObject({
      decision: "defer",
      created: true,
      requiresRevalidation: true,
    });

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "system_get_automation_communication_window",
      "system_record_automation_communication_control",
    ]);
    expect(client.calls[1]?.args).toMatchObject({
      p_priority: "P2",
      p_decision: "defer",
      p_reason_code: "outside_send_window",
      p_parent_control_id: null,
    });
  });

  it("exposes global communication settings and AUT-05 audit in the approved admin surfaces", () => {
    const listPage = readFileSync(
      join(process.cwd(), "app/admin/automatizaciones/page.tsx"),
      "utf8",
    );
    const detailPage = readFileSync(
      join(process.cwd(), "app/admin/automatizaciones/[code]/page.tsx"),
      "utf8",
    );
    const actions = readFileSync(
      join(process.cwd(), "app/admin/automatizaciones/actions.ts"),
      "utf8",
    );
    const hardening = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260919052000_sf167_communication_control_hardening.sql",
      ),
      "utf8",
    );

    expect(listPage).toContain("Horario global de comunicaciones");
    expect(listPage).toContain("automation_communication_settings");
    expect(listPage).toContain("saveGlobalCommunicationWindowAction");
    expect(detailPage).toContain("Control de comunicaciones");
    expect(detailPage).toContain("Decisiones de comunicación");
    expect(detailPage).toContain("automation_communication_controls");
    expect(actions).toContain("CAPABILITIES.AUTOMATIONS_MANAGE");
    expect(actions).toContain("automation_send_window_invalid");
    expect(hardening).toContain("automation_communication_settings_nonempty_window_chk");
  });

  it("locks the SQL contract for audited control, windows and deferred revalidation", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919050000_sf167_communication_control.sql"),
      "utf8",
    );

    expect(sql).toContain("automation_communication_priority");
    expect(sql).toContain("automation_communication_decision");
    expect(sql).toContain("automation_communication_controls_immutable");
    expect(sql).toContain("automation_communication_deferred_revalidation_required");
    expect(sql).toContain("system_get_automation_communication_window");
    expect(sql).toContain("global_send_window");
    expect(sql).toContain("service_role");
    expect(sql).toContain("automations.manage");
  });
});
