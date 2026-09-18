import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateAutomationEligibility,
  recordAutomationEligibilityEvaluation,
  type AutomationEligibilityCondition,
} from "../lib/automations/eligibility";
import type {
  AutomationInstanceRpcClient,
  AutomationInstanceRpcResult,
} from "../lib/automations/instances";

const ACTIVE_INSTANCE = {
  id: "11111111-1111-1111-1111-111111111111",
  studioId: "22222222-2222-2222-2222-222222222222",
  catalogCode: "AUT-CAT-13" as const,
  status: "active" as const,
  currentVersionNumber: 2,
  eligibleFrom: "2026-09-18T20:00:00.000Z",
};

const CANDIDATE = {
  key: "package:33333333:expiring:5d",
  occurredAt: "2026-09-18T21:00:00.000Z",
  versionNumber: 2,
};

function protectedCondition(
  overrides: Partial<AutomationEligibilityCondition> = {},
): AutomationEligibilityCondition {
  return {
    key: "package.active",
    kind: "protected",
    applies: true,
    passed: true,
    reasonCode: "package_not_active",
    reason: "El paquete ya no está activo.",
    ...overrides,
  };
}

class FakeEligibilityRpcClient implements AutomationInstanceRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<AutomationInstanceRpcResult<T>> {
    this.calls.push({ functionName, args });

    return {
      data: {
        evaluation_id: "44444444-4444-4444-4444-444444444444",
        eligible: false,
        outcome: "cancel",
        exclusion_reasons: [
          {
            condition_key: "package.no_renewal",
            reason_code: "package_already_renewed",
            reason: "La alumna ya renovó.",
          },
        ],
      } as T,
      error: null,
    };
  }
}

