import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

import {
  buildMetaWhatsAppTemplatePayload,
  isMetaWhatsAppTemplateKey,
  normalizeMetaWhatsAppPhone,
} from "./meta-whatsapp-template.ts";

type JsonObject = Record<string, unknown>;

export type MetaWhatsAppDeliveryResult =
  | {
      status: "accepted";
      providerReference: string;
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

type MetaConfig = {
  phone_number_id: string;
  graph_version: string;
  access_token: string;
  meta_template_name: string;
  language_code: string;
};

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asMetaConfig(value: unknown): MetaConfig | null {
  if (!isObject(value)) return null;

  const phoneNumberId = safeText(value.phone_number_id);
  const graphVersion = safeText(value.graph_version);
  const accessToken = safeText(value.access_token);
  const metaTemplateName = safeText(value.meta_template_name);
  const languageCode = safeText(value.language_code);

  if (!phoneNumberId || !graphVersion || !accessToken || !metaTemplateName || !languageCode) {
    return null;
  }

  return {
    phone_number_id: phoneNumberId,
    graph_version: graphVersion,
    access_token: accessToken,
    meta_template_name: metaTemplateName,
    language_code: languageCode,
  };
}

function retryableHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function safeResponseJson(response: Response): Promise<JsonObject> {
  try {
    const parsed = await response.json();
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function sendMetaWhatsAppTemplate(input: {
  adminClient: SupabaseClient;
  studioId: string;
  internalTemplateKey: string;
  recipient: unknown;
  variables: JsonObject;
  fetcher?: typeof fetch;
}): Promise<MetaWhatsAppDeliveryResult> {
  if (!isMetaWhatsAppTemplateKey(input.internalTemplateKey)) {
    return {
      status: "skipped",
      errorCode: "meta_whatsapp_template_unsupported",
      retryable: false,
      responseSnapshot: { template_key: input.internalTemplateKey },
    };
  }

  const recipient = normalizeMetaWhatsAppPhone(input.recipient);
  if (!recipient) {
    return {
      status: "skipped",
      errorCode: "whatsapp_recipient_phone_missing",
      retryable: false,
      responseSnapshot: {},
    };
  }

  const { data, error } = await input.adminClient.rpc(
    "service_get_meta_whatsapp_delivery_config",
    {
      target_studio_id: input.studioId,
      target_internal_template_key: input.internalTemplateKey,
    },
  );

  if (error) {
    return {
      status: "error",
      errorCode: "meta_whatsapp_config_lookup_failed",
      retryable: true,
      responseSnapshot: {},
    };
  }

  const config = asMetaConfig(data);
  if (!config) {
    return {
      status: "skipped",
      errorCode: "meta_whatsapp_not_configured",
      retryable: false,
      responseSnapshot: {},
    };
  }

  const payload = buildMetaWhatsAppTemplatePayload({
    recipient,
    internalTemplate: input.internalTemplateKey,
    metaTemplateName: config.meta_template_name,
    languageCode: config.language_code,
    variables: input.variables,
  });

  const endpoint =
    `https://graph.facebook.com/${encodeURIComponent(config.graph_version)}/` +
    `${encodeURIComponent(config.phone_number_id)}/messages`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await (input.fetcher ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const responseBody = await safeResponseJson(response);
    const messages = Array.isArray(responseBody.messages) ? responseBody.messages : [];
    const firstMessage = isObject(messages[0]) ? messages[0] : null;
    const providerMessageId = safeText(firstMessage?.id);

    if (response.ok && providerMessageId) {
      return {
        status: "accepted",
        providerReference: providerMessageId,
        httpStatus: response.status,
        responseSnapshot: {
          accepted: true,
          messaging_product: safeText(responseBody.messaging_product),
          provider_message_id: providerMessageId,
        },
      };
    }

    const errorObject = isObject(responseBody.error) ? responseBody.error : {};
    const providerCode =
      typeof errorObject.code === "number" || typeof errorObject.code === "string"
        ? String(errorObject.code)
        : null;

    return {
      status: "error",
      errorCode: providerCode
        ? `meta_whatsapp_${providerCode}`
        : `meta_whatsapp_http_${response.status}`,
      retryable: retryableHttpStatus(response.status),
      httpStatus: response.status,
      responseSnapshot: {
        accepted: false,
        provider_error_code: providerCode,
        provider_error_type: safeText(errorObject.type),
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
