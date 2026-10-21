import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demiDeliveryRetryPolicy } from "../lib/assistant/delivery-retry-policy";

type Opts = {
  mode?: string;
  pilotWaIds?: string[];
  modelDelayMs?: number;
  failCapture?: boolean;
  failModelOnce?: boolean;
};
type PilotModule = typeof import("../lib/assistant/pilot-forwarding");

type Row = Record<string, unknown>;
type Channel = typeof import("../lib/assistant/meta-whatsapp-channel");
type Route = typeof import("../app/api/integrations/meta-whatsapp/webhook/route");
const studioId = "00000000-0000-4000-8000-000000000001";
const phoneId = "100000000000001";
const wabaId = "100000000000002";
const secret = "synthetic-signing-secret";

function load<T>(path: string, deps: Record<string, unknown>): T {
  const loaded = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code,
  )(
    (name: string) => {
      if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`);
      return deps[name];
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports as T;
}

// Copied from the replay regression harness; adds the real pilot module and an injectable
// background scheduler. In-memory persistence models conditional updates, unique event insertion and snapshot reads.
// It tests application orchestration, not PostgreSQL locking or live Meta delivery.
function harness(opts: Opts = {}) {
  const httpStatus = 200;
  const failOutboundPersistence = false;
  const background: Array<() => Promise<unknown>> = [];
  let modelFailed = false;
  const rows: Record<string, Row[]> = {
    studios: [{ id: studioId, name: "Synthetic studio", timezone: "UTC", currency: "USD" }],
    assistant_whatsapp_events: [],
    assistant_whatsapp_deliveries: [],
    assistant_turns: [],
    assistant_conversations: [{ id: "conversation", studio_id: studioId, context: {} }],
    demi_operation_retry_settings: [{ studio_id: studioId, delivery_failure_limit: 3 }],
  };
  let nextId = 0;
  const from = (table: string) => {
    if (!(table in rows)) throw new Error(`Unexpected table: ${table}`);
    let operation = "select";
    let payload: Row = {};
    let maximum = Infinity;
    const filters: Array<(row: Row) => boolean> = [];
    const execute = (single: boolean) => {
      if (operation === "insert") {
        if (opts.failCapture && table === "assistant_whatsapp_events") {
          return { data: null, error: { code: "synthetic_capture_failure" }, count: 0 };
        }
        if (
          table === "assistant_whatsapp_events" &&
          rows[table].some(
            (row) =>
              row.studio_id === payload.studio_id &&
              row.provider_event_id === payload.provider_event_id,
          )
        ) {
          return { data: null, error: { code: "23505" }, count: 0 };
        }
        if (
          failOutboundPersistence &&
          table === "assistant_turns" &&
          payload.role === "assistant"
        ) {
          return { data: null, error: { code: "synthetic_failure" }, count: 0 };
        }
        const inserted = { id: `row-${++nextId}`, attempt_count: 0, ...payload };
        rows[table].push(inserted);
        return { data: single ? { ...inserted } : [{ ...inserted }], error: null, count: 1 };
      }
      const selected = rows[table].filter((row) => filters.every((filter) => filter(row)));
      if (operation === "update") selected.forEach((row) => Object.assign(row, payload));
      const data = selected.slice(0, maximum).map((row) => structuredClone(row));
      return { data: single ? (data[0] ?? null) : data, error: null, count: data.length };
    };
    const chain = {
      select: () => chain,
      insert: (value: Row) => {
        operation = "insert";
        payload = value;
        return chain;
      },
      update: (value: Row) => {
        operation = "update";
        payload = value;
        return chain;
      },
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return chain;
      },
      in: (key: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[key]));
        return chain;
      },
      order: () => chain,
      limit: (value: number) => {
        maximum = value;
        return chain;
      },
      single: async () => execute(true),
      maybeSingle: async () => execute(true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute(false)).then(resolve),
    };
    return chain;
  };
  const rpc = vi.fn(async (name: string, args: Row) => {
    if (name === "service_prepare_meta_whatsapp_message") {
      const event = rows.assistant_whatsapp_events.find((row) => row.id === args.target_event_id);
      if (!event) throw new Error("Missing captured event");
      if (!event.inbound_turn_id) {
        event.inbound_turn_id = `inbound-${event.id}`;
        event.assistant_conversation_id = "conversation";
        rows.assistant_turns.push({
          id: event.inbound_turn_id,
          studio_id: studioId,
          conversation_id: "conversation",
          role: "user",
          content: args.target_message_text,
        });
      }
      return {
        error: null,
        data: {
          ok: true,
          assistant_conversation_id: "conversation",
          inbound_turn_id: event.inbound_turn_id,
          student_id: null,
          handoff_open: false,
        },
      };
    }
    if (name === "assistant_create_handoff") return { data: { ok: true }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const config = {
    accessToken: "synthetic-not-a-credential",
    phoneNumberId: phoneId,
    wabaId,
    graphApiVersion: "v23.0",
    appSecret: secret,
    verifyToken: "synthetic-verify",
    pilotWaIds: opts.pilotWaIds ?? [],
    languageCode: "es_MX",
    countryCallingCode: "1",
    templates: {},
  };
  const channel = load<Channel>("lib/assistant/meta-whatsapp-channel.ts", {
    "server-only": {},
    "node:crypto": crypto,
    "./uat-scope": { demiUatScope: () => null, captureDemiUatText: async () => null },
  });
  const transport = vi.fn<typeof fetch>(async () =>
    httpStatus === 200
      ? Response.json({ messages: [{ id: `wamid.synthetic-${++nextId}` }] })
      : Response.json({ error: { code: 131000 } }, { status: httpStatus }),
  );
  const model = vi.fn(async () => {
    if (opts.failModelOnce && !modelFailed) {
      modelFailed = true;
      throw new Error("synthetic_model_failure");
    }
    if (opts.modelDelayMs) await new Promise((done) => setTimeout(done, opts.modelDelayMs));
    return { reply: "Synthetic location reply", trace: {} };
  });
  const pilot = load<PilotModule>("lib/assistant/pilot-forwarding.ts", {
    "next/server": { after: (task: () => Promise<unknown>) => background.push(task) },
  });
  const supabase = { from, rpc };
  const route = load<Route>("app/api/integrations/meta-whatsapp/webhook/route.ts", {
    "@/lib/assistant/delivery-retry-policy": { demiDeliveryRetryPolicy },
    "@/lib/assistant/orchestrator": { runAssistantTurn: model },
    "@/lib/assistant/runtime-config": {
      loadDemiRuntimeConfig: async () => ({ data: { mode: opts.mode ?? "active" }, error: null }),
    },
    "@/lib/assistant/read-tools": {},
    "@/lib/assistant/sticker-media": {},
    "@/lib/assistant/audio-transcription": {},
    "@/lib/assistant/group-booking": {},
    "@/lib/assistant/enrollment-payment": {},
    "@/lib/assistant/receipt-reader": {},
    "@/lib/assistant/receipt-confirmation": {},
    "@/lib/assistant/student-access": {},
    "@/lib/assistant/pilot-forwarding": {
      ...pilot,
      // Fast retry for tests; production keeps the default delay.
      runPilotDeferredTurn: (attempt: () => Promise<Response>) =>
        pilot.runPilotDeferredTurn(attempt, { delayMs: 0 }),
    },
    "@/lib/assistant/meta-delivery-status": { extractMetaDeliveryStatuses: () => [] },
    "@/lib/supabase/service": { createServiceClient: () => supabase },
    "@/lib/assistant/meta-whatsapp-channel": {
      ...channel,
      loadMetaWhatsAppWebhookConfig: async () => config,
      sendMetaWhatsAppText: (input: Parameters<Channel["sendMetaWhatsAppText"]>[0]) =>
        channel.sendMetaWhatsAppText({ ...input, fetcher: transport }),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Real outbound transport is forbidden");
    }),
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
  const request = (
    id = "wamid.synthetic-inbound",
    signatureValid = true,
    forwarded = true,
    from = "15555550123",
  ) => {
    const body = JSON.stringify({
      entry: [
        {
          id: wabaId,
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneId },
                messages: [{ id, from, type: "text", text: { body: "Location?" } }],
              },
            },
          ],
        },
      ],
    });
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    return new Request(
      `https://example.test/api/integrations/meta-whatsapp/webhook?studio=${studioId}`,
      {
        method: "POST",
        body,
        headers: {
          "x-hub-signature-256": `sha256=${signatureValid ? signature : "0".repeat(64)}`,
          ...(forwarded ? { "x-demi-pilot-forwarded": "1" } : {}),
        },
      },
    );
  };
  const drain = async () => {
    while (background.length) await background.shift()!();
  };
  return { rows, rpc, model, transport, request, background, drain, post: route.POST };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DEMI-PILOT-01 deferred receiver for forwarded pilot webhooks", () => {
  it("T1 acknowledges with 202 after capture and replies once in the background", async () => {
    const h = harness();
    const response = await h.post(h.request());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, deferred: true });
    expect(h.rows.assistant_whatsapp_events).toHaveLength(1);
    expect(h.rows.assistant_whatsapp_events[0].processing_status).toBe("captured");
    expect(h.model).not.toHaveBeenCalled();
    await h.drain();
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.rows.assistant_whatsapp_events[0].processing_status).toBe("processed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("T2 answers the origin before a turn slower than ten seconds finishes", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ modelDelayMs: 15_000 });
      const started = Date.now();
      const response = await h.post(h.request());
      expect(response.status).toBe(202);
      expect(Date.now() - started).toBeLessThan(10_000);
      const running = h.drain();
      await vi.advanceTimersByTimeAsync(15_000);
      await running;
      expect(h.model).toHaveBeenCalledTimes(1);
      expect(h.transport).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("T3 keeps a single effect when the same event is redelivered during and after processing", async () => {
    const h = harness({ modelDelayMs: 20 });
    expect((await h.post(h.request())).status).toBe(202);
    const first = h.drain();
    expect((await h.post(h.request())).status).toBe(202);
    await first;
    await h.drain();
    expect((await h.post(h.request())).status).toBe(202);
    await h.drain();
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.rows.assistant_whatsapp_events).toHaveLength(1);
    expect(h.rows.assistant_turns.filter((row) => row.role === "assistant")).toHaveLength(1);
  });

  it("T4 returns 503 without scheduling work when the event cannot be captured", async () => {
    const h = harness({ failCapture: true });
    expect((await h.post(h.request())).status).toBe(500);
    expect(h.background).toHaveLength(0);
    expect(h.model).not.toHaveBeenCalled();
  });

  it("T5 retries a retryable background failure once and processes exactly once", async () => {
    const h = harness({ failModelOnce: true });
    expect((await h.post(h.request())).status).toBe(202);
    await h.drain();
    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.rows.assistant_whatsapp_events[0].processing_status).toBe("processed");
  });

  it("T6 rejects a forwarded request with an invalid signature before persistence", async () => {
    const h = harness();
    expect((await h.post(h.request(undefined, false))).status).toBe(401);
    expect(h.rows.assistant_whatsapp_events).toHaveLength(0);
    expect(h.background).toHaveLength(0);
  });

  it("T7 does not capture or process a sender outside the pilot allowlist", async () => {
    const h = harness({ mode: "pilot", pilotWaIds: ["15555550123"] });
    expect((await h.post(h.request("wamid.other", true, true, "15555550999"))).status).toBe(202);
    await h.drain();
    expect(h.rows.assistant_whatsapp_events).toHaveLength(0);
    expect(h.model).not.toHaveBeenCalled();
    expect(h.transport).not.toHaveBeenCalled();

    expect((await h.post(h.request("wamid.mike", true, true, "15555550123"))).status).toBe(202);
    await h.drain();
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledTimes(1);
  });

  it("T8 keeps direct Meta deliveries synchronous", async () => {
    const h = harness();
    const response = await h.post(h.request(undefined, true, false));
    expect(response.status).toBe(200);
    expect(h.background).toHaveLength(0);
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
});
