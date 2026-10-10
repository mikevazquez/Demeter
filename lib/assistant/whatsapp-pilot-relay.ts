import "server-only";
import { createHmac } from "node:crypto";

const PRODUCTION_STUDIO = "f1d69ae2-84c5-4b76-b77c-d792c9318225";
const SANDBOX_RECEIVER =
  "https://meta-sandbox.demeterfitness.com/api/integrations/meta-whatsapp/webhook?studio=9fe23cfa-fb47-4670-afeb-ed4a56433772";
const PILOT_IDS = new Set(["523323291878", "5213323291878"]);
type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function pilot(value: unknown, key: string) {
  return object(value) && typeof value[key] === "string" && PILOT_IDS.has(value[key]);
}

// Called only after the original webhook's signature has been verified.
// An explicit production flag enables one authorized number; arbitrary targets are forbidden.
export function partitionWhatsAppPilot(
  body: unknown,
  config: {
    enabled: boolean;
    studioId: string;
    phoneNumberId: string;
    wabaId: string;
  },
) {
  if (
    !config.enabled ||
    config.studioId !== PRODUCTION_STUDIO ||
    !object(body) ||
    body.object !== "whatsapp_business_account" ||
    !Array.isArray(body.entry)
  )
    return null;
  const pilotEntries: ObjectValue[] = [];
  let records = 0;
  const productionEntries = body.entry.map((entry: unknown) => {
    if (!object(entry) || entry.id !== config.wabaId || !Array.isArray(entry.changes)) return entry;
    const pilotChanges: ObjectValue[] = [];
    const productionChanges = entry.changes.map((change: unknown) => {
      if (!object(change) || change.field !== "messages" || !object(change.value)) return change;
      const value = change.value;
      if (!object(value.metadata) || value.metadata.phone_number_id !== config.phoneNumberId)
        return change;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      const pilotMessages = messages.filter((m) => pilot(m, "from"));
      const pilotStatuses = statuses.filter((s) => pilot(s, "recipient_id"));
      if (!pilotMessages.length && !pilotStatuses.length) return change;
      records += pilotMessages.length + pilotStatuses.length;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      pilotChanges.push({
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: value.metadata,
          ...(pilotMessages.length ? { messages: pilotMessages } : {}),
          ...(pilotStatuses.length ? { statuses: pilotStatuses } : {}),
          contacts: contacts.filter((c) => pilot(c, "wa_id")),
        },
      });
      return {
        ...change,
        value: {
          ...value,
          messages: messages.filter((m) => !pilot(m, "from")),
          statuses: statuses.filter((s) => !pilot(s, "recipient_id")),
          contacts: contacts.filter((c) => !pilot(c, "wa_id")),
        },
      };
    });
    if (pilotChanges.length) pilotEntries.push({ id: entry.id, changes: pilotChanges });
    return { ...entry, changes: productionChanges };
  });
  return records
    ? {
        records,
        productionBody: { ...body, entry: productionEntries },
        pilotBody: { object: "whatsapp_business_account", entry: pilotEntries },
      }
    : null;
}

export function signPilotRelayBody(body: string, appSecret: string) {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}
export async function forwardWhatsAppPilot(
  body: unknown,
  appSecret: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const raw = JSON.stringify(body);
  try {
    const response = await fetcher(SANDBOX_RECEIVER, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPilotRelayBody(raw, appSecret),
      },
      body: raw,
      signal: AbortSignal.timeout(90000),
    });
    const result: unknown = await response.json();
    return response.ok && object(result) && result.ok === true;
  } catch {
    // Meta retries the original event. Both receivers retain provider IDs and native deduplication.
    // Never perform a blind forwarding retry after an unknown network outcome.
    return false;
  }
}

export async function dispatchWhatsAppPilot(
  partition: NonNullable<ReturnType<typeof partitionWhatsAppPilot>>,
  appSecret: string,
  handleProduction: (body: unknown) => Promise<Response>,
  fetcher: typeof fetch = fetch,
) {
  const [productionResponse, forwarded] = await Promise.all([
    handleProduction(partition.productionBody),
    forwardWhatsAppPilot(partition.pilotBody, appSecret, fetcher),
  ]);
  return forwarded
    ? productionResponse
    : Response.json({ error: "sandbox_pilot_forward_failed" }, { status: 503 });
}
