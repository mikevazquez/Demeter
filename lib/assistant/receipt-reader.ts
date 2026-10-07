import "server-only";

type ReceiptReading = {
  amountMinor: number | null;
  currency: string | null;
  date: string | null;
  reference: string | null;
  bank: string | null;
  confidence: number;
};

type OpenAIResponse = {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};

function outputText(body: OpenAIResponse) {
  return (body.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

function parseJson(text: string) {
  const cleaned = text.replace(/^\`\`\`json\s*/i, "").replace(/\`\`\`$/i, "").trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { return null; }
}

export async function readTransferReceipt(input: {
  bytes: Uint8Array;
  mimeType: string;
  model?: string;
}): Promise<ReceiptReading> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("openai_not_configured");

  const base64 = Buffer.from(input.bytes).toString("base64");
  const dataUrl = `data:${input.mimeType};base64,${base64}`;
  const isPdf = input.mimeType === "application/pdf";
  const content = isPdf
    ? [{ type: "input_file", filename: "comprobante.pdf", file_data: dataUrl }]
    : [{ type: "input_image", image_url: dataUrl, detail: "high" }];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model || "gpt-5.6",
      store: false,
      input: [{
        role: "user",
        content: [
          ...content,
          { type: "input_text", text: "Lee este comprobante de transferencia. Devuelve SOLO JSON con amount_minor (entero en centavos), currency (MXN si se ve o se infiere claramente), date (YYYY-MM-DD o null), reference (folio/referencia o null), bank (banco o null) y confidence (0 a 1). No inventes datos. Si el monto no es legible, amount_minor debe ser null y confidence <= 0.5." },
        ],
      }],
      max_output_tokens: 300,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("receipt_read_failed");
  const body = await response.json() as OpenAIResponse;
  const parsed = parseJson(outputText(body));
  const amountMinor = Number(parsed?.amount_minor);
  const confidence = Number(parsed?.confidence);
  return {
    amountMinor: Number.isInteger(amountMinor) && amountMinor >= 0 ? amountMinor : null,
    currency: typeof parsed?.currency === "string" ? parsed.currency.toUpperCase() : null,
    date: typeof parsed?.date === "string" ? parsed.date : null,
    reference: typeof parsed?.reference === "string" ? parsed.reference : null,
    bank: typeof parsed?.bank === "string" ? parsed.bank : null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  };
}
