import { describe, expect, it, vi } from "vitest";

import {
  canonicalMetaWaId,
  forwardSignedMetaWebhook,
  pilotForwardTarget,
  runPilotDeferredTurn,
  schedulePilotBackground,
} from "../lib/assistant/pilot-forwarding";

describe("Demi pilot webhook forwarding", () => {
  it("normalizes Mexican WhatsApp IDs consistently", () => {
    expect(canonicalMetaWaId("5213323291878")).toBe("523323291878");
    expect(canonicalMetaWaId("+52 33 2329 1878")).toBe("523323291878");
  });

  it("forwards only when every inbound message belongs to the explicit allowlist", () => {
    const targetUrl =
      "https://demi-starter-uat.demeterfitness.com/api/integrations/meta-whatsapp/webhook?studio=9fe23cfa-fb47-4670-afeb-ed4a56433772";
    expect(
      pilotForwardTarget({
        messages: [{ fromWaId: "5213323291878" }],
        targetUrl,
        allowWaIds: "523323291878",
        alreadyForwarded: false,
      }),
    ).toBe(targetUrl);

    expect(
      pilotForwardTarget({
        messages: [{ fromWaId: "5213323291878" }, { fromWaId: "5213311111111" }],
        targetUrl,
        allowWaIds: "523323291878",
        alreadyForwarded: false,
      }),
    ).toBeNull();
  });

  it("does not loop a webhook already forwarded to UAT", () => {
    expect(
      pilotForwardTarget({
        messages: [{ fromWaId: "523323291878" }],
        targetUrl:
          "https://demi-starter-uat.demeterfitness.com/api/integrations/meta-whatsapp/webhook",
        allowWaIds: "523323291878",
        alreadyForwarded: true,
      }),
    ).toBeNull();
  });

  it("rejects unsafe or malformed forward targets", () => {
    expect(
      pilotForwardTarget({
        messages: [{ fromWaId: "523323291878" }],
        targetUrl: "http://example.com/api/integrations/meta-whatsapp/webhook",
        allowWaIds: "523323291878",
        alreadyForwarded: false,
      }),
    ).toBeNull();
    expect(
      pilotForwardTarget({
        messages: [{ fromWaId: "523323291878" }],
        targetUrl: "https://example.com/not-the-webhook",
        allowWaIds: "523323291878",
        alreadyForwarded: false,
      }),
    ).toBeNull();
  });

  it("preserves the signed payload and marks the forwarded request", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe('{"entry":[]}');
      const headers = new Headers(init?.headers);
      expect(headers.get("x-hub-signature-256")).toBe("sha256=test");
      expect(headers.get("x-demi-pilot-forwarded")).toBe("1");
      return new Response("ok", { status: 200 });
    });

    const result = await forwardSignedMetaWebhook({
      targetUrl:
        "https://demi-starter-uat.demeterfitness.com/api/integrations/meta-whatsapp/webhook",
      rawBody: '{"entry":[]}',
      signature: "sha256=test",
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a deferred turn only while it reports a retryable failure", async () => {
    const statuses = [500, 200];
    const attempt = vi.fn(async () => new Response(null, { status: statuses.shift() }));
    const sleep = vi.fn(async () => {});
    expect(await runPilotDeferredTurn(attempt, { sleep })).toEqual({
      ok: true,
      attempts: 2,
      status: 200,
    });
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("stops after the bounded number of attempts", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("synthetic");
    });
    const result = await runPilotDeferredTurn(attempt, { sleep: async () => {} });
    expect(result).toEqual({ ok: false, attempts: 2, status: 500 });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not retry a successful deferred turn", async () => {
    const attempt = vi.fn(async () => new Response(null, { status: 200 }));
    expect((await runPilotDeferredTurn(attempt)).attempts).toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("contains background task errors instead of crashing the request", async () => {
    const tasks: Array<() => Promise<unknown>> = [];
    vi.spyOn(console, "info").mockImplementation(() => {});
    schedulePilotBackground(
      async () => {
        throw new Error("synthetic");
      },
      (task) => tasks.push(task),
    );
    await expect(tasks[0]()).resolves.toBeUndefined();
  });
});
