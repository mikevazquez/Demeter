import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  reconcileRewardCorrection,
  requestRewardReview,
  resolveRewardIncident,
} from "../lib/rewards/incidents";
import type { RewardProgressRpcClient, RewardProgressRpcResult } from "../lib/rewards/progress";

class FakeIncidentRpcClient implements RewardProgressRpcClient {
  readonly calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<RewardProgressRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "system_reconcile_reward_correction") {
      return {
        data: {
          evaluation_id: "evaluation-new",
          previous_fulfilled: true,
          now_fulfilled: false,
          grant_required: false,
          revoked: 1,
          review_incidents: 1,
          critical_incidents: 1,
          unchanged: 0,
        } as T,
        error: null,
      };
    }

    if (functionName === "admin_request_reward_review") {
      return { data: "incident-1" as T, error: null };
    }

    if (functionName === "admin_resolve_reward_incident") {
      return {
        data: {
          incident_id: "incident-1",
          status: "resolved_manual",
          reward_status: "revoked",
        } as T,
        error: null,
      };
    }

    return { data: null, error: { message: "unexpected_rpc:" + functionName } };
  }
}

describe("SF-243 rewards corrections, incidents and audit", () => {
  it("reconciles a correction without reopening redeemed rewards", async () => {
    const client = new FakeIncidentRpcClient();

    await expect(reconcileRewardCorrection(client, "evaluation-new")).resolves.toEqual({
      evaluationId: "evaluation-new",
      previousFulfilled: true,
      nowFulfilled: false,
      grantRequired: false,
      revoked: 1,
      reviewIncidents: 1,
      criticalIncidents: 1,
      unchanged: 0,
    });

    expect(client.calls[0]).toEqual({
      functionName: "system_reconcile_reward_correction",
      args: { p_new_evaluation_id: "evaluation-new" },
    });
  });

  it("routes manual reward adjustment through an incident", async () => {
    const client = new FakeIncidentRpcClient();

    await expect(
      requestRewardReview(client, {
        rewardInstanceId: "reward-1",
        reason: "Corrección de cortesía",
      }),
    ).resolves.toBe("incident-1");

    expect(client.calls[0]?.functionName).toBe("admin_request_reward_review");
  });

  it("requires a reason before resolving an incident", async () => {
    const client = new FakeIncidentRpcClient();

    await expect(
      resolveRewardIncident(client, {
        incidentId: "incident-1",
        action: "revoke_reward",
        reason: "Dato fuente corregido",
      }),
    ).resolves.toEqual({
      incidentId: "incident-1",
      status: "resolved_manual",
      rewardStatus: "revoked",
    });

    await expect(
      resolveRewardIncident(client, {
        incidentId: "incident-1",
        action: "keep_exception",
        reason: "   ",
      }),
    ).rejects.toThrow("reward_incident_reason_required");
  });

  it("locks the database rules for correction and reward states", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919233000_sf243_rewards_incidents.sql"),
      "utf8",
    );

    expect(sql).toContain("reward_incidents_idempotency_unique");
    expect(sql).toContain("reward_reserved_requires_incident_review");
    expect(sql).toContain("reward_redeemed_never_reopened");
    expect(sql).toContain("correction_while_reserved");
    expect(sql).toContain("correction_after_redemption");
    expect(sql).toContain("'critical'");
    expect(sql).toContain("p_new_evaluation_id");
    expect(sql).toContain("v_new.supersedes_evaluation_id");
    expect(sql).toContain("grant_required");
    expect(sql).toContain("admin_resolve_reward_incident");
    expect(sql).toContain("reward_incident_reason_required");
    expect(sql).toContain("insert into public.reward_incident_events");
    expect(sql).not.toContain("status = 'available', redeemed_at = null");
  });

  it("keeps A07 adjustments and A09 resolutions on the audited incident path", () => {
    const profile = readFileSync(
      join(process.cwd(), "app/admin/recompensas/alumnas/[studentId]/page.tsx"),
      "utf8",
    );
    const detail = readFileSync(
      join(process.cwd(), "app/admin/recompensas/incidencias/[incidentId]/page.tsx"),
      "utf8",
    );

    expect(profile).toContain("requestRewardReviewAction");
    expect(profile).toContain("Revisar / ajustar");
    expect(detail).toContain("resolveRewardIncidentAction");
    expect(detail).toContain("Revocar recompensa disponible");
    expect(detail).toContain("nunca reabre ni descanjea");
    expect(detail).toContain("No se puede revocar silenciosamente");
  });
});
