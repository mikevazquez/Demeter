type PilotMessage = { fromWaId: string };

function parsePilotTarget(raw: string | undefined) {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    if (url.pathname !== "/api/integrations/meta-whatsapp/webhook") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function canonicalMetaWaId(value: string) {
  const raw = value.replace(/\D/g, "");
  return /^521[0-9]{10}$/.test(raw) ? `52${raw.slice(3)}` : raw;
}

export function pilotForwardTarget(input: {
  messages: PilotMessage[];
  targetUrl?: string;
  allowWaIds?: string;
  alreadyForwarded: boolean;
}) {
  if (input.alreadyForwarded || !input.messages.length) return null;

  const targetUrl = parsePilotTarget(input.targetUrl);
  if (!targetUrl) return null;

  const allowlist = new Set(
    (input.allowWaIds ?? "")
      .split(/[\s,;]+/)
      .map(canonicalMetaWaId)
      .filter((value) => /^[1-9][0-9]{7,14}$/.test(value)),
  );
  if (!allowlist.size) return null;

  const recipients = input.messages.map((message) => canonicalMetaWaId(message.fromWaId));
  return recipients.every((waId) => allowlist.has(waId)) ? targetUrl : null;
}

export async function forwardSignedMetaWebhook(input: {
  targetUrl: string;
  rawBody: string;
  signature: string | null;
  fetcher?: typeof fetch;
}) {
  if (!input.signature) return { ok: false as const, status: 401 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (input.fetcher ?? fetch)(input.targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": input.signature,
        "x-demi-pilot-forwarded": "1",
      },
      body: input.rawBody,
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false as const, status: 503 };
  } finally {
    clearTimeout(timer);
  }
}
