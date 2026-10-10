import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
function harness(
  options: { live?: boolean; eligible?: boolean; send?: () => Promise<Response> } = {},
) {
  let handler!: (request: Request) => Promise<Response>;
  const notice = {
    id: "notice",
    conversation_id: "conversation",
    source_id: "receipt",
    source_kind: "enrollment",
    decision: "rejected",
    amount_minor: 20000,
    currency: "MXN",
    notification_text: "Comprobante rechazado: no activé inscripción. Envía el documento correcto.",
    notification_lease: "lease",
    notification_attempts: 1,
  };
  const rpc = vi.fn(
    async (name: string, _args?: unknown): Promise<{ data: unknown; error: null }> => ({
      data:
        name === "service_claim_demi_payment_notifications"
          ? []
          : name === "service_claim_demi_receipt_review_notices"
            ? [notice]
            : name === "service_revalidate_demi_receipt_review_notice"
              ? { eligible: options.eligible !== false }
              : name === "service_capture_demi_uat_delivery"
                ? { artifact_id: "captured", failed: false }
                : name === "service_get_meta_whatsapp_webhook_config"
                  ? { access_token: "test", phone_number_id: "test", graph_api_version: "v23.0" }
                  : name === "service_get_meta_whatsapp_pilot_wa_ids"
                    ? []
                    : { ok: true, status: "sent" },
      error: null,
    }),
  );
  const client = {
    rpc,
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        order: () => chain,
        single: async () => ({
          data:
            table === "assistant_configs"
              ? { mode: "active" }
              : {
                  channel: "whatsapp",
                  context: {},
                  external_thread_ref: "523323291878",
                  status: "open",
                  student_id: "student",
                },
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            table === "demi_uat_runs"
              ? options.live
                ? null
                : { id: "run" }
              : table === "students"
                ? { person_id: "person" }
                : table === "assistant_turns"
                  ? { created_at: new Date().toISOString() }
                  : { whatsapp_blocked: false },
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    },
  };
  const send = vi.fn(
    options.send ?? (async () => Response.json({ messages: [{ id: "accepted" }] })),
  );
  new Function(
    "require",
    "Deno",
    "fetch",
    transformSync(readFileSync("supabase/functions/demi-payment-worker/index.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
    }).code,
  )(
    (name: string) =>
      name === "npm:@supabase/supabase-js@2.116.0"
        ? { createClient: () => client }
        : name === "../_shared/demi-mercadopago.ts"
          ? { demiTestSeller: async () => true }
          : (() => {
              throw Error(name);
            })(),
    {
      env: {
        get: (key: string) =>
          key === "SUPABASE_SERVICE_ROLE_KEY"
            ? "test-service"
            : key === "SUPABASE_URL"
              ? "https://hedouonyhynuvwbckdlg.supabase.co"
              : undefined,
      },
      serve: (fn: typeof handler) => {
        handler = fn;
      },
    },
    send,
  );
  const request = (authorized = true) =>
    handler(
      new Request("https://worker.test", {
        method: "POST",
        headers: authorized ? { authorization: "Bearer test-service" } : {},
        body: JSON.stringify({ studio_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );
  return { rpc, send, request, notice };
}
describe("receipt review notification worker", () => {
  it("rejects unauthorized work before claiming notices", async () => {
    const h = harness();
    expect((await h.request(false)).status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("captures the staff decision with owned receipt references and its exact text", async () => {
    const h = harness();
    expect((await h.request()).status).toBe(200);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith(
      "service_capture_demi_uat_delivery",
      expect.objectContaining({
        p_kind: "demi_receipt_review",
        p_payload: expect.objectContaining({
          source_id: "receipt",
          decision: "rejected",
          text: h.notice.notification_text,
        }),
      }),
    );
    expect(h.rpc).toHaveBeenCalledWith(
      "service_finish_demi_receipt_review_notice",
      expect.objectContaining({ p_accepted: true, p_text: h.notice.notification_text }),
    );
  });
  it("suppresses a rejection superseded by a corrected receipt", async () => {
    const h = harness({ eligible: false });
    expect((await h.request()).status).toBe(200);
    expect(h.send).not.toHaveBeenCalled();
    expect(
      h.rpc.mock.calls.some(
        ([n]) =>
          n === "service_capture_demi_uat_delivery" ||
          n === "service_finish_demi_receipt_review_notice",
      ),
    ).toBe(false);
  });
  it.each([
    [
      "interrupted network",
      async () => {
        throw new TypeError("interrupted");
      },
    ],
    ["malformed response", async () => new Response("incomplete")],
  ] as const)("preserves the lease after %s to prevent a blind duplicate", async (_, send) => {
    const h = harness({ live: true, send });
    expect((await h.request()).status).toBe(200);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls.some(([n]) => n === "service_finish_demi_receipt_review_notice")).toBe(
      false,
    );
  });
  it("records a known rejection for bounded retries without applying a payment", async () => {
    const h = harness({
      live: true,
      send: async () => Response.json({ error: { code: 4 } }, { status: 429 }),
    });
    expect((await h.request()).status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith(
      "service_finish_demi_receipt_review_notice",
      expect.objectContaining({ p_accepted: false, p_error: "meta_429" }),
    );
    expect(h.rpc.mock.calls.some(([n]) => n === "service_apply_demi_mercadopago_order")).toBe(
      false,
    );
  });
});
