import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type JsonObject = Record<string, unknown>;

export type MetaInboxProvider = "instagram" | "facebook_messenger";

export type MetaInboxWebhookConfig = {
  pageAccessToken: string;
  pageId: string;
  instagramAccessToken: string;
  instagramUserId: string;
  graphApiVersion: string;
  appSecret: string;
  verifyToken: string;
  pilotContactIds: Record<MetaInboxProvider, string[]>;
};

export type MetaInboxInboundMessage = {
  provider: MetaInboxProvider;
  channel: MetaInboxProvider;
  providerMessageId: string;
  providerAccountId: string;
  providerContactId: string;
  displayName: string | null;
  timestamp: string | null;
  messageType: "text" | "postback" | "attachment" | "unknown";
  text: string;
};

export type MetaInboxDeliveryResult =
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

function constantTimeTextEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function verifyMetaInboxWebhookToken(expected: string, received: string | null) {
  if (!received) return false;
  return constantTimeTextEqual(expected, received);
}

export function verifyMetaInboxWebhookSignature(
  appSecret: string,
  rawBody: string,
  headerValue: string | null,
) {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(headerValue?.trim() ?? "");
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return constantTimeTextEqual(expected.toLowerCase(), match[1].toLowerCase());
}

export function metaInboxSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parsePilotIds(value: unknown): Record<MetaInboxProvider, string[]> {
  const source = isObject(value) ? value : {};
  const parse = (provider: MetaInboxProvider) =>
    Array.isArray(source[provider])
      ? (source[provider] as unknown[])
          .map((item) => safeText(item))
          .filter((item): item is string => Boolean(item))
      : [];
  return {
    instagram: parse("instagram"),
    facebook_messenger: parse("facebook_messenger"),
  };
}

function parseConfig(value: unknown): MetaInboxWebhookConfig | null {
  if (!isObject(value)) return null;

  const pageAccessToken = safeText(value.page_access_token);
  const pageId = safeText(value.page_id);
  const instagramAccessToken = safeText(value.instagram_access_token);
  const instagramUserId = safeText(value.instagram_user_id);
  const graphApiVersion = safeText(value.graph_api_version);
  const appSecret = safeText(value.app_secret);
  const verifyToken = safeText(value.verify_token);

  if (
    !(pageAccessToken && pageId || instagramAccessToken && instagramUserId) ||
    (Boolean(pageAccessToken || pageId) && !(pageAccessToken && /^\d+$/.test(pageId))) ||
    (Boolean(instagramAccessToken || instagramUserId) && !(instagramAccessToken && /^\d+$/.test(instagramUserId))) ||
    !graphApiVersion ||
    !/^v\d+\.\d+$/.test(graphApiVersion) ||
    !appSecret ||
    !verifyToken
  ) {
    return null;
  }

  return {
    pageAccessToken,
    pageId,
    instagramAccessToken,
    instagramUserId,
    graphApiVersion,
    appSecret,
    verifyToken,
    pilotContactIds: parsePilotIds(value.pilot_contact_ids),
  };
}

export async function loadMetaInboxWebhookConfig(
  supabase: SupabaseClient,
  studioId: string,
): Promise<MetaInboxWebhookConfig | null> {
  const { data, error } = await supabase.rpc("service_get_meta_inbox_webhook_config", {
    target_studio_id: studioId,
  });
  if (error) throw new Error("meta_inbox_webhook_config_lookup_failed");
  return parseConfig(data);
}

function stableMessageId(input: {
  provider: MetaInboxProvider;
  accountId: string;
  contactId: string;
  timestamp: string;
  text: string;
}) {
  const hash = metaInboxSha256(
    [input.provider, input.accountId, input.contactId, input.timestamp, input.text].join("|"),
  );
  return `synthetic:${input.provider}:${hash.slice(0, 40)}`;
}

