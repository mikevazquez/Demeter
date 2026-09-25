import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

import {
  buildMetaWhatsAppTemplatePayload,
  isMetaWhatsAppTemplateKey,
  normalizeMetaWhatsAppPhone,
  type MetaWhatsAppTemplateKey,
} from "./meta-whatsapp-template.ts";

type JsonObject = Record<string, unknown>;

export type MetaWhatsAppDeliveryResult =
  | {
      status: "accepted";
      providerReference: string;
      providerMessageId: string;
      httpStatus: number;
      responseSnapshot: JsonObject;
    }
  | {
      status: "skipped" | "error";
      errorCode: string;
      retryable: boolean;
      httpStatus?: number;
      responseSnapshot?: JsonObject;
    };

export type MetaWhatsAppDeliveryInput = {
  adminClient: SupabaseClient;
  studioId: string;
  template: string;
  eventId: string;
  recipient: unknown;
  variables: JsonObject;
  fetcher?: typeof fetch;
};

type MetaWhatsAppConnection = {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  languageCode: string;
  countryCallingCode: string;
  templates: Record<string, string>;
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

function parseConnection(value: unknown): MetaWhatsAppConnection | null {
  if (!isObject(value)) return null;

  const accessToken = safeText(value.access_token);
  const phoneNumberId = safeText(value.phone_number_id);
  const graphApiVersion = safeText(value.graph_api_version);
  const languageCode = safeText(value.language_code);
  const countryCallingCode = safeText(value.country_calling_code) ?? "52";
  const rawTemplates = isObject(value.templates) ? value.templates : {};

  if (
    !accessToken ||
    !phoneNumberId ||
    !/^\d+$/.test(phoneNumberId) ||
    !graphApiVersion ||
    !/^v\d+\.\d+$/.test(graphApiVersion) ||
    !languageCode
  ) {
    return null;
  }

  const templates = Object.fromEntries(
    Object.entries(rawTemplates)
      .map(([key, templateName]) => [key, safeText(templateName)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return {
    accessToken,
    phoneNumberId,
    graphApiVersion,
    languageCode,
    countryCallingCode,
    templates,
  };
}

async function loadConnection(
  adminClient: SupabaseClient,
  studioId: string,
): Promise<MetaWhatsAppConnection | null> {
  const { data, error } = await adminClient.rpc("service_get_meta_whatsapp_connection", {
    target_studio_id: studioId,
  });

  if (error) throw new Error("meta_whatsapp_connection_lookup_failed");
  return parseConnection(data);
}

function metaErrorSnapshot(value: unknown): JsonObject {
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

export async function sendMetaWhatsAppTemplate(
  input: MetaWhatsAppDeliveryInput,
): Promise<MetaWhatsAppDeliveryResult> {
  let connection: MetaWhatsAppConnection | null;

  try {
    connection = await loadConnection(input.adminClient, input.studioId);
  } catch {
    return {
      status: "error",
      errorCode: "meta_whatsapp_connection_lookup_failed",
      retryable: true,
      responseSnapshot: {},
    };
  }

  if (!connection) {
    return {
      status: "skipped",
      errorCode: "meta_whatsapp_not_configured",
      retryable: false,
      responseSnapshot: {},
    };
  }

  if (!isMetaWhatsAppTemplateKey(input.template)) {
    return {
      status: "error",
      errorCode: "meta_whatsapp_template_unsupported",
      retryable: false,
      responseSnapshot: { template_key: input.template },
    };
  }

  const internalTemplate = input.template as MetaWhatsAppTemplateKey;
  const metaTemplateName = safeText(connection.templates[internalTemplate]);
  if (!metaTemplateName) {
    return {
      status: "skipped",
      errorCode: "meta_whatsapp_template_not_configured",
      retryable: false,
      responseSnapshot: { template_key: internalTemplate },
    };
  }

  const recipient = normalizeMetaWhatsAppPhone(
    input.recipient,
    connection.countryCallingCode,
  );
  if (!recipient) {
    return {
      status: "skipped",
      errorCode: "whatsapp_recipient_phone_missing",
      retryable: false,
      responseSnapshot: {},
    };
  }

  const payload = buildMetaWhatsAppTemplatePayload({
    recipient,
    internalTemplate,
    metaTemplateName,
    languageCode: connection.languageCode,
    variables: input.variables,
  });

  const endpoint =
    `https://graph.facebook.com/${connection.graphApiVersion}/${connection.phoneNumberId}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await (input.fetcher ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
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
    const messageId = safeText(firstMessage.id);

    if (!messageId) {
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
      providerReference: `meta_whatsapp:${messageId}`,
      providerMessageId: messageId,
      httpStatus: response.status,
      responseSnapshot: {
        accepted: true,
        provider_message_id: messageId,
        phone_number_id: connection.phoneNumberId,
        template_name: metaTemplateName,
        event_id: input.eventId,
      },
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      status: "error",
      errorCode: timedOut ? "meta_whatsapp_timeout" : "meta_whatsapp_network_error",
      retryable: true,
      responseSnapshot: {},
    };
  } finally {
    clearTimeout(timer);
  }
}
