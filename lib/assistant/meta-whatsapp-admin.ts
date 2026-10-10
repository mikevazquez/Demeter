import "server-only";

import {
  loadMetaWhatsAppWebhookConfig,
  type MetaWhatsAppWebhookConfig,
} from "@/lib/assistant/meta-whatsapp-channel";
import { normalizeMexicanPhone } from "@/lib/phone";
import { createServiceClient } from "@/lib/supabase/service";
import { validateMetaWhatsAppTemplateDraft } from "@/lib/notifications/meta-template-catalog";

type JsonObject = Record<string, unknown>;

export type MetaApprovedTemplate = {
  name: string;
  language: string;
  category: string | null;
  testReady: boolean;
};

export type MetaTemplateStatus = MetaApprovedTemplate & {
  status: string;
  variableCount: number;
};

export type MetaWhatsAppAdminDiagnostics = {
  connected: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  subscribedApps: string[];
  approvedTemplates: MetaApprovedTemplate[];
  templates: MetaTemplateStatus[];
  templateMappings: Record<string, string>;
  templateLanguage: string;
  errorCode: string | null;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function graphRequest(
  config: MetaWhatsAppWebhookConfig,
  path: string,
  init?: RequestInit,
): Promise<JsonObject> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${config.graphApiVersion}/${path.replace(/^\//, "")}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
        signal: controller.signal,
        cache: "no-store",
      },
    );

    let body: unknown = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }

    if (!response.ok) {
      const errorObject = isObject(body) && isObject(body.error) ? body.error : {};
      const metaCode =
        typeof errorObject.code === "number" && Number.isFinite(errorObject.code)
          ? errorObject.code
          : null;
      const subcode =
        typeof errorObject.error_subcode === "number" && Number.isFinite(errorObject.error_subcode)
          ? errorObject.error_subcode
          : null;
      const suffix = [
        metaCode !== null ? `code_${metaCode}` : null,
        subcode !== null ? `subcode_${subcode}` : null,
      ]
        .filter(Boolean)
        .join("_");
      throw new Error(`meta_graph_http_${response.status}${suffix ? `_${suffix}` : ""}`);
    }

    return isObject(body) ? body : {};
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("meta_graph_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadConfig(studioId: string) {
  const service = createServiceClient();
  const config = await loadMetaWhatsAppWebhookConfig(service, studioId);
  if (!config) throw new Error("meta_whatsapp_not_configured");
  return config;
}

