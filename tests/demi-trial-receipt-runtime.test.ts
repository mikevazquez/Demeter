import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { demiDeliveryRetryPolicy } from "../lib/assistant/delivery-retry-policy";
import { trialReceiptConfirmation } from "../lib/assistant/receipt-confirmation";

const receiptReader = { exports: {} as typeof import("../lib/assistant/receipt-reader") };
new Function(
  "module",
  "exports",
  transformSync(
    readFileSync("lib/assistant/receipt-reader.ts", "utf8").replace('import "server-only";', ""),
    { loader: "ts", format: "cjs" },
  ).code,
)(receiptReader, receiptReader.exports);

function harness(
  amount = 15000,
  confidence = 0.99,
  storageFails = false,
  activationReason?: string,
  nonPaymentReason?: "sample_or_no_value",
) {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const upload = vi.fn(async () => ({
    error: storageFails ? { message: "storage failed" } : null,
  }));
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    storage: { from: () => ({ upload }) },
    from: (table: string) => {
      const data =
        table === "assistant_transfer_purchase_intents"
          ? { id: "intent", amount_minor: 15000, currency: "MXN", intent_kind: "trial_class" }
          : table === "assistant_handoff_policies"
            ? { enabled: true }
            : null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: () => chain,
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return chain;
        },
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return chain;
    },
    rpc: vi.fn(async (name: string) => ({
      error: null,
      data:
        name === "assistant_create_handoff"
          ? { ok: true }
          : activationReason
            ? { ok: false, reason_code: activationReason }
            : {
                ok: true,
                activity: "Pole Fitness",
                reservation_id: "reservation",
                payment_validation_required: true,
              },
    })),
  };
  const read = vi.fn(async () => ({
    amountMinor: amount,
    currency: "MXN",
    date: null,
    reference: null,
    bank: null,
    confidence,
    nonPaymentReason,
  }));
  const access = vi.fn(async () => ({ already_has_access: true }));
  const deps: Record<string, unknown> = {
    "@/lib/assistant/orchestrator": {},
    "@/lib/assistant/audio-transcription": { transcribeDemiAudio: vi.fn() },
    "@/lib/assistant/enrollment-payment": {
      handleDemiEnrollmentReceipt: vi.fn().mockResolvedValue({ handled: false }),
    },
    "@/lib/assistant/group-booking": {
      handleDemiGroupReceipt: vi.fn().mockRejectedValue(new Error("Unexpected group receipt")),
    },
    "@/lib/assistant/delivery-retry-policy": { demiDeliveryRetryPolicy },
    "@/lib/assistant/runtime-config": {},
    "@/lib/assistant/read-tools": {},
    "@/lib/assistant/receipt-reader": { ...receiptReader.exports, readTransferReceipt: read },
    "@/lib/assistant/receipt-confirmation": { trialReceiptConfirmation },
    "@/lib/assistant/student-access": { provisionStudentAccessWithServiceClient: access },
    "@/lib/assistant/meta-whatsapp-channel": {
      downloadMetaWhatsAppMedia: async () => ({ bytes, mimeType: "image/png", fileSize: 4 }),
    },
    "@/lib/assistant/meta-delivery-status": {},
    "@/lib/supabase/service": {},
  };
  const source =
    readFileSync("app/api/integrations/meta-whatsapp/webhook/route.ts", "utf8") +
    "\nexport { activateTransferReceiptIfPending };";
  const loaded = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(source, { loader: "ts", format: "cjs" }).code,
  )(
    (name: string) => {
      if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`);
      return deps[name];
    },
    loaded,
    loaded.exports,
  );
  const process = (
    loaded.exports as {
      activateTransferReceiptIfPending: (
        input: unknown,
      ) => Promise<{ handled: boolean; reply?: string }>;
    }
  ).activateTransferReceiptIfPending;
  const input = {
    supabase,
    studioId: "studio",
    conversationId: "conversation",
    studentId: "student",
    eventId: "event",
    providerMessageId: "message",
    mediaId: "media",
    messageType: "image",
    messageText: "comprobante",
    webhookConfig: {},
    activationUrl: "https://example.test",
  };
  return { run: () => process(input), input, supabase, upload, updates, read, access, bytes };
}

describe("Demi first-class receipt processing", () => {
  it("stores and associates matching bytes before provisional booking and human review", async () => {
    const h = harness();
    const result = await h.run();
    expect(h.read).toHaveBeenCalledWith({ bytes: h.bytes, mimeType: "image/png" });
    expect(h.upload).toHaveBeenCalledWith(
      "studio/student/intent/receipt.png",
      h.bytes,
      expect.objectContaining({ contentType: "image/png" }),
    );
    expect(h.updates).toContainEqual(
      expect.objectContaining({
        receipt_amount_matches: true,
        receipt_detected_amount_minor: 15000,
      }),
    );
    expect(h.supabase.rpc).toHaveBeenCalledWith(
      "service_activate_trial_transfer_receipt",
      expect.objectContaining({
        target_studio_id: "studio",
        target_student_id: "student",
        target_intent_id: "intent",
      }),
    );
    expect(h.supabase.rpc).toHaveBeenCalledWith(
      "assistant_create_handoff",
      expect.objectContaining({ target_reason_code: "receipt_validation_failed" }),
    );
    expect(result.reply).toContain("quedó reservada");
    expect(result.reply).toContain("en proceso de validación por el equipo");
    expect(result.reply).toContain("puede cancelarse");
    expect(result.reply).toContain("te avisaremos por este mismo chat");
    expect(result.reply).not.toContain("pago liquidado");
  });
  it("does not book when the amount does not match", async () => {
    const h = harness(14900);
    const result = await h.run();
    expect(result.reply).toContain("no coincide");
    expect(h.supabase.rpc).not.toHaveBeenCalled();
    expect(h.access).not.toHaveBeenCalled();
  });
  it("requests review without booking for an unreadable receipt", async () => {
    const h = harness(15000, 0.5);
    expect((await h.run()).reply).toContain("No confirmé tu primera clase");
    expect(h.supabase.rpc.mock.calls.map((call) => call[0])).toEqual(["assistant_create_handoff"]);
  });
  it("does not activate when receipt storage fails", async () => {
    const h = harness(15000, 0.99, true);
    await expect(h.run()).rejects.toThrow("transfer_receipt_storage_failed");
    expect(h.supabase.rpc).not.toHaveBeenCalled();
  });
  it("does not claim a booking if capacity changed after payment", async () => {
    const h = harness(15000, 0.99, false, "session_full");
    expect((await h.run()).reply).toContain("ese lugar dejó de estar disponible");
    expect(h.access).not.toHaveBeenCalled();
  });
});

it("rejects explicitly fictitious evidence before storage or any payment/reservation mutation", async () => {
  const h = harness(15000, 0.99, false, undefined, "sample_or_no_value");
  const result = await h.run();
  expect(result.handled).toBe(true);
  expect(result.reply).toContain("no la acepté");
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.supabase.rpc).not.toHaveBeenCalled();
  expect(h.updates).toEqual([]);
});
