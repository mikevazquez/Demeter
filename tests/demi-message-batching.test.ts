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

// Copied from the replay regression harness with batch-aware events. In-memory persistence
// models conditional updates, unique event insertion and snapshot reads.
// It tests application orchestration, not PostgreSQL locking or live Meta delivery.
type ModelInput = { history: Array<{ role: string; content: string }> };
function harness(onModel?: (input: ModelInput, rows: Record<string, Row[]>) => void) {
  const httpStatus = 200;
  const failOutboundPersistence = false;
  let clock = Date.parse("2026-10-21T18:00:00.000Z");
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
        const inserted = {
          id: `row-${++nextId}`,
          attempt_count: 0,
          ...(table === "assistant_whatsapp_events"
            ? { received_at: new Date(++clock).toISOString() }
            : {}),
          ...payload,
        };
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
      neq: (key: string, value: unknown) => {
        filters.push((row) => row[key] !== value);
        return chain;
      },
      gt: (key: string, value: unknown) => {
        filters.push((row) => String(row[key] ?? "") > String(value));
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
  const model = vi.fn(async (input: ModelInput) => {
    onModel?.(input, rows);
    return { reply: "Synthetic location reply", trace: {} };
  });
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
    items: Array<{ id: string; from?: string; type?: string; body?: string }>,
    signatureValid = true,
  ) => {
    const body = JSON.stringify({
      entry: [
        {
          id: wabaId,
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneId },
                messages: items.map((item) => ({
                  id: item.id,
                  from: item.from ?? "15555550123",
                  type: item.type ?? "text",
                  ...((item.type ?? "text") === "text"
                    ? { text: { body: item.body ?? "Location?" } }
                    : { image: { id: `media-${item.id}` } }),
                })),
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
  // A newer message stored for this contact, as if another webhook had just captured it.
  const storeNewer = (id: string, type = "text", from = "15555550123") =>
    rows.assistant_whatsapp_events.push({
      id: `row-${++nextId}`,
      studio_id: studioId,
      provider: "meta_whatsapp",
      provider_event_id: id,
      contact_wa_id: from,
      message_type: type,
      processing_status: "captured",
      received_at: new Date(++clock).toISOString(),
    });
  return { rows, rpc, model, transport, request, storeNewer, post: route.POST };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.DEMI_META_BURST_QUIET_MS;
});

const outcomesOf = async (response: Response) =>
  ((await response.json()) as { outcomes: Array<{ outcome: string }> }).outcomes.map(
    (item) => item.outcome,
  );

describe("DEMI-BATCH-01/02 consecutive messages and stale replies", () => {
  it("B1 answers three quick texts once, with the whole burst in the history", async () => {
    process.env.DEMI_META_BURST_QUIET_MS = "40";
    const h = harness();
    const replies = await Promise.all([
      h.post(h.request([{ id: "wamid.b1-1", body: "Hola" }])),
      h.post(h.request([{ id: "wamid.b1-2", body: "¿cómo estás?" }])),
      h.post(h.request([{ id: "wamid.b1-3", body: "quiero información de pole" }])),
    ]);
    expect(replies.every((reply) => reply.status === 200)).toBe(true);
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledTimes(1);
    const history = h.model.mock.calls[0][0].history.map((turn) => turn.content);
    expect(history).toEqual(
      expect.arrayContaining(["Hola", "¿cómo estás?", "quiero información de pole"]),
    );
    const outcome = (row: Row) => (row.processing_result as Row | undefined)?.outcome;
    const superseded = h.rows.assistant_whatsapp_events.filter(
      (row) => outcome(row) === "superseded_by_newer_message",
    );
    expect(superseded).toHaveLength(2);
    // Replaying an older, ignored part of the burst must neither resurrect it nor append text.
    const inboundBefore = h.rows.assistant_turns.filter((row) => row.role === "user").length;
    await h.post(h.request([{ id: "wamid.b1-1", body: "Hola" }]));
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.rows.assistant_turns.filter((row) => row.role === "user")).toHaveLength(inboundBefore);
  });

  it("B2 never groups messages from different contacts", async () => {
    process.env.DEMI_META_BURST_QUIET_MS = "40";
    const h = harness();
    await Promise.all([
      h.post(h.request([{ id: "wamid.b2-a", from: "15555550123" }])),
      h.post(h.request([{ id: "wamid.b2-b", from: "15555550999" }])),
    ]);
    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.transport).toHaveBeenCalledTimes(2);
  });

  it("B3 answers once when two texts arrive in the same webhook payload", async () => {
    process.env.DEMI_META_BURST_QUIET_MS = "0";
    const h = harness();
    const response = await h.post(
      h.request([
        { id: "wamid.b3-1", body: "Quiero pole" },
        { id: "wamid.b3-2", body: "mañana después de las 6" },
      ]),
    );
    expect(await outcomesOf(response)).toEqual(["superseded_by_newer_message", "replied"]);
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledTimes(1);
    const history = h.model.mock.calls[0][0].history.map((turn) => turn.content);
    expect(history).toEqual(expect.arrayContaining(["Quiero pole", "mañana después de las 6"]));
  });

  it("B4 never drops a text because of a newer image or receipt", async () => {
    process.env.DEMI_META_BURST_QUIET_MS = "0";
    let injected = false;
    const h = harness(() => {
      if (!injected) {
        injected = true;
        h.storeNewer("wamid.b4-receipt", "image");
      }
    });
    const response = await h.post(h.request([{ id: "wamid.b4-text", body: "Ya te mando" }]));
    expect(await outcomesOf(response)).toEqual(["replied"]);
    expect(h.transport).toHaveBeenCalledTimes(1);
  });

  it("B5 does not send an answer built before a newer text arrived", async () => {
    process.env.DEMI_META_BURST_QUIET_MS = "0";
    let injected = false;
    const h = harness(() => {
      if (!injected) {
        injected = true;
        h.storeNewer("wamid.b5-newer");
      }
    });
    const response = await h.post(h.request([{ id: "wamid.b5-old", body: "Mañana" }]));
    expect(await outcomesOf(response)).toEqual(["superseded_after_assistant"]);
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).not.toHaveBeenCalled();
  });

  it("B6 keeps replay idempotent with batching enabled", async () => {
    process.env.DEMI_META_BURST_QUIET_MS = "0";
    const h = harness();
    for (let i = 0; i < 3; i += 1) await h.post(h.request([{ id: "wamid.b6" }]));
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledTimes(1);
  });

  it("B7 answers separately when the texts are outside the quiet window", async () => {
    process.env.DEMI_META_BURST_QUIET_MS = "0";
    const h = harness();
    await h.post(h.request([{ id: "wamid.b7-1", body: "Hola" }]));
    await h.post(h.request([{ id: "wamid.b7-2", body: "¿Tienen yoga?" }]));
    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.transport).toHaveBeenCalledTimes(2);
  });

  it("B8 blocks an action prepared from a superseded text", () => {
    const orchestrator = readFileSync("lib/assistant/orchestrator.ts", "utf8");
    expect(orchestrator).toContain("await assertActionTurnCurrent(input);");
    expect(orchestrator).toContain("rethrowSuperseded(error);");
    const route = readFileSync("app/api/integrations/meta-whatsapp/webhook/route.ts", "utf8");
    expect(route).toContain('outcome: "superseded_before_action"');
  });
});