function subscribedAppNames(body: JsonObject) {
  const data = Array.isArray(body.data) ? body.data : [];
  const names = new Set<string>();

  for (const item of data) {
    const row = isObject(item) ? item : {};
    const whatsappData = isObject(row.whatsapp_business_api_data)
      ? row.whatsapp_business_api_data
      : row;
    const name = textValue(whatsappData.name);
    if (name) names.add(name);
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

function componentNeedsParameters(value: unknown) {
  if (!Array.isArray(value)) return false;

  const placeholder = /{{\s*\d+\s*}}/;
  const visit = (input: unknown): boolean => {
    if (typeof input === "string") return placeholder.test(input);
    if (Array.isArray(input)) return input.some(visit);
    if (isObject(input)) return Object.values(input).some(visit);
    return false;
  };

  return value.some(visit);
}

function componentVariableCount(value: unknown) {
  const numbers = new Set<number>();
  const visit = (input: unknown) => {
    if (typeof input === "string") {
      for (const match of input.matchAll(/{{\s*(\d+)\s*}}/g)) numbers.add(Number(match[1]));
    } else if (Array.isArray(input)) {
      input.forEach(visit);
    } else if (isObject(input)) {
      Object.values(input).forEach(visit);
    }
  };
  visit(value);
  return numbers.size;
}

function approvedTemplates(body: JsonObject): MetaApprovedTemplate[] {
  const data = Array.isArray(body.data) ? body.data : [];
  const templates: MetaApprovedTemplate[] = [];

  for (const item of data) {
    const row = isObject(item) ? item : {};
    const name = textValue(row.name);
    const language = textValue(row.language);
    const status = textValue(row.status)?.toUpperCase();
    if (!name || !language || status !== "APPROVED") continue;

    templates.push({
      name,
      language,
      category: textValue(row.category),
      testReady: !componentNeedsParameters(row.components),
    });
  }

  return templates.sort((left, right) =>
    `${left.name}:${left.language}`.localeCompare(`${right.name}:${right.language}`),
  );
}

function templatesWithStatus(body: JsonObject): MetaTemplateStatus[] {
  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .flatMap((item) => {
      const row = isObject(item) ? item : {};
      const name = textValue(row.name);
      const language = textValue(row.language);
      const status = textValue(row.status)?.toUpperCase();
      if (!name || !language || !status) return [];
      return [
        {
          name,
          language,
          status,
          category: textValue(row.category),
          testReady: !componentNeedsParameters(row.components),
          variableCount: componentVariableCount(row.components),
        },
      ];
    })
    .sort((left, right) =>
      `${left.name}:${left.language}`.localeCompare(`${right.name}:${right.language}`),
    );
}

export async function getMetaWhatsAppAdminDiagnostics(
  studioId: string,
): Promise<MetaWhatsAppAdminDiagnostics> {
  try {
    const config = await loadConfig(studioId);

    const [phone, subscriptions, templates] = await Promise.all([
      graphRequest(
        config,
        `${config.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
      ),
      graphRequest(config, `${config.wabaId}/subscribed_apps?limit=50`),
      graphRequest(
        config,
        `${config.wabaId}/message_templates?limit=100&fields=name,status,language,category,components`,
      ),
    ]);

    return {
      connected: true,
      phoneNumberId: config.phoneNumberId,
      wabaId: config.wabaId,
      displayPhoneNumber: textValue(phone.display_phone_number),
      verifiedName: textValue(phone.verified_name),
      qualityRating: textValue(phone.quality_rating),
      subscribedApps: subscribedAppNames(subscriptions),
      approvedTemplates: approvedTemplates(templates),
      templates: templatesWithStatus(templates),
      templateMappings: config.templates,
      templateLanguage: config.languageCode,
      errorCode: null,
    };
  } catch (error) {
    return {
      connected: false,
      phoneNumberId: null,
      wabaId: null,
      displayPhoneNumber: null,
      verifiedName: null,
      qualityRating: null,
      subscribedApps: [],
      approvedTemplates: [],
      templates: [],
      templateMappings: {},
      templateLanguage: "es_MX",
      errorCode: error instanceof Error ? error.message : "meta_admin_check_failed",
    };
  }
}

export async function submitMetaWhatsAppTemplate(input: {
  studioId: string;
  name: string;
  languageCode: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  expectedVariables: number;
}) {
  const config = await loadConfig(input.studioId);
  const name = input.name.trim().toLowerCase();
  const languageCode = input.languageCode.trim();
  const body = input.body.trim();

  const validationError = validateMetaWhatsAppTemplateDraft({ ...input, name, languageCode, body });
  if (validationError) throw new Error(validationError);

  const response = await graphRequest(config, `${config.wabaId}/message_templates`, {
    method: "POST",
    body: JSON.stringify({
      name,
      language: languageCode,
      category: input.category,
      components: [{ type: "BODY", text: body }],
    }),
  });

  const id = textValue(response.id);
  if (!id) throw new Error("meta_template_submission_id_missing");
  return { id, status: textValue(response.status)?.toUpperCase() ?? "PENDING" };
}

export async function subscribeMetaWhatsAppApp(studioId: string) {
  const config = await loadConfig(studioId);
  const response = await graphRequest(config, `${config.wabaId}/subscribed_apps`, {
    method: "POST",
    body: "{}",
  });

  if (response.success !== true) {
    throw new Error("meta_subscribe_failed");
  }

  return true;
}

export async function sendMetaWhatsAppTemplateTest(input: {
  studioId: string;
  recipient: string;
  templateName: string;
  languageCode: string;
  bodyParameters?: string[];
}) {
  const config = await loadConfig(input.studioId);
  const normalized = normalizeMexicanPhone(input.recipient);
  if (!normalized) throw new Error("meta_test_phone_invalid");

  const templateName = input.templateName.trim();
  const languageCode = input.languageCode.trim();

  if (!/^[a-z0-9_]+$/.test(templateName)) {
    throw new Error("meta_test_template_invalid");
  }
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(languageCode)) {
    throw new Error("meta_test_language_invalid");
  }

  const response = await graphRequest(config, `${config.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalized.replace(/^\+/, ""),
      type: "template",
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        ...(input.bodyParameters?.length
          ? {
              components: [
                {
                  type: "body",
                  parameters: input.bodyParameters.map((text) => ({ type: "text", text })),
                },
              ],
            }
          : {}),
      },
    }),
  });

  const messages = Array.isArray(response.messages) ? response.messages : [];
  const first = isObject(messages[0]) ? messages[0] : {};
  const messageId = textValue(first.id);
  if (!messageId) throw new Error("meta_test_message_id_missing");

  return messageId;
}

// Read the approved provider definition; never guess parameters for a financial template.
export async function getMetaWhatsAppUatWelcome(studioId: string) {
  const config = await loadConfig(studioId);
  const response = await graphRequest(
    config,
    `${config.wabaId}/message_templates?limit=100&fields=name,status,language,components`,
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  for (const preferred of ["demeter_bienvenida", "student_welcome_2", "bienvenida_alumna"]) {
    for (const item of rows) {
      if (
        !isObject(item) ||
        item.name !== preferred ||
        item.status !== "APPROVED" ||
        typeof item.language !== "string" ||
        !Array.isArray(item.components)
      )
        continue;
      let bodyCount = 0;
      let compatible = true;
      for (const component of item.components) {
        if (!isObject(component)) {
          compatible = false;
          break;
        }
        if (component.type === "BODY") {
          const text = String(component.text ?? "");
          const refs = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
          if (refs.some((n) => n !== 1) || /\{\{\s*[^\d\s]/.test(text)) compatible = false;
          bodyCount = refs.length ? 1 : 0;
        } else if (component.type === "HEADER") {
          if (component.format !== "TEXT" || /\{\{/.test(JSON.stringify(component)))
            compatible = false;
        } else if (/\{\{/.test(JSON.stringify(component))) compatible = false;
      }
      if (compatible)
        return {
          name: preferred,
          language: item.language,
          bodyParameters: bodyCount ? ["Prueba UAT Demi"] : [],
        };
    }
  }
  return null;
}

export async function getMetaWhatsAppWebhookRouting(studioId: string) {
  const config = await loadConfig(studioId);
  const subscriptions = await graphRequest(config, `${config.wabaId}/subscribed_apps?limit=50`);
  const apps = Array.isArray(subscriptions.data) ? subscriptions.data : [];
  const routes: { source: string; host: string; path: string; studio_id: string | null }[] = [];
  const errors: string[] = [];
  const recordRoute = (value: unknown, source: string) => {
    if (typeof value !== "string") return;
    try {
      const url = new URL(value);
      routes.push({
        source,
        host: url.host,
        path: url.pathname,
        studio_id: url.searchParams.get("studio") ?? url.searchParams.get("studio_id"),
      });
    } catch {
      errors.push("callback_url_invalid");
    }
  };
  for (const item of apps) {
    if (!isObject(item)) continue;
    if (typeof item.override_callback_uri === "string") {
      recordRoute(item.override_callback_uri, "waba_override");
      continue;
    }
    const app = isObject(item.whatsapp_business_api_data) ? item.whatsapp_business_api_data : {};
    const appId = textValue(app.id);
    if (!appId || !/^\d+$/.test(appId)) {
      errors.push("subscription_app_id_unavailable");
      continue;
    }
    try {
      const result = await graphRequest(config, `${appId}/subscriptions`, {
        headers: { authorization: `Bearer ${appId}|${config.appSecret}` },
      });
      const rows = Array.isArray(result.data) ? result.data : [];
      for (const row of rows)
        if (isObject(row) && row.object === "whatsapp_business_account")
          recordRoute(row.callback_url, "app_subscription");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "callback_lookup_failed");
    }
  }
  return { routes, error_codes: errors, verified: routes.length > 0 };
}
