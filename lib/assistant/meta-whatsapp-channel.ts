import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type JsonObject = Record<string, unknown>;

export type MetaWhatsAppWebhookConfig = {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  appSecret: string;
  verifyToken: string;
  pilotWaIds: string[];
};

export type MetaInboundMessage = {
  providerMessageId: string;
  fromWaId: string;
  phoneNumberId: string;
  profileName: string | null;
  timestamp: string | null;
  messageType: string;
  text: string;
  mediaId: string | null;
};

export type MetaTextDeliveryResult =
  | {
      status: "accepted";
      providerMessageId: string;
      httpStatus: number;
      responseSnapshot: JsonObject;
    }
  | {
      status: "error";
      errorCode: string;
      retryable: boolean;
      httpStatus?: number;
      responseSnapshot: JsonObject;
    };

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function retryableHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseWebhookConfig(value: unknown): MetaWhatsAppWebhookConfig | null {
  if (!isObject(value)) return null;

  const accessToken = safeText(value.access_token);
  const phoneNumberId = safeText(value.phone_number_id);
  const graphApiVersion = safeText(value.graph_api_version);
  const appSecret = safeText(value.app_secret);
  const verifyToken = safeText(value.verify_token);

  if (
    !accessToken ||
    !phoneNumberId ||
    !/^\d+$/.test(phoneNumberId) ||
    !graphApiVersion ||
    !/^v\d+\.\d+$/.test(graphApiVersion) ||
    !appSecret ||
    !verifyToken
  ) {
    return null;
  }

  return {
    accessToken,
    phoneNumberId,
    graphApiVersion,
    appSecret,
    verifyToken,
    pilotWaIds: [],
  };
}

export async function loadMetaWhatsAppWebhookConfig(
  supabase: SupabaseClient,
  studioId: string,
) {
  const [{ data, error }, { data: pilotIds, error: pilotError }] =
    await Promise.all([
      supabase.rpc("service_get_meta_whatsapp_webhook_config", {
        target_studio_id: studioId,
      }),
      supabase.rpc("service_get_meta_whatsapp_pilot_wa_ids", {
        target_studio_id: studioId,
      }),
    ]);

  if (error || pilotError) {
    throw new Error("meta_whatsapp_webhook_config_lookup_failed");
  }

  const config = parseWebhookConfig(data);
  if (!config) return null;

  config.pilotWaIds = Array.isArray(pilotIds)
    ? pilotIds
        .map((value) => String(value ?? "").replace(/\D/g, ""))
        .filter((value) => /^[1-9][0-9]{7,14}$/.test(value))
    : [];

  return config;
}

function constantTimeTextEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function verifyMetaWebhookToken(expected: string, received: string | null) {
  if (!received) return false;
  return constantTimeTextEqual(expected, received);
}

