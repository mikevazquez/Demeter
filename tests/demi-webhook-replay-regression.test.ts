import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demiDeliveryRetryPolicy } from "../lib/assistant/delivery-retry-policy";

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

// In-memory persistence models conditional updates, unique event insertion and snapshot reads.
// It tests application orchestration, not PostgreSQL locking or live Meta delivery.
function harness(httpStatus = 200, failOutboundPersistence = false) {
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
    pilotWaIds: [],
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
  const model = vi.fn(async () => ({ reply: "Synthetic location reply", trace: {} }));
  const supabase = { from, rpc };
  const route = load<Route>("app/api/integrations/meta-whatsapp/webhook/route.ts", {
    "@/lib/assistant/delivery-retry-policy": { demiDeliveryRetryPolicy },
    "@/lib/assistant/orchestrator": { runAssistantTurn: model },
    "@/lib/assistant/runtime-config": {
      loadDemiRuntimeConfig: async () => ({ data: { mode: "active" }, error: null }),
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
      pilotForwardTarget: () => null,
      forwardSignedMetaWebhook: vi.fn(),
    },
    "@/lib/assistant/meta-delivery-status": { extractMetaDeliveryStatuses: () => [] },
    // NEB-01-03 · sin datos de Nébora el webhook no bloquea nada.
    "@/lib/platform/entitlements": { loadStudioEntitlementsService: async () => null },
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
  const request = (id = "wamid.synthetic-inbound", signatureValid = true) => {
    const body = JSON.stringify({
      entry: [
        {
          id: wabaId,
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneId },
                messages: [{ id, from: "15555550123", type: "text", text: { body: "Location?" } }],
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
        headers: { "x-hub-signature-256": `sha256=${signatureValid ? signature : "0".repeat(64)}` },
      },
    );
  };
  return { rows, rpc, model, transport, request, post: route.POST };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Demi signed webhook replay with simulated persistence and real sender", () => {
  it("sends once and ignores three subsequent deliveries of the same inbound event", async () => {
    const h = harness();
    for (let i = 0; i < 4; i += 1) expect((await h.post(h.request())).status).toBe(200);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.rows.assistant_whatsapp_events).toHaveLength(1);
    expect(h.rows.assistant_turns.filter((row) => row.role === "assistant")).toHaveLength(1);
    expect(h.rows.assistant_whatsapp_events[0].processing_status).toBe("processed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([500, 503])(
    "quarantines HTTP %s and never sends again on webhook replay",
    async (status) => {
      const h = harness(status);
      for (let i = 0; i < 4; i += 1) expect((await h.post(h.request())).status).toBe(200);
      expect(h.transport).toHaveBeenCalledTimes(1);
      expect(h.model).toHaveBeenCalledTimes(1);
      expect(h.rows.assistant_whatsapp_events[0]).toMatchObject({
        processing_status: "human_review",
        processing_result: { retryable: false, outcome_unknown: true },
      });
      expect(h.rows.assistant_whatsapp_deliveries).toHaveLength(1);
      expect(h.rows.assistant_turns.filter((row) => row.role === "assistant")).toHaveLength(0);
    },
  );

  it("handles twelve simultaneous copies with one conditional claim and one send", async () => {
    const h = harness();
    const replies = await Promise.all(Array.from({ length: 12 }, () => h.post(h.request())));
    expect(replies.every((reply) => reply.status === 200)).toBe(true);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.rows.assistant_whatsapp_events[0].attempt_count).toBe(1);
  });

  it("does not suppress two distinct inbound events merely because their text matches", async () => {
    const h = harness();
    await Promise.all([
      h.post(h.request("wamid.synthetic-a")),
      h.post(h.request("wamid.synthetic-b")),
    ]);
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(h.rows.assistant_whatsapp_events).toHaveLength(2);
  });

  it("rejects a bad signature before persistence or model execution", async () => {
    const h = harness();
    expect((await h.post(h.request(undefined, false))).status).toBe(401);
    expect(h.rows.assistant_whatsapp_events).toHaveLength(0);
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.model).not.toHaveBeenCalled();
  });

  it("does not resend after accepted delivery followed by failed local persistence", async () => {
    const h = harness(200, true);
    await h.post(h.request());
    expect((await h.post(h.request())).status).toBe(200);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.rows.assistant_whatsapp_events[0]).toMatchObject({
      processing_status: "human_review",
      last_error_code: "reply_persist_failed_after_send",
    });
  });
});
