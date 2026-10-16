import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  client: null as unknown,
  run: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => mocks.client }));
vi.mock("@/lib/assistant/orchestrator", () => ({ runAssistantTurn: mocks.run }));
vi.mock("@/lib/assistant/runtime-config", () => ({
  loadDemiRuntimeConfig: async () => ({ data: { mode: "active" }, error: null }),
}));
vi.mock("@/lib/assistant/meta-whatsapp-channel", async (original) => ({
  ...(await original<typeof import("../lib/assistant/meta-whatsapp-channel")>()),
  loadMetaWhatsAppWebhookConfig: async () => ({ phoneNumberId: "phone", wabaId: "waba" }),
  verifyMetaWebhookSignature: () => true,
  sendMetaWhatsAppText: mocks.send,
}));

import { POST } from "../app/api/integrations/meta-whatsapp/webhook/route";

type Row = Record<string, unknown>;
const studioId = "11111111-1111-4111-8111-111111111111";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function database(onPrepared?: (providerId: unknown) => Promise<void>) {
  const rows: Record<string, Row[]> = {
    studios: [{ id: studioId }],
    assistant_whatsapp_events: [],
    assistant_turns: [],
    assistant_whatsapp_deliveries: [],
    assistant_conversations: [{ id: "conversation" }],
    assistant_learning_proposals: [],
    assistant_pending_actions: [],
  };
  let sequence = 0;
  let failOrderLookup = false;
  const client = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const orders: Array<{ key: string; ascending: boolean }> = [];
      let limit = Infinity;
      let patch: Row | undefined;
      let insertion: Row | undefined;
      let columns = "*";
      function execute() {
        const data = (rows[table] ??= []);
        if (failOrderLookup && table === "assistant_whatsapp_events" && columns === "id" && !patch)
          return { data: null, error: { message: "unavailable" } };
        if (insertion) {
          if (
            table === "assistant_whatsapp_events" &&
            data.some((row) => row.provider_event_id === insertion!.provider_event_id)
          )
            return { data: null, error: { code: "23505" } };
          const time = new Date(Date.UTC(2026, 9, 16, 12, 0, sequence)).toISOString();
          const row = {
            id: `row-${++sequence}`,
            received_at: time,
            created_at: time,
            attempt_count: 0,
            processing_result: {},
            ...insertion,
          };
          data.push(row);
          return { data: [{ ...row }], error: null };
        }
        let result = data.filter((row) => filters.every((filter) => filter(row)));
        if (patch) result.forEach((row) => Object.assign(row, patch));
        result = [...result].sort((a, b) => {
          for (const order of orders) {
            const comparison = String(a[order.key]).localeCompare(String(b[order.key]));
            if (comparison) return order.ascending ? comparison : -comparison;
          }
          return 0;
        });
        return { data: result.slice(0, limit).map((row) => ({ ...row })), error: null };
      }
      const query = {
        select(value: string) {
          columns = value;
          return query;
        },
        insert(value: Row) {
          insertion = value;
          return query;
        },
        update(value: Row) {
          patch = value;
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        not(key: string) {
          filters.push((row) => row[key] != null);
          return query;
        },
        order(key: string, options: { ascending: boolean }) {
          orders.push({ key, ascending: options.ascending });
          return query;
        },
        limit(value: number) {
          limit = value;
          return query;
        },
        async maybeSingle() {
          const result = execute();
          return { ...result, data: result.data?.[0] ?? null };
        },
        single() {
          return query.maybeSingle();
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(execute()).then(resolve);
        },
      };
      return query;
    },
    async rpc(name: string, args: Row) {
      if (name !== "service_prepare_meta_whatsapp_message") throw new Error(name);
      const event = rows.assistant_whatsapp_events.find((row) => row.id === args.target_event_id)!;
      const turn = { id: `turn-${++sequence}`, role: "user", content: args.target_message_text };
      rows.assistant_turns.push({
        ...turn,
        studio_id: studioId,
        conversation_id: "conversation",
        created_at: new Date(Date.UTC(2026, 9, 16, 12, 0, sequence)).toISOString(),
      });
      Object.assign(event, { assistant_conversation_id: "conversation", inbound_turn_id: turn.id });
      await onPrepared?.(args.target_provider_message_id);
      return {
        data: { ok: true, assistant_conversation_id: "conversation", inbound_turn_id: turn.id },
        error: null,
      };
    },
  };
  return { client, rows, failOrderLookup: () => (failOrderLookup = true) };
}

function request(id: string, text: string) {
  return new Request(
    `https://example.test/api/integrations/meta-whatsapp/webhook?studio=${studioId}`,
    {
      method: "POST",
      body: JSON.stringify({
        entry: [
          {
            id: "waba",
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "phone" },
                  messages: [{ id, from: "523300000000", type: "text", text: { body: text } }],
                },
              },
            ],
          },
        ],
      }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockImplementation(async () => ({
    status: "accepted",
    providerMessageId: "outbound",
    httpStatus: 200,
    responseSnapshot: {},
  }));
});

