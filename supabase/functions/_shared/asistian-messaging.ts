import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

export type AsistianDeliveryResult =
  | {
      status: "accepted";
      providerReference: string;
      httpStatus: number;
    }
  | {
      status: "skipped" | "error";
      errorCode: string;
      retryable: boolean;
      httpStatus?: number;
    };

export type AsistianDeliveryInput = {
  adminClient: SupabaseClient;
  studioId: string;
  template:
    | "student_welcome"
    | "reservation_confirmed"
    | "reservation_cancelled"
    | "waitlist_promoted"
    | "class_reminder"
    | "class_cancelled_coach";
  eventId: string;
  recipient: string;
  variables: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  now?: () => Date;
  fetcher?: typeof fetch;
};

function retryableHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function validWebhookUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function validSigningSecret(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function createAsistianSignature(secret: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `sha256=${hex}`;
}

export async function sendAsistianWebhook(
  input: AsistianDeliveryInput,
): Promise<AsistianDeliveryResult> {
  const [
    { data: configuredUrl, error: webhookError },
    { data: configuredSecret, error: signingSecretError },
  ] = await Promise.all([
    input.adminClient.rpc("service_get_asistian_webhook", {
      target_studio_id: input.studioId,
      target_template: input.template,
    }),
    input.adminClient.rpc("service_get_asistian_signing_secret", {
      target_studio_id: input.studioId,
      target_template: input.template,
    }),
  ]);

  if (webhookError) {
    return {
      status: "error",
      errorCode: "asistian_webhook_lookup_failed",
      retryable: true,
    };
  }

  if (signingSecretError) {
    return {
      status: "error",
      errorCode: "asistian_signing_secret_lookup_failed",
      retryable: true,
    };
  }

  const webhookUrl = validWebhookUrl(configuredUrl);
  if (!webhookUrl) {
    return {
      status: "skipped",
      errorCode: "asistian_webhook_not_configured",
      retryable: false,
    };
  }

  const signingSecret = validSigningSecret(configuredSecret);
  if (!signingSecret) {
    return {
      status: "skipped",
      errorCode: "asistian_signing_secret_not_configured",
      retryable: false,
    };
  }

  const payload = {
    event: input.template,
    event_id: input.eventId,
    timestamp: (input.now ?? (() => new Date()))().toISOString(),
    phone: input.recipient,
    data: input.variables,
    metadata: input.metadata ?? {},
  };
  const body = JSON.stringify(payload);

  let signature: string;
  try {
    signature = await createAsistianSignature(signingSecret, body);
  } catch {
    return {
      status: "error",
      errorCode: "asistian_signing_failed",
      retryable: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await (input.fetcher ?? fetch)(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Webhook-Signature": signature,
        "Idempotency-Key": input.eventId,
        "x-studio-flow-event-id": input.eventId,
      },
      body,
      signal: controller.signal,
    });

    if (response.ok) {
      return {
        status: "accepted",
        providerReference: `asistian:${input.eventId}`,
        httpStatus: response.status,
      };
    }

    return {
      status: "error",
      errorCode: `asistian_http_${response.status}`,
      retryable: retryableHttpStatus(response.status),
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      status: "error",
      errorCode:
        error instanceof Error && error.name === "AbortError"
          ? "asistian_timeout"
          : "asistian_network_error",
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}