export function verifyMetaWebhookSignature(
  appSecret: string,
  rawBody: string,
  headerValue: string | null,
) {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(headerValue?.trim() ?? "");
  if (!match) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return constantTimeTextEqual(expected.toLowerCase(), match[1].toLowerCase());
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function profileNameForWaId(value: JsonObject, waId: string) {
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  for (const rawContact of contacts) {
    const contact = isObject(rawContact) ? rawContact : {};
    if (safeText(contact.wa_id) !== waId) continue;
    const profile = isObject(contact.profile) ? contact.profile : {};
    return safeText(profile.name);
  }
  return null;
}

function messageText(message: JsonObject, type: string) {
  if (type === "text") {
    const text = isObject(message.text) ? message.text : {};
    return safeText(text.body) ?? "";
  }

  if (type === "button") {
    const button = isObject(message.button) ? message.button : {};
    return safeText(button.text) ?? safeText(button.payload) ?? "";
  }

  if (type === "interactive") {
    const interactive = isObject(message.interactive) ? message.interactive : {};
    const buttonReply = isObject(interactive.button_reply)
      ? interactive.button_reply
      : {};
    const listReply = isObject(interactive.list_reply) ? interactive.list_reply : {};
    return (
      safeText(buttonReply.title) ??
      safeText(listReply.title) ??
      safeText(buttonReply.id) ??
      safeText(listReply.id) ??
      ""
    );
  }

  if (type === "image") {
    const image = isObject(message.image) ? message.image : {};
    const caption = safeText(image.caption);
    return caption ? `[imagen recibida] ${caption}` : "[imagen recibida]";
  }

  if (type === "document") {
    const document = isObject(message.document) ? message.document : {};
    const caption = safeText(document.caption);
    const filename = safeText(document.filename);
    const details = [filename, caption].filter(Boolean).join(" · ");
    return details
      ? `[documento recibido] ${details}`
      : "[documento recibido]";
  }

  if (type === "audio") return "[audio recibido]";
  if (type === "video") return "[video recibido]";
  if (type === "sticker") return "[sticker recibido]";
  if (type === "location") return "[ubicación recibida]";
  if (type === "contacts") return "[contacto recibido]";

  return `[mensaje de tipo ${type || "desconocido"} recibido]`;
}

function mediaIdForMessage(message: JsonObject, type: string) {
  if (!["image", "document", "audio", "video", "sticker"].includes(type)) {
    return null;
  }
  const media = isObject(message[type]) ? (message[type] as JsonObject) : {};
  return safeText(media.id);
}

export function extractMetaInboundMessages(body: unknown): MetaInboundMessage[] {
  const root = isObject(body) ? body : {};
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const output: MetaInboundMessage[] = [];

  for (const rawEntry of entries) {
    const entry = isObject(rawEntry) ? rawEntry : {};
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const rawChange of changes) {
      const change = isObject(rawChange) ? rawChange : {};
      const value = isObject(change.value) ? change.value : {};
      const metadata = isObject(value.metadata) ? value.metadata : {};
      const phoneNumberId = safeText(metadata.phone_number_id);
      const messages = Array.isArray(value.messages) ? value.messages : [];
      if (!phoneNumberId) continue;

      for (const rawMessage of messages) {
        const message = isObject(rawMessage) ? rawMessage : {};
        const providerMessageId = safeText(message.id);
        const fromWaId = safeText(message.from);
        const messageType = safeText(message.type) ?? "unknown";
        if (!providerMessageId || !fromWaId) continue;

        output.push({
          providerMessageId,
          fromWaId,
          phoneNumberId,
          profileName: profileNameForWaId(value, fromWaId),
          timestamp: safeText(message.timestamp),
          messageType,
          text: messageText(message, messageType),
          mediaId: mediaIdForMessage(message, messageType),
        });
      }
    }
  }

  return output;
}

function metaErrorSnapshot(value: unknown): JsonObject {
  if (!isObject(value)) return {};
  const error = isObject(value.error) ? value.error : {};
  return {
    error: {
      message: safeText(error.message),
      type: safeText(error.type),
      code: typeof error.code === "number" ? error.code : null,
      error_subcode:
        typeof error.error_subcode === "number" ? error.error_subcode : null,
      fbtrace_id: safeText(error.fbtrace_id),
    },
  };
}

