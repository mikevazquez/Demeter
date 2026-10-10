import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { transformSync } from "esbuild";
import { describe, it, expect, vi } from "vitest";
function load() {
  const m = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync("lib/assistant/whatsapp-pilot-relay.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
    }).code,
  )(
    (name: string) => {
      if (name === "server-only") return {};
      if (name === "node:crypto") return crypto;
      throw Error(name);
    },
    m,
    m.exports,
  );
  return m.exports as typeof import("../lib/assistant/whatsapp-pilot-relay");
}
const config = {
  enabled: true,
  studioId: "f1d69ae2-84c5-4b76-b77c-d792c9318225",
  wabaId: "business",
  phoneNumberId: "sender",
};
type TestValue = {
  metadata?: { phone_number_id: string };
  messages?: Record<string, unknown>[];
  contacts?: { wa_id: string; profile: { name: string } }[];
  statuses?: Record<string, unknown>[];
  errors?: Record<string, unknown>[];
  unchanged?: boolean;
};
type TestEnvelope = {
  object: string;
  entry: { id: string; changes: { field: string; value: TestValue }[] }[];
};
function value(packet: unknown): TestValue {
  return (packet as TestEnvelope).entry[0].changes[0].value;
}
function body(): TestEnvelope {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "sender" },
              messages: [
                { id: "pilot-1", from: "523323291878", type: "audio", audio: { id: "media" } },
                {
                  id: "customer-1",
                  from: "529998887777",
                  type: "text",
                  text: { body: "Customer" },
                },
              ],
              contacts: [
                { wa_id: "523323291878", profile: { name: "Pilot" } },
                { wa_id: "529998887777", profile: { name: "Customer" } },
              ],
              statuses: [
                { id: "pilot-out", recipient_id: "5213323291878", status: "delivered" },
                { id: "customer-out", recipient_id: "529998887777", status: "read" },
              ],
              errors: [{ code: 123 }],
            },
          },
          { field: "account_update", value: { unchanged: true } },
        ],
      },
      {
        id: "other-business",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "sender" },
              messages: [{ from: "523323291878" }],
            },
          },
        ],
      },
    ],
  };
}
describe("Production WhatsApp pilot relay", () => {
  it("processes ordinary customers even when Sandbox rejects the pilot and asks Meta to retry", async () => {
    const h = load();
    const p = h.partitionWhatsAppPilot(body(), config)!;
    const production = vi.fn(async () => Response.json({ ok: true }));
    const fetcher = vi.fn(async () => Response.json({ ok: false }, { status: 503 }));
    const response = await h.dispatchWhatsAppPilot(p, "secret", production, fetcher);
    expect(production).toHaveBeenCalledWith(p.productionBody);
    expect(response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves the production handler response when forwarding succeeds", async () => {
    const h = load();
    const p = h.partitionWhatsAppPilot(body(), config)!;
    const expected = Response.json({ ok: true }, { status: 202 });
    expect(
      await h.dispatchWhatsAppPilot(
        p,
        "secret",
        async () => expected,
        async () => Response.json({ ok: true }),
      ),
    ).toBe(expected);
  });

  it("is disabled by default and only runs for the authorized production studio", () => {
    expect(load().partitionWhatsAppPilot(body(), { ...config, enabled: false })).toBeNull();
    expect(load().partitionWhatsAppPilot(body(), { ...config, studioId: "other" })).toBeNull();
  });
  it("requires the configured business and sender account", () => {
    expect(load().partitionWhatsAppPilot(body(), { ...config, wabaId: "wrong" })).toBeNull();
    expect(load().partitionWhatsAppPilot(body(), { ...config, phoneNumberId: "wrong" })).toBeNull();
  });
  it("separates mixed messages, contacts and receipts without altering the original or other customers", () => {
    const input = body(),
      before = structuredClone(input);
    const p = load().partitionWhatsAppPilot(input, config)!;
    expect(input).toEqual(before);
    expect(p.records).toBe(2);
    const pilot = value(p.pilotBody);
    expect(pilot.messages).toEqual([before.entry[0].changes[0].value.messages![0]]);
    expect(pilot.statuses).toEqual([before.entry[0].changes[0].value.statuses![0]]);
    expect(pilot.contacts!.map((c) => c.wa_id)).toEqual(["523323291878"]);
    expect(pilot.errors).toBeUndefined();
    const prod = value(p.productionBody);
    expect(prod.messages).toEqual([before.entry[0].changes[0].value.messages![1]]);
    expect(prod.statuses).toEqual([before.entry[0].changes[0].value.statuses![1]]);
    expect(prod.contacts!.map((c) => c.wa_id)).toEqual(["529998887777"]);
    expect(prod.errors).toEqual(before.entry[0].changes[0].value.errors);
    expect((p.productionBody as TestEnvelope).entry[0].changes[1]).toEqual(
      before.entry[0].changes[1],
    );
    expect(p.productionBody.entry[1]).toEqual(before.entry[1]);
    // The ordinary production handler does not relay a second time.
    expect(load().partitionWhatsAppPilot(p.productionBody, config)).toBeNull();
  });
  it("does not forward similar numbers or messages without a pilot record", () => {
    const input = body();
    input.entry = input.entry.slice(0, 1);
    const v = input.entry[0].changes[0].value;
    v.messages = [{ id: "other", from: "523323291879", type: "text", text: { body: "Other" } }];
    v.statuses = [];
    expect(load().partitionWhatsAppPilot(input, config)).toBeNull();
  });
  it("forwards only to the fixed Sandbox URL with a fresh signature and preserves provider IDs", async () => {
    const packet = load().partitionWhatsAppPilot(body(), config)!.pilotBody;
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    expect(await load().forwardWhatsAppPilot(packet, "secret", fetcher)).toBe(true);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://meta-sandbox.demeterfitness.com/api/integrations/meta-whatsapp/webhook?studio=9fe23cfa-fb47-4670-afeb-ed4a56433772",
    );
    expect(options.redirect).toBe("error");
    expect((options.headers as Record<string, string>)["x-hub-signature-256"]).toBe(
      "sha256=" +
        crypto
          .createHmac("sha256", "secret")
          .update(options.body as string)
          .digest("hex"),
    );
    expect(JSON.parse(options.body as string)).toEqual(packet);
  });
  it.each(["network", "reject", "malformed"])(
    "requires Meta retry on %s without blind resending",
    async (kind) => {
      const fetcher = vi.fn(async () => {
        if (kind === "network") throw Error("unknown outcome");
        if (kind === "reject") return Response.json({ ok: false }, { status: 503 });
        return new Response("bad JSON");
      });
      expect(await load().forwardWhatsAppPilot({}, "secret", fetcher)).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
