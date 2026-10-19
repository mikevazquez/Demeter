import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  read: vi.fn(),
  reject: vi.fn(),
  download: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/assistant/meta-whatsapp-channel", () => ({
  downloadMetaWhatsAppMedia: mocks.download,
}));
vi.mock("@/lib/assistant/receipt-reader", () => ({
  readTransferReceipt: mocks.read,
  rejectedTransferReceiptReply: mocks.reject,
}));
import {
  workshopPurchaseAction,
  handleDemiWorkshopReceipt,
} from "@/lib/assistant/workshop-purchase";

const id = "00000000-0000-4000-8000-000000000001";
const context = () => ({
  supabase: { rpc: mocks.rpc } as never,
  studio: { id: "verified-studio" },
  conversationId: "verified-conversation",
  turnId: "inbound-turn",
  studentId: "verified-student",
  serviceMode: true,
  currentUserMessage: "Sí",
});
describe("Demi workshop application boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });
  it("uses verified tenant, conversation and inbound turn rather than tool-supplied authority", async () => {
    await workshopPurchaseAction(context(), "prepare_workshop_purchase", {
      workshop_ref: `workshop:${id}`,
      session_refs: [`session:${id}`],
      purchase_mode: "full",
      studio_id: "forged",
      student_id: "forged",
      amount_minor: 1,
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("service_prepare_demi_workshop_purchase", {
      p_studio: "verified-studio",
      p_conversation: "verified-conversation",
      p_offer: id,
      p_sessions: [id],
      p_mode: "full",
      p_turn: "inbound-turn",
    });
  });
  it("rejects invalid or duplicate dates and an unverified identity before any RPC", async () => {
    for (const session_refs of [[`session:${id}`, `session:${id}`], ["foreign"], []]) {
      expect(
        await workshopPurchaseAction(context(), "prepare_workshop_purchase", {
          workshop_ref: `workshop:${id}`,
          session_refs,
          purchase_mode: "full",
        }),
      ).toMatchObject({ ok: false });
    }
    expect(
      await workshopPurchaseAction(
        { ...context(), studentId: null },
        "confirm_workshop_purchase",
        {},
      ),
    ).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["¿Sí?", "No", "Sí, pero primero dime el horario", "Cuánto cuesta", "no acepto"])(
    "does not accept ambiguous or negative purchase confirmation: %s",
    async (currentUserMessage) => {
      expect(
        await workshopPurchaseAction(
          { ...context(), currentUserMessage },
          "confirm_workshop_purchase",
          {},
        ),
      ).toMatchObject({ reason_code: "explicit_confirmation_required" });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("acceptance calls the server with the actual inbound turn, without creating a sale locally", async () => {
    await workshopPurchaseAction(context(), "confirm_workshop_purchase", {});
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("service_accept_demi_workshop_purchase", {
      p_studio: "verified-studio",
      p_conversation: "verified-conversation",
      p_turn: "inbound-turn",
    });
  });
  it("forwards continuation only through the owned-conversation RPC", async () => {
    await workshopPurchaseAction(context(), "record_workshop_continuation", {
      purchase_ref: `purchase:${id}`,
      decision: "withdraw",
      student_id: "forged",
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("service_record_workshop_continuation", {
      p_studio: "verified-studio",
      p_conversation: "verified-conversation",
      p_purchase: id,
      p_turn: "inbound-turn",
      p_decision: "withdraw",
    });
  });
  function receiptInput() {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = {
      rpc: mocks.rpc,
      storage: { from: () => ({ upload }) },
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          gt: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({
            data: table === "demi_workshop_receipts" ? null : { id },
            error: null,
          }),
        };
        return chain;
      },
    };
    return {
      input: {
        supabase: client as never,
        studioId: "verified-studio",
        conversationId: "verified-conversation",
        eventId: "source-event",
        providerMessageId: "source-provider",
        mediaId: "source-media",
        messageType: "image",
        downloadedMedia: {
          bytes: Buffer.from("synthetic receipt"),
          mimeType: "image/png" as const,
          fileSize: Buffer.byteLength("synthetic receipt"),
        },
      },
      upload,
    };
  }
  it("unreadable/nonpayment media never reaches the reservation RPC", async () => {
    const { input } = receiptInput();
    mocks.read.mockResolvedValue(null);
    mocks.reject.mockReturnValue("Necesito un comprobante legible.");
    expect(await handleDemiWorkshopReceipt(input)).toMatchObject({
      handled: true,
      result: { ok: false },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("a receipt is bound to its original source and remains explicitly unverified", async () => {
    const { input, upload } = receiptInput();
    mocks.read.mockResolvedValue({ amountMinor: 30000, currency: "MXN", confidence: 0.99 });
    mocks.reject.mockReturnValue(null);
    mocks.rpc.mockResolvedValue({ error: null, data: { ok: true, hold_id: id } });
    const result = await handleDemiWorkshopReceipt(input);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_record_demi_workshop_receipt",
      expect.objectContaining({
        p_studio: "verified-studio",
        p_conversation: "verified-conversation",
        p_event: "source-event",
        p_provider: "source-provider",
        p_intent: id,
        p_amount: 30000,
        p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(upload).toHaveBeenCalledWith(
      expect.stringContaining(`/workshop/${id}/`),
      input.downloadedMedia.bytes,
      { contentType: "image/png", upsert: false },
    );
    expect(result.reply).toContain("pago sigue sin verificar");
  });
  it("an unknown response does not assert that no hold exists or invite a second payment", async () => {
    const { input } = receiptInput();
    mocks.read.mockResolvedValue({ amountMinor: 30000, currency: "MXN", confidence: 0.99 });
    mocks.reject.mockReturnValue(null);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "network failure" } });
    const result = await handleDemiWorkshopReceipt(input);
    expect(result.reply).toContain("No pude verificar el resultado");
    expect(result.reply).toContain("no envíes otro pago");
    expect(result.reply).not.toContain("ningún ingreso ni reserva");
  });
});