export async function sendMetaWhatsAppText(input: {
  config: MetaWhatsAppWebhookConfig;
  recipientWaId: string;
  text: string;
  fetcher?: typeof fetch;
}): Promise<MetaTextDeliveryResult> {
  const recipient = input.recipientWaId.replace(/\D/g, "");
  const text = input.text.trim();

  if (!/^[1-9][0-9]{7,14}$/.test(recipient)) {
    return {
      status: "error",
      errorCode: "whatsapp_recipient_invalid",
      retryable: false,
      responseSnapshot: {},
    };
  }
  if (!text) {
    return {
      status: "error",
      errorCode: "whatsapp_text_empty",
      retryable: false,
      responseSnapshot: {},
    };
  }

  const endpoint =
    `https://graph.facebook.com/${input.config.graphApiVersion}/${input.config.phoneNumberId}/messages`;
  const fetcher = input.fetcher ?? fetch;
  const retryDelaysMs = [250, 500, 1000, 2000];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "text",
          text: {
            preview_url: false,
            body: text.slice(0, 4096),
          },
        }),
        signal: controller.signal,
      });

      let responseBody: unknown = {};
      try {
        responseBody = await response.json();
      } catch {
        responseBody = {};
      }

      if (!response.ok) {
        const retryable = retryableHttpStatus(response.status);
        const canRetryInline =
          retryable &&
          (response.status === 429 || response.status >= 500) &&
          attempt < retryDelaysMs.length;

        if (canRetryInline) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, retryDelaysMs[attempt]),
          );
          continue;
        }

        return {
          status: "error",
          errorCode: `meta_whatsapp_http_${response.status}`,
          retryable,
          httpStatus: response.status,
          responseSnapshot: metaErrorSnapshot(responseBody),
        };
      }

      const body = isObject(responseBody) ? responseBody : {};
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const firstMessage = isObject(messages[0]) ? messages[0] : {};
      const providerMessageId = safeText(firstMessage.id);

      if (!providerMessageId) {
        return {
          status: "error",
          errorCode: "meta_whatsapp_message_id_missing",
          retryable: true,
          httpStatus: response.status,
          responseSnapshot: {},
        };
      }

      return {
        status: "accepted",
        providerMessageId,
        httpStatus: response.status,
        responseSnapshot: {
          accepted: true,
          provider_message_id: providerMessageId,
        },
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return {
        status: "error",
        errorCode: timedOut
          ? "meta_whatsapp_timeout"
          : "meta_whatsapp_network_error",
        retryable: true,
        responseSnapshot: {},
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    status: "error",
    errorCode: "meta_whatsapp_retry_exhausted",
    retryable: true,
    responseSnapshot: {},
  };
}): Promise<MetaTextDeliveryResult> {
  const recipient = input.recipientWaId.replace(/\D/g, "");
  const text = input.text.trim();

  if (!/^[1-9][0-9]{7,14}$/.test(recipient)) {
    return {
      status: "error",
      errorCode: "whatsapp_recipient_invalid",
      retryable: false,
      responseSnapshot: {},
    };
  }
  if (!text) {
    return {
      status: "error",
      errorCode: "whatsapp_text_empty",
      retryable: false,
      responseSnapshot: {},
    };
  }

  const endpoint =
    `https://graph.facebook.com/${input.config.graphApiVersion}/${input.config.phoneNumberId}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await (input.fetcher ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          preview_url: false,
          body: text.slice(0, 4096),
        },
      }),
      signal: controller.signal,
    });

    let responseBody: unknown = {};
    try {
      responseBody = await response.json();
    } catch {
      responseBody = {};
    }

    if (!response.ok) {
      return {
        status: "error",
        errorCode: `meta_whatsapp_http_${response.status}`,
        retryable: retryableHttpStatus(response.status),
        httpStatus: response.status,
        responseSnapshot: metaErrorSnapshot(responseBody),
      };
    }

    const body = isObject(responseBody) ? responseBody : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const firstMessage = isObject(messages[0]) ? messages[0] : {};
    const providerMessageId = safeText(firstMessage.id);

    if (!providerMessageId) {
      return {
        status: "error",
        errorCode: "meta_whatsapp_message_id_missing",
        retryable: true,
        httpStatus: response.status,
        responseSnapshot: {},
      };
    }

    return {
      status: "accepted",
      providerMessageId,
      httpStatus: response.status,
      responseSnapshot: {
        accepted: true,
        provider_message_id: providerMessageId,
      },
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      status: "error",
      errorCode: timedOut
        ? "meta_whatsapp_timeout"
        : "meta_whatsapp_network_error",
      retryable: true,
      responseSnapshot: {},
    };
  } finally {
    clearTimeout(timer);
  }
}
