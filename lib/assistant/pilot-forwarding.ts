import { after } from "next/server";

type PilotMessage = { fromWaId: string };

export const DEMI_PILOT_FORWARDED_HEADER = "x-demi-pilot-forwarded";

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
        [DEMI_PILOT_FORWARDED_HEADER]: "1",
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

type BackgroundScheduler = (task: () => Promise<unknown>) => void;

/**
 * Runs pilot work after the response is sent. On Vercel this keeps the function alive
 * until the task settles; the scheduler is injectable for tests.
 */
export function schedulePilotBackground(
  task: () => Promise<unknown>,
  scheduler: BackgroundScheduler = after,
) {
  scheduler(async () => {
    try {
      await task();
    } catch {
      console.info("demi_meta_webhook", { stage: "pilot_deferred", outcome: "task_threw" });
    }
  });
}

/**
 * Executes a deferred pilot turn. Only retryable failures (non-2xx) are retried, and the
 * underlying pipeline's conditional claims keep processed or in-flight events from repeating.
 */
export async function runPilotDeferredTurn(
  attempt: () => Promise<Response>,
  options: { maxAttempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const delayMs = options.delayMs ?? 2_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let status = 0;
  for (let attempts = 1; attempts <= maxAttempts; attempts += 1) {
    try {
      const response = await attempt();
      status = response.status;
      if (response.ok) return { ok: true as const, attempts, status };
    } catch {
      status = 500;
    }
    if (attempts < maxAttempts) await sleep(delayMs);
  }
  return { ok: false as const, attempts: maxAttempts, status };
}
