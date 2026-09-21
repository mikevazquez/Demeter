import { describe, expect, it } from "vitest";

import {
  AsistianMessagingProvider,
  parseAsistianWebhookUrls,
} from "../lib/automations/asistian-provider";
import {
  deliverAutomationMessage,
  type MessagingProviderInput,
} from "../lib/automations/messaging-provider";
import type {
  AutomationInstanceRpcClient,
  AutomationInstanceRpcResult,
} from "../lib/automations/instances";

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

const baseInput: MessagingProviderInput = {
  recipient: "+5213312345678",
  template: "reservation_confirmed",
  variables: {
    nombre: "Ana",
    disciplina: "Pole Fitness",
  },
  executionId: "11111111-1111-1111-1111-111111111111",
  metadata: {
    event_id: "33333333-3333-4333-8333-333333333333",
    catalog_code: "AUT-CAT-01",
  },
};

describe("SF-174 Asistian messaging provider", () => {
  it("parses a template-to-webhook map without exposing URLs in code", () => {
    expect(
      parseAsistianWebhookUrls(
        JSON.stringify({
          reservation_confirmed: "https://example.invalid/hooks/reservation",
          student_welcome: "https://example.invalid/hooks/welcome",
        }),
      ),
    ).toEqual({
      reservation_confirmed: "https://example.invalid/hooks/reservation",
      student_welcome: "https://example.invalid/hooks/welcome",
    });

    expect(() => parseAsistianWebhookUrls(undefined)).toThrow(
      "asistian_webhook_urls_required",
    );
    expect(() =>
      parseAsistianWebhookUrls(
        JSON.stringify({
          reservation_confirmed: "http://example.invalid/hooks/reservation",
        }),
      ),
    ).toThrow("asistian_webhook_https_required");
  });

  it("routes by template and POSTs the normalized payload expected by Studio Flow", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const fetcher: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(null, { status: 204 });
    };

    const provider = new AsistianMessagingProvider({
      webhookUrls: {
        reservation_confirmed: "https://example.invalid/hooks/reservation",
      },
      fetcher,
      now: () => new Date("2026-09-21T06:00:00.000Z"),
    });

    await expect(provider.send(baseInput)).resolves.toMatchObject({
      status: "accepted",
      providerReference: "asistian:33333333-3333-4333-8333-333333333333",
      responseSnapshot: {
        http_status: 204,
        accepted: true,
      },
    });

    expect(capturedUrl).toBe("https://example.invalid/hooks/reservation");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({
      "content-type": "application/json",
      "x-studio-flow-event-id": "33333333-3333-4333-8333-333333333333",
      "x-studio-flow-execution-id": "11111111-1111-1111-1111-111111111111",
    });

    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      event: "reservation_confirmed",
      event_id: "33333333-3333-4333-8333-333333333333",
      timestamp: "2026-09-21T06:00:00.000Z",
      phone: "+5213312345678",
      data: {
        nombre: "Ana",
        disciplina: "Pole Fitness",
      },
      metadata: {
        event_id: "33333333-3333-4333-8333-333333333333",
        catalog_code: "AUT-CAT-01",
        execution_id: "11111111-1111-1111-1111-111111111111",
      },
    });
  });

  it("classifies provider failures for retries", async () => {
    const serverErrorProvider = new AsistianMessagingProvider({
      webhookUrls: {
        reservation_confirmed: "https://example.invalid/hooks/reservation",
      },
      fetcher: (async () => new Response(null, { status: 503 })) as typeof fetch,
    });

    await expect(serverErrorProvider.send(baseInput)).resolves.toMatchObject({
      status: "error",
      errorCode: "asistian_http_503",
      retryable: true,
    });

    const rejectedProvider = new AsistianMessagingProvider({
      webhookUrls: {
        reservation_confirmed: "https://example.invalid/hooks/reservation",
      },
      fetcher: (async () => new Response(null, { status: 400 })) as typeof fetch,
    });

    await expect(rejectedProvider.send(baseInput)).resolves.toMatchObject({
      status: "error",
      errorCode: "asistian_http_400",
      retryable: false,
    });
  });

  it("fails safely when an event has no Asistian webhook configured", async () => {
    const provider = new AsistianMessagingProvider({ webhookUrls: {} });

    await expect(provider.send(baseInput)).resolves.toMatchObject({
      status: "error",
      errorCode: "asistian_webhook_not_configured",
      retryable: false,
    });
  });

  it("sends a sensitive variable to Asistian but redacts it from audit snapshots", async () => {
    const client = new FakeMessagingRpcClient();
    let deliveredSensitiveValue: unknown = null;

    const provider = new AsistianMessagingProvider({
      webhookUrls: {
        student_welcome: "https://example.invalid/hooks/welcome",
      },
      fetcher: (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          data?: Record<string, unknown>;
        };
        deliveredSensitiveValue = body.data?.temporary_password;
        return new Response(null, { status: 202 });
      }) as typeof fetch,
      now: () => new Date("2026-09-21T06:00:00.000Z"),
    });

    await expect(
      deliverAutomationMessage(client, provider, {
        executionId: "11111111-1111-1111-1111-111111111111",
        eligibilityEvaluationId: "44444444-4444-4444-8444-444444444444",
        recipient: "+5213312345678",
        template: "student_welcome",
        variables: {
          nombre: "Ana",
          login_url: "https://example.invalid/login/student",
          temporary_password: "TEMPORARY_TEST_VALUE",
        },
        metadata: {
          event_id: "55555555-5555-4555-8555-555555555555",
          sensitive_variable_keys: ["temporary_password"],
        },
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      providerKey: "asistian",
    });

    expect(deliveredSensitiveValue).toBe("TEMPORARY_TEST_VALUE");

    const sentCall = client.calls.find(
      (call) => call.functionName === "system_mark_automation_execution_sent",
    );
    expect(sentCall?.args).toMatchObject({
      p_request_snapshot: {
        variables: {
          nombre: "Ana",
          login_url: "https://example.invalid/login/student",
          temporary_password: "[REDACTED]",
        },
      },
    });
    expect(JSON.stringify(sentCall?.args)).not.toContain("TEMPORARY_TEST_VALUE");
  });
});