export function extractMetaInboxMessages(body: unknown): MetaInboxInboundMessage[] {
  const root = isObject(body) ? body : {};
  const objectType = safeText(root.object);
  const provider: MetaInboxProvider | null =
    objectType === "instagram"
      ? "instagram"
      : objectType === "page"
        ? "facebook_messenger"
        : null;
  if (!provider) return [];

  const entries = Array.isArray(root.entry) ? root.entry : [];
  const output: MetaInboxInboundMessage[] = [];

  for (const rawEntry of entries) {
    const entry = isObject(rawEntry) ? rawEntry : {};
    const entryAccountId = safeText(entry.id);
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const rawEvent of messaging) {
      const event = isObject(rawEvent) ? rawEvent : {};
      const sender = isObject(event.sender) ? event.sender : {};
      const recipient = isObject(event.recipient) ? event.recipient : {};
      const contactId = safeText(sender.id);
      const accountId = entryAccountId ?? safeText(recipient.id);
      if (!contactId || !accountId || contactId === accountId) continue;

      const message = isObject(event.message) ? event.message : null;
      const postback = isObject(event.postback) ? event.postback : null;
      if (message?.is_echo === true) continue;

      const timestamp =
        typeof event.timestamp === "number" || typeof event.timestamp === "string"
          ? String(event.timestamp)
          : null;

      let messageType: MetaInboxInboundMessage["messageType"] = "unknown";
      let text = "";
      let providerMessageId = "";

      if (message) {
        providerMessageId = safeText(message.mid) ?? "";
        const directText = safeText(message.text);
        if (directText) {
          messageType = "text";
          text = directText;
        } else if (Array.isArray(message.attachments) && message.attachments.length) {
          messageType = "attachment";
          text = "[archivo recibido]";
        }
      } else if (postback) {
        messageType = "postback";
        text = safeText(postback.title) ?? safeText(postback.payload) ?? "";
        providerMessageId = safeText(postback.mid) ?? "";
      }

      if (!providerMessageId) {
        providerMessageId = stableMessageId({
          provider,
          accountId,
          contactId,
          timestamp: timestamp ?? "0",
          text,
        });
      }

      output.push({
        provider,
        channel: provider,
        providerMessageId,
        providerAccountId: accountId,
        providerContactId: contactId,
        displayName: null,
        timestamp,
        messageType,
        text,
      });
    }
  }

  return output;
}

function errorSnapshot(value: unknown): JsonObject {
  if (!isObject(value)) return {};
  const error = isObject(value.error) ? value.error : {};
  return {
    error: {
      message: safeText(error.message),
      type: safeText(error.type),
      code: typeof error.code === "number" ? error.code : null,
      error_subcode: typeof error.error_subcode === "number" ? error.error_subcode : null,
      fbtrace_id: safeText(error.fbtrace_id),
    },
  };
}

export async function sendMetaInboxText(input: {
  config: MetaInboxWebhookConfig;
  provider: MetaInboxProvider;
  recipientId: string;
  text: string;
  fetcher?: typeof fetch;
}): Promise<MetaInboxDeliveryResult> {
  const recipient = input.recipientId.trim();
  const text = input.text.trim();

  if (!recipient || !/^\d{5,64}$/.test(recipient)) {
    return {
      status: "error",
      errorCode: "meta_inbox_recipient_invalid",
      retryable: false,
      responseSnapshot: {},
    };
  }
  if (!text) {
    return {
      status: "error",
      errorCode: "meta_inbox_text_empty",
      retryable: false,
      responseSnapshot: {},
    };
  }

  const isInstagram = input.provider === "instagram";
  const accountId = isInstagram ? input.config.instagramUserId : input.config.pageId;
  const accessToken = isInstagram
    ? input.config.instagramAccessToken
    : input.config.pageAccessToken;
  const endpoint = isInstagram
    ? `https://graph.instagram.com/${input.config.graphApiVersion}/${accountId}/messages`
    : `https://graph.facebook.com/${input.config.graphApiVersion}/${accountId}/messages`;
  const fetcher = input.fetcher ?? fetch;
  const retryDelaysMs = [250, 500, 1000];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          isInstagram
            ? {
                recipient: { id: recipient },
                message: { text: text.slice(0, 1000) },
              }
            : {
                recipient: { id: recipient },
                messaging_type: "RESPONSE",
                message: { text: text.slice(0, 2000) },
              },
        ),
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
        if (retryable && attempt < retryDelaysMs.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
          continue;
        }
        return {
          status: "error",
          errorCode: `meta_inbox_http_${response.status}`,
          retryable,
          httpStatus: response.status,
          responseSnapshot: errorSnapshot(responseBody),
        };
      }

      const body = isObject(responseBody) ? responseBody : {};
      const providerMessageId =
        safeText(body.message_id) ?? safeText(body.id) ?? safeText(body.recipient_id);

      if (!providerMessageId) {
        return {
          status: "error",
          errorCode: "meta_inbox_message_id_missing",
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
        errorCode: timedOut ? "meta_inbox_timeout" : "meta_inbox_network_error",
        retryable: true,
        responseSnapshot: {},
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    status: "error",
    errorCode: "meta_inbox_retry_exhausted",
    retryable: true,
    responseSnapshot: {},
  };
}
