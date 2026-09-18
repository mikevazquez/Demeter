import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  cancelAutomationExecution,
  createAutomationExecution,
  markAutomationExecutionAccepted,
  markAutomationExecutionError,
  markAutomationExecutionSent,
  startAutomationExecutionAttempt,
  suppressAutomationExecution,
} from "../lib/automations/executions";
import type {
  AutomationInstanceRpcClient,
  AutomationInstanceRpcResult,
} from "../lib/automations/instances";

class FakeExecutionRpcClient implements AutomationInstanceRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<AutomationInstanceRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "system_create_automation_execution") {
      return {
        data: {
          execution_id: "11111111-1111-1111-1111-111111111111",
          status: args.p_scheduled_for ? "scheduled" : "eligible",
          created: true,
        } as T,
        error: null,
      };
    }

    if (functionName === "system_start_automation_execution_attempt") {
      return {
        data: {
          attempt_id: "22222222-2222-2222-2222-222222222222",
          attempt_number: 2,
        } as T,
        error: null,
      };
    }

    return { data: undefined as T, error: null };
  }
}

describe("SF-166 automation executions", () => {
  it("creates a stable execution using an eligibility decision and idempotency key", async () => {
    const client = new FakeExecutionRpcClient();

    await expect(
      createAutomationExecution(client, {
        eligibilityEvaluationId: "33333333-3333-3333-3333-333333333333",
        idempotencyKey: "reservation:4444:confirmed",
        dataSnapshot: { reservation_id: "4444" },
        templateSnapshot: { catalog_code: "AUT-CAT-01", catalog_version: 1 },
        variablesSnapshot: { nombre: "Ana" },
      }),
    ).resolves.toEqual({
      executionId: "11111111-1111-1111-1111-111111111111",
      status: "eligible",
      created: true,
    });

    expect(client.calls[0]?.functionName).toBe("system_create_automation_execution");
    expect(client.calls[0]?.args).toMatchObject({
      p_idempotency_key: "reservation:4444:confirmed",
      p_scheduled_for: null,
    });
  });

  it("represents delayed work as scheduled, not as a delivery result", async () => {
    const client = new FakeExecutionRpcClient();

    await expect(
      createAutomationExecution(client, {
        eligibilityEvaluationId: "33333333-3333-3333-3333-333333333333",
        idempotencyKey: "reminder:4444:2h",
        scheduledFor: "2026-09-19T01:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "scheduled",
    });
  });

  it("starts a retry with a new attempt while keeping the same execution", async () => {
    const client = new FakeExecutionRpcClient();

    await expect(
      startAutomationExecutionAttempt(client, {
        executionId: "11111111-1111-1111-1111-111111111111",
        eligibilityEvaluationId: "55555555-5555-5555-5555-555555555555",
      }),
    ).resolves.toEqual({
      attemptId: "22222222-2222-2222-2222-222222222222",
      attemptNumber: 2,
    });

    expect(client.calls[0]?.functionName).toBe("system_start_automation_execution_attempt");
  });

  it("keeps sent and provider accepted as distinct technical states", async () => {
    const client = new FakeExecutionRpcClient();

    await markAutomationExecutionSent(client, {
      attemptId: "22222222-2222-2222-2222-222222222222",
      providerKey: "mock",
      requestSnapshot: { message: "hola" },
    });

    await markAutomationExecutionAccepted(client, {
      attemptId: "22222222-2222-2222-2222-222222222222",
      providerReference: "provider-ref-1",
      responseSnapshot: { accepted: true },
    });

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "system_mark_automation_execution_sent",
      "system_mark_automation_execution_accepted",
    ]);
  });

  it("records retryable errors without creating a second execution", async () => {
    const client = new FakeExecutionRpcClient();

    await markAutomationExecutionError(client, {
      attemptId: "22222222-2222-2222-2222-222222222222",
      errorCode: "provider_timeout",
      errorMessage: "Timeout del proveedor",
      retryable: true,
    });

    expect(client.calls[0]?.args).toMatchObject({
      p_error_code: "provider_timeout",
      p_retryable: true,
    });
  });

  it("supports suppression and eligibility-driven cancellation as different outcomes", async () => {
    const client = new FakeExecutionRpcClient();

    await suppressAutomationExecution(client, {
      executionId: "11111111-1111-1111-1111-111111111111",
      reasonCode: "lower_priority",
      reason: "Otra comunicación domina este contexto.",
    });

    await cancelAutomationExecution(client, {
      executionId: "66666666-6666-6666-6666-666666666666",
      revalidationEvaluationId: "77777777-7777-7777-7777-777777777777",
    });

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "system_suppress_automation_execution",
      "system_cancel_automation_execution",
    ]);
  });

  it("locks the SQL contract for idempotency, retries and auditable history", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260918234000_sf166_automation_executions.sql"),
      "utf8",
    );

    expect(sql).toContain("automation_executions_idempotency_unique");
    expect(sql).toContain("automation_execution_attempts_execution_number_unique");
    expect(sql).toContain("automation_execution_events_immutable");
    expect(sql).toContain("automation_execution_revalidation_required");
    expect(sql).toContain("automation_execution_not_retryable");
    expect(sql).toContain("provider_accepted");
    expect(sql).toContain("no implica entrega ni lectura");
    expect(sql).toContain("system_mark_automation_instance_executed");
    expect(sql).not.toContain("'delivered'");
    expect(sql).not.toContain("'read'");
    expect(sql).not.toContain("business_outcome");
  });
});
