import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
const loaded = { exports: {} as typeof import("../lib/assistant/receipt-reader") };
new Function(
  "module",
  "exports",
  transformSync(
    readFileSync("lib/assistant/receipt-reader.ts", "utf8").replace('import "server-only";', ""),
    { loader: "ts", format: "cjs" },
  ).code,
)(loaded, loaded.exports);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function read(fields: Record<string, unknown>, mimeType = "image/png") {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(fields) }] }],
      }),
    });
  vi.stubGlobal("fetch", fetch);
  const reading = await loaded.exports.readTransferReceipt({
    bytes: new Uint8Array([1, 2]),
    mimeType,
  });
  return { reading, request: JSON.parse(fetch.mock.calls[0][1].body) };
}
describe("payment evidence classification", () => {
  it.each([
    "COMPROBANTE FICTICIO PARA UAT",
    "SIN VALOR - NO ES UN PAGO REAL",
    "NO ES COMPROBANTE",
    "VOID SAMPLE",
  ])("rejects a marked sample even when OCR reports a confident amount: %s", async (markings) => {
    const { reading } = await read({
      amount_minor: 15000,
      confidence: 0.99,
      is_payment_evidence: true,
      non_payment_markings: markings,
    });
    expect(reading.amountMinor).toBeNull();
    expect(reading.nonPaymentReason).toBe("sample_or_no_value");
    expect(loaded.exports.rejectedTransferReceiptReply(reading)).toContain("no la acepté");
  });
  it("rejects a non-receipt with a price", async () => {
    const { reading } = await read({
      amount_minor: 15000,
      confidence: 0.99,
      is_payment_evidence: false,
    });
    expect(reading.amountMinor).toBeNull();
    expect(reading.nonPaymentReason).toBe("not_payment_evidence");
  });
  it("does not accept an amount without the evidence classification", async () => {
    const { reading } = await read({ amount_minor: 15000, confidence: 0.99 });
    expect(reading.amountMinor).toBeNull();
  });
  it("preserves readable bank evidence for manual validation", async () => {
    const { reading } = await read({
      amount_minor: 15000,
      confidence: 0.95,
      currency: "mxn",
      bank: "BBVA",
      is_payment_evidence: true,
      non_payment_markings: null,
    });
    expect(reading).toMatchObject({ amountMinor: 15000, currency: "MXN", confidence: 0.95 });
    expect(loaded.exports.rejectedTransferReceiptReply(reading)).toBeNull();
  });
  it("keeps an unreadable amount null rather than converting it to zero, including PDFs", async () => {
    const { reading, request } = await read(
      { amount_minor: null, confidence: 0.2, is_payment_evidence: true },
      "application/pdf",
    );
    expect(reading.amountMinor).toBeNull();
    expect(request.input[0].content[0].type).toBe("input_file");
  });
});
