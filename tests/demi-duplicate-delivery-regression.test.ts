import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demiDeliveryRetryPolicy } from "../lib/assistant/delivery-retry-policy";
import type {
  MetaTextDeliveryResult,
  MetaWhatsAppWebhookConfig,
  sendMetaWhatsAppText,
} from "../lib/assistant/meta-whatsapp-channel";

const config: MetaWhatsAppWebhookConfig = {
  accessToken: "synthetic-not-a-credential",
  phoneNumberId: "100000000000001",
  wabaId: "100000000000002",
  graphApiVersion: "v23.0",
  appSecret: "synthetic-secret",
  verifyToken: "synthetic-verify",
  pilotWaIds: [],
  languageCode: "es_MX",
  countryCallingCode: "52",
  templates: {},
};

// Execute the complete repository module; replace only external dependencies and transport.
function loadSender() {
  const loadedModule = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync("lib/assistant/meta-whatsapp-channel.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
    }).code,
  )(
    (name: string) => {
      if (name === "server-only") return {};
      if (name === "node:crypto") return crypto;
      if (name === "./uat-scope") {
        return { demiUatScope: () => null, captureDemiUatText: async () => null };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
    loadedModule,
    loadedModule.exports,
  );
  return (loadedModule.exports as { sendMetaWhatsAppText: typeof sendMetaWhatsAppText })
    .sendMetaWhatsAppText;
}

function send(fetcher: typeof fetch, overrides: { recipientWaId?: string; text?: string } = {}) {
  return loadSender()({
    config,
    recipientWaId: "15555550123",
    text: "Synthetic studio location",
    ...overrides,
    fetcher,
  });
}

async function settle<T>(promise: Promise<T>) {
  await vi.runAllTimersAsync();
  return promise;
}

function policy(result: MetaTextDeliveryResult) {
  if (result.status !== "error") throw new Error("Expected a delivery error");
  return demiDeliveryRetryPolicy({
    errorCode: result.errorCode,
    retryable: result.retryable,
    attempt: 1,
    limit: 3,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Real outbound transport is forbidden in this test");
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Demi duplicate delivery regression: actual sender and retry policy", () => {
  it.each([408, 500, 502, 503, 504])("does not resend after HTTP %s", async (status) => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ error: { code: 131000, message: "Synthetic provider error" } }, { status }),
    );
    const result = await settle(send(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "error", httpStatus: status });
    expect(policy(result)).toMatchObject({
      retryAllowed: false,
      requiresReview: true,
      outcomeUnknown: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the successful one-message path and returned provider ID", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ messages: [{ id: "wamid.synthetic-accepted" }] }),
    );
    const result = await settle(send(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "accepted",
      providerMessageId: "wamid.synthetic-accepted",
      httpStatus: 200,
    });
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.text.body).toBe("Synthetic studio location");
  });

  it("still recovers from two explicit rate limits", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: "wamid.synthetic-recovered" }] }));
    expect(await settle(send(request))).toMatchObject({ status: "accepted" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when a 429 retry encounters a 500", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const result = await settle(send(request));
    expect(request).toHaveBeenCalledTimes(2);
    expect(policy(result).retryAllowed).toBe(false);
  });

  it("bounds persistent rate limiting and preserves the outer attempt limit", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 429 }));
    const result = await settle(send(request));
    expect(request).toHaveBeenCalledTimes(5);
    expect(policy(result)).toMatchObject({ retryAllowed: true, outcomeUnknown: false });
    expect(
      demiDeliveryRetryPolicy({
        errorCode: "meta_whatsapp_http_429",
        retryable: true,
        attempt: 3,
        limit: 3,
      }).retryAllowed,
    ).toBe(false);
  });

  it.each([400, 401, 403])("does not resend a terminal HTTP %s rejection", async (status) => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    const result = await settle(send(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(policy(result)).toMatchObject({ retryAllowed: false, requiresReview: true });
  });

  it.each(["{}", "not json"])("treats successful HTTP without a message ID as unknown: %s", async (body) => {
    const request = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
    const result = await settle(send(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(policy(result)).toMatchObject({ retryAllowed: false, outcomeUnknown: true });
  });

  it("does not resend on network failure", async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Synthetic lost response");
    });
    const result = await settle(send(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(policy(result)).toMatchObject({ retryAllowed: false, outcomeUnknown: true });
  });

  it("aborts a timed-out request without sending another message", async () => {
    const request = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("Synthetic timeout");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const result = await settle(send(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ errorCode: "meta_whatsapp_timeout" });
    expect(policy(result)).toMatchObject({ retryAllowed: false, outcomeUnknown: true });
  });

  it.each([{ text: " " }, { recipientWaId: "invalid" }])("rejects invalid input before transport: %j", async (overrides) => {
    const request = vi.fn<typeof fetch>();
    expect(await settle(send(request, overrides))).toMatchObject({ status: "error", retryable: false });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    "meta_whatsapp_http_500",
    "meta_whatsapp_http_503",
    "meta_inbox_http_500",
    "meta_inbox_http_504",
    "meta_whatsapp_retry_exhausted",
    "meta_inbox_retry_exhausted",
  ])("blocks an ambiguous outer replay even with retryable=false: %s", (errorCode) => {
    expect(
      demiDeliveryRetryPolicy({ errorCode, retryable: false, attempt: 1, limit: 3 }),
    ).toMatchObject({ retryAllowed: false, requiresReview: true, outcomeUnknown: true });
  });
});