describe("concurrent WhatsApp text replies", () => {
  it("does not generate another answer when a newer text is already prepared", async () => {
    const prepared = deferred();
    const release = deferred();
    const db = database(async (providerId) => {
      if (providerId === "first") {
        prepared.resolve();
        await release.promise;
      }
    });
    mocks.client = db.client;
    mocks.run.mockResolvedValue({ reply: "Respuesta completa", trace: { toolCalls: [] } });
    const older = POST(request("first", "Quiero información"));
    await prepared.promise;
    await POST(request("second", "Sobre Pole"));
    release.resolve();
    expect((await older).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("discards an older in-flight reply and sends only the newest reply with both messages in context", async () => {
    const db = database();
    mocks.client = db.client;
    const started = deferred();
    const release = deferred();
    mocks.run
      .mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
        return { reply: "Respuesta anterior", trace: { toolCalls: [] } };
      })
      .mockResolvedValueOnce({ reply: "Respuesta completa", trace: { toolCalls: [] } });

    const older = POST(request("first", "Quiero información"));
    await started.promise;
    const latest = await POST(request("second", "Sobre Pole por la tarde"));
    release.resolve();
    const earlier = await older;

    expect(latest.status).toBe(200);
    expect(earlier.status).toBe(200);
    expect(mocks.run.mock.calls[1][0].history.map((row: Row) => row.content)).toEqual([
      "Quiero información",
      "Sobre Pole por la tarde",
    ]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].text).toBe("Respuesta completa");
    expect(db.rows.assistant_whatsapp_events[0]).toMatchObject({
      processing_status: "ignored",
      processing_result: { outcome: "superseded_by_newer_text" },
    });
    expect(db.rows.assistant_whatsapp_deliveries).toHaveLength(1);

    await POST(request("first", "Quiero información"));
    await POST(request("second", "Sobre Pole por la tarde"));
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("does not suppress an ordinary single message", async () => {
    mocks.client = database().client;
    mocks.run.mockResolvedValue({ reply: "Hola", trace: { toolCalls: [] } });
    expect((await POST(request("single", "Hola"))).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("does not replace a text answer with a media acknowledgement or another conversation", async () => {
    const db = database();
    mocks.client = db.client;
    mocks.run.mockImplementation(async () => {
      const base = {
        studio_id: studioId,
        provider: "meta_whatsapp",
        assistant_conversation_id: "conversation",
        inbound_turn_id: "later-turn",
        message_type: "text",
        received_at: "2026-10-16T13:00:00Z",
      };
      db.rows.assistant_whatsapp_events.push(
        { ...base, id: "media", message_type: "image" },
        { ...base, id: "another-studio", studio_id: "other" },
        { ...base, id: "another-conversation", assistant_conversation_id: "other" },
        { ...base, id: "unprepared", inbound_turn_id: null },
      );
      return { reply: "Hola", trace: { toolCalls: [] } };
    });
    expect((await POST(request("single", "Hola"))).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("preserves a completed booking confirmation even when a newer text arrives", async () => {
    const db = database();
    mocks.client = db.client;
    const started = deferred();
    const release = deferred();
    mocks.run
      .mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
        return {
          reply: "Tu reserva está confirmada",
          trace: { toolCalls: [{ name: "execute_booking", status: "executed" }] },
        };
      })
      .mockResolvedValueOnce({ reply: "Con gusto", trace: { toolCalls: [] } });

    const booking = POST(request("booking", "Confirmo la reserva"));
    await started.promise;
    await POST(request("thanks", "Gracias"));
    release.resolve();
    expect((await booking).status).toBe(200);
    expect(mocks.send.mock.calls.map(([input]) => input.text)).toContain(
      "Tu reserva está confirmada",
    );
    expect(db.rows.assistant_whatsapp_events[0].processing_status).toBe("processed");
  });

  it("fails closed when the turn order cannot be checked before generation", async () => {
    const db = database();
    mocks.client = db.client;
    db.failOrderLookup();
    expect((await POST(request("single", "Hola"))).status).toBe(500);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("caches a generated reply if the final order check fails and retries delivery without rerunning actions", async () => {
    const db = database();
    mocks.client = db.client;
    mocks.run.mockImplementation(async () => {
      db.failOrderLookup();
      return { reply: "Tu reserva está confirmada", trace: { toolCalls: [] } };
    });
    expect((await POST(request("booking", "Confirmo"))).status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(db.rows.assistant_whatsapp_events[0].processing_result).toMatchObject({
      cached_reply: "Tu reserva está confirmada",
    });
    expect((await POST(request("booking", "Confirmo"))).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
