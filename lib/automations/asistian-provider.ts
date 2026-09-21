import type {
  MessagingProvider,
  MessagingProviderInput,
  MessagingProviderResult,
} from "./messaging-provider";

export interface AsistianMessagingProviderConfig {
  webhookUrls: Readonly<Record<string, string>>;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export interface AsistianWebhookPayload {
  event: string;
  event_id: string;
  timestamp: string;
  phone: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function safeEventId(input: MessagingProviderInput): string {
  const metadataEventId = input.metadata.event_id;
  return typeof metadataEventId === "string" && metadataEventId.trim()
    ? metadataEventId.trim()
    : input.executionId;
}

function validateWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("asistian_webhook_url_invalid");
  }

  if (url.protocol !== "https:") {
    throw new Error("asistian_webhook_https_required");
  }

  return url.toString();
}

function normalizeTimeout(value: number | undefined) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 1_000 || value > 30_000) {
    throw new Error("asistian_timeout_invalid");
  }
  return Math.round(value);
}

function retryableHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function parseAsistianWebhookUrls(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) throw new Error("asistian_webhook_urls_required");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("asistian_webhook_urls_invalid_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("asistian_webhook_urls_invalid");
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.length) throw new Error("asistian_webhook_urls_required");

  return Object.fromEntries(
    entries.map(([template, value]) => [
      requiredText(template, "asistian_template_required"),
      validateWebhookUrl(requiredText(value, "asistian_webhook_url_required")),
    ]),
  );
}

export class AsistianMessagingProvider implements MessagingProvider {
  readonly key = "asistian";

  private readonly webhookUrls: Readonly<Record<string, string>>;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(config: AsistianMessagingProviderConfig) {
    this.webhookUrls = config.webhookUrls;
    this.timeoutMs = normalizeTimeout(config.timeoutMs);
    this.fetcher = config.fetcher ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  async send(input: MessagingProviderInput): Promise<MessagingProviderResult> {
    const configuredUrl = this.webhookUrls[input.template];
    if (!configuredUrl) {
      return {
        status: "error",
        errorCode: "asistian_webhook_not_configured",
        errorMessage: `No hay un webhook de Asistian configurado para ${input.template}.`,
        retryable: false,
      };
    }

    let webhookUrl: string;
    try {
      webhookUrl = validateWebhookUrl(configuredUrl);
    } catch (error) {
      return {
        status: "error",
        errorCode: error instanceof Error ? error.message : "asistian_webhook_invalid",
        errorMessage: "La URL configurada para Asistian no es válida.",
        retryable: false,
      };
    }

    const eventId = safeEventId(input);
    const payload: AsistianWebhookPayload = {
      event: input.template,
      event_id: eventId,
      timestamp: this.now().toISOString(),
      phone: input.recipient,
      data: input.variables,
      metadata: {
        ...input.metadata,
        execution_id: input.executionId,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-studio-flow-event-id": eventId,
          "x-studio-flow-execution-id": input.executionId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        return {
          status: "accepted",
          providerReference: `asistian:${eventId}`,
          responseSnapshot: {
            http_status: response.status,
            accepted: true,
          },
        };
      }

      return {
        status: "error",
        errorCode: `asistian_http_${response.status}`,
        errorMessage: `Asistian respondió HTTP ${response.status}.`,
        retryable: retryableHttpStatus(response.status),
        responseSnapshot: {
          http_status: response.status,
          accepted: false,
        },
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return {
        status: "error",
        errorCode: timedOut ? "asistian_timeout" : "asistian_network_error",
        errorMessage: timedOut
          ? "Asistian no respondió dentro del tiempo permitido."
          : "No se pudo conectar con el webhook de Asistian.",
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
