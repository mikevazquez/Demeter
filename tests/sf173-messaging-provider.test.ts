import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  AutomationInstanceRpcClient,
  AutomationInstanceRpcResult,
} from "../lib/automations/instances";
import {
  deliverAutomationMessage,
  MockMessagingProvider,
  type MessagingProvider,
} from "../lib/automations/messaging-provider";

class FakeMessagingRpcClient implements AutomationInstanceRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<AutomationInstanceRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "system_start_automation_execution_attempt") {
      return {
        data: {
          attempt_id: "22222222-2222-2222-2222-222222222222",
          attempt_number: 1,
        } as T,
        error: null,
      };
    }

    return { data: undefined as T, error: null };
  }
}

const baseInput = {
  executionId: "11111111-1111-1111-1111-111111111111",
  eligibilityEvaluationId: "33333333-3333-3333-3333-333333333333",
  recipient: "+5213312345678",
  template: "reservation_confirmed",
  variables: {
    nombre: "Ana",
    disciplina: "Pole Fitness",
  },
  metadata: {
    catalog_code: "AUT-CAT-01",
  },
};

describe("SF-173 messaging provider", () => {
  it("delivers through the mock provider and persists the normalized request in SF-166", async () => {
    const client = new FakeMessagingRpcClient();
    const provider = new MockMessagingProvider();

    await expect(deliverAutomationMessage(client, provider, baseInput)).resolves.toMatchObject({
      status: "accepted",
      providerKey: "mock",
      attemptId: "22222222-2222-2222-2222-222222222222",
      attemptNumber: 1,
      providerReference: "mock:11111111-1111-1111-1111-111111111111:1",
    });

    expect(provider.deliveries).toEqual([
      {
        deliveryNumber: 1,
        input: {
          recipient: "+5213312345678",
          template: "reservation_confirmed",
          variables: {
            nombre: "Ana",
            disciplina: "Pole Fitness",
          },
          executionId: "11111111-1111-1111-1111-111111111111",
          metadata: {
            catalog_code: "AUT-CAT-01",
          },
        },
      },
    ]);

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "system_start_automation_execution_attempt",
      "system_mark_automation_execution_sent",
      "system_mark_automation_execution_accepted",
    ]);

    expect(client.calls[1]?.args).toMatchObject({
      p_provider_key: "mock",
      p_request_snapshot: {
        recipient: "+5213312345678",
        template: "reservation_confirmed",
        variables: {
          nombre: "Ana",
          disciplina: "Pole Fitness",
        },
        execution_id: "11111111-1111-1111-1111-111111111111",
        metadata: {
          catalog_code: "AUT-CAT-01",
        },
      },
    });
  });

  it("maps a provider error into the existing SF-166 attempt lifecycle", async () => {
    const client = new FakeMessagingRpcClient();
    const provider = new MockMessagingProvider(() => ({
      status: "error",
      errorCode: "mock_rejected",
      errorMessage: "El proveedor rechazó la solicitud.",
      retryable: false,
      responseSnapshot: {
        mock: true,
        accepted: false,
      },
    }));

    await expect(deliverAutomationMessage(client, provider, baseInput)).resolves.toMatchObject({
      status: "error",
      errorCode: "mock_rejected",
      retryable: false,
      providerKey: "mock",
    });

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "system_start_automation_execution_attempt",
      "system_mark_automation_execution_sent",
      "system_mark_automation_execution_error",
    ]);

    expect(client.calls[2]?.args).toMatchObject({
      p_error_code: "mock_rejected",
      p_error_message: "El proveedor rechazó la solicitud.",
      p_retryable: false,
    });
  });

  it("normalizes thrown provider failures as retryable technical errors", async () => {
    const client = new FakeMessagingRpcClient();
    const provider = new MockMessagingProvider(() => {
      throw new Error("mock timeout");
    });

    await expect(deliverAutomationMessage(client, provider, baseInput)).resolves.toMatchObject({
      status: "error",
      errorCode: "provider_exception",
      errorMessage: "mock timeout",
      retryable: true,
    });

    expect(client.calls[2]?.args).toMatchObject({
      p_error_code: "provider_exception",
      p_retryable: true,
    });
  });

  it("can swap providers without changing orchestration or business rules", async () => {
    const client = new FakeMessagingRpcClient();

    const provider: MessagingProvider = {
      key: "second-provider",
      async send(input) {
        return {
          status: "accepted",
          providerReference: `second:${input.executionId}`,
          responseSnapshot: { accepted: true },
        };
      },
    };

    await expect(deliverAutomationMessage(client, provider, baseInput)).resolves.toMatchObject({
      status: "accepted",
      providerKey: "second-provider",
      providerReference: "second:11111111-1111-1111-1111-111111111111",
    });

    expect(client.calls.map((call) => call.functionName)).toEqual([
      "system_start_automation_execution_attempt",
      "system_mark_automation_execution_sent",
      "system_mark_automation_execution_accepted",
    ]);

    expect(client.calls[1]?.args).toMatchObject({
      p_provider_key: "second-provider",
    });
  });

  it("rejects malformed normalized inputs before creating an execution attempt", async () => {
    const client = new FakeMessagingRpcClient();
    const provider = new MockMessagingProvider();

    await expect(
      deliverAutomationMessage(client, provider, {
        ...baseInput,
        recipient: "   ",
      }),
    ).rejects.toThrow("messaging_provider_recipient_required");

    expect(client.calls).toHaveLength(0);
    expect(provider.deliveries).toHaveLength(0);
  });

  it("keeps SF-173 independent from Asistian credentials", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/automations/messaging-provider.ts"),
      "utf8",
    );

    expect(source).not.toContain("ASISTIAN_");
    expect(source).not.toContain("process.env");
    expect(source).toContain("MockMessagingProvider");
    expect(source).toContain("startAutomationExecutionAttempt");
    expect(source).toContain("markAutomationExecutionSent");
  });
});