describe("SF-165 automation eligibility", () => {
  it("returns proceed when system and applicable domain conditions pass", () => {
    const result = evaluateAutomationEligibility({
      instance: ACTIVE_INSTANCE,
      candidate: CANDIDATE,
      phase: "initial",
      conditions: [
        protectedCondition(),
        protectedCondition({
          key: "package.has_credits",
          reasonCode: "package_without_credits",
          reason: "El paquete ya no tiene créditos.",
        }),
      ],
    });

    expect(result.eligible).toBe(true);
    expect(result.outcome).toBe("proceed");
    expect(result.exclusionReasons).toEqual([]);
    expect(result.conditions.map((condition) => condition.key)).toEqual(
      expect.arrayContaining([
        "instance.active",
        "instance.version_current",
        "instance.temporal_boundary",
        "package.active",
        "package.has_credits",
      ]),
    );
  });

  it("skips an initial candidate when a protected condition fails without classifying it as error", () => {
    const result = evaluateAutomationEligibility({
      instance: ACTIVE_INSTANCE,
      candidate: CANDIDATE,
      phase: "initial",
      conditions: [
        protectedCondition({
          passed: false,
          reasonCode: "payment_not_confirmed",
          reason: "El pago sigue pendiente.",
        }),
      ],
    });

    expect(result.eligible).toBe(false);
    expect(result.outcome).toBe("skip");
    expect(result.exclusionReasons).toEqual([
      {
        conditionKey: "package.active",
        reasonCode: "payment_not_confirmed",
        reason: "El pago sigue pendiente.",
      },
    ]);
    expect("error" in result).toBe(false);
  });

  it("ignores an optional condition that is not applicable", () => {
    const result = evaluateAutomationEligibility({
      instance: ACTIVE_INSTANCE,
      candidate: CANDIDATE,
      phase: "initial",
      conditions: [
        protectedCondition(),
        {
          key: "package.optional_filter",
          kind: "optional",
          applies: false,
          passed: false,
          reasonCode: "optional_filter_not_matched",
          reason: "El filtro opcional no coincide.",
        },
      ],
    });

    expect(result.eligible).toBe(true);
    expect(result.outcome).toBe("proceed");
  });

  it("enforces an optional condition once configured and applicable", () => {
    const result = evaluateAutomationEligibility({
      instance: ACTIVE_INSTANCE,
      candidate: CANDIDATE,
      phase: "initial",
      conditions: [
        {
          key: "package.optional_filter",
          kind: "optional",
          applies: true,
          passed: false,
          reasonCode: "optional_filter_not_matched",
          reason: "El filtro configurado no coincide.",
        },
      ],
    });

    expect(result.eligible).toBe(false);
    expect(result.outcome).toBe("skip");
  });

  it("cancels during revalidation when the business context changed", () => {
    const result = evaluateAutomationEligibility({
      instance: ACTIVE_INSTANCE,
      candidate: CANDIDATE,
      phase: "revalidation",
      conditions: [
        protectedCondition({
          key: "package.no_renewal",
          passed: false,
          reasonCode: "package_already_renewed",
          reason: "La alumna ya renovó.",
        }),
      ],
    });

    expect(result.eligible).toBe(false);
    expect(result.outcome).toBe("cancel");
    expect(result.exclusionReasons[0]?.reasonCode).toBe("package_already_renewed");
  });

  it("blocks paused instances, stale configuration versions and historical backlog", () => {
    const paused = evaluateAutomationEligibility({
      instance: { ...ACTIVE_INSTANCE, status: "paused" },
      candidate: CANDIDATE,
      phase: "initial",
    });
    expect(paused.exclusionReasons.map((reason) => reason.reasonCode)).toContain(
      "instance_not_active",
    );

    const staleVersion = evaluateAutomationEligibility({
      instance: ACTIVE_INSTANCE,
      candidate: { ...CANDIDATE, versionNumber: 1 },
      phase: "revalidation",
    });
    expect(staleVersion.outcome).toBe("cancel");
    expect(staleVersion.exclusionReasons.map((reason) => reason.reasonCode)).toContain(
      "configuration_version_changed",
    );

    const historical = evaluateAutomationEligibility({
      instance: ACTIVE_INSTANCE,
      candidate: { ...CANDIDATE, occurredAt: "2026-09-18T19:59:59.000Z" },
      phase: "initial",
    });
    expect(historical.exclusionReasons.map((reason) => reason.reasonCode)).toContain(
      "candidate_before_eligible_from",
    );
  });

  it("does not allow protected conditions to be disabled", () => {
    expect(() =>
      evaluateAutomationEligibility({
        instance: ACTIVE_INSTANCE,
        candidate: CANDIDATE,
        phase: "initial",
        conditions: [protectedCondition({ applies: false })],
      }),
    ).toThrow("automation_eligibility_protected_condition_must_apply");
  });

  it("maps a revalidation audit record to the service-only RPC", async () => {
    const client = new FakeEligibilityRpcClient();

    await expect(
      recordAutomationEligibilityEvaluation(client, {
        instanceId: ACTIVE_INSTANCE.id,
        versionNumber: 2,
        candidateKey: CANDIDATE.key,
        candidateOccurredAt: CANDIDATE.occurredAt,
        phase: "revalidation",
        conditions: [
          protectedCondition({
            key: "package.no_renewal",
            passed: false,
            reasonCode: "package_already_renewed",
            reason: "La alumna ya renovó.",
          }),
        ],
        subjectEntityType: "product_acquisition",
        subjectEntityId: "33333333-3333-3333-3333-333333333333",
      }),
    ).resolves.toEqual({
      evaluationId: "44444444-4444-4444-4444-444444444444",
      eligible: false,
      outcome: "cancel",
      exclusionReasons: [
        {
          conditionKey: "package.no_renewal",
          reasonCode: "package_already_renewed",
          reason: "La alumna ya renovó.",
        },
      ],
    });

    expect(client.calls[0]?.functionName).toBe("record_automation_eligibility_evaluation");
    expect(client.calls[0]?.args).toMatchObject({
      p_phase: "revalidation",
      p_candidate_key: CANDIDATE.key,
      p_version_number: 2,
    });
  });

  it("locks the SQL audit contract without implementing SF-166 execution history", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260918232500_sf165_automation_eligibility.sql"),
      "utf8",
    );
    const hardening = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260918232600_sf165_automation_eligibility_hardening.sql",
      ),
      "utf8",
    );

    expect(sql).toContain("automation_eligibility_evaluations");
    expect(sql).toContain("append-only eligibility decisions");
    expect(sql).toContain("ineligible is not an error");
    expect(sql).toContain("automation_eligibility_evaluations_immutable");
    expect(sql).toContain("instance_not_active");
    expect(sql).toContain("configuration_version_changed");
    expect(sql).toContain("candidate_before_eligible_from");
    expect(sql).toContain("p_phase = 'revalidation'");
    expect(sql).toContain("v_outcome := 'cancel'");
    expect(sql).toContain(
      "grant execute on function public.record_automation_eligibility_evaluation",
    );
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("automation_executions");
    expect(sql).not.toContain("delivery_status");
    expect(hardening).toContain("v_decision public.automation_eligibility_decision");
    expect(hardening).toContain("'eligible'::public.automation_eligibility_decision");
    expect(hardening).toContain("coalesce(jsonb_typeof(v_condition->'applies'), '')");
  });
});
