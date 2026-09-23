import { createClient } from "npm:@supabase/supabase-js@2";

type AsistianWebhookBody = {
  event?: unknown;
  event_id?: unknown;
  timestamp?: unknown;
  data?: unknown;
  [key: string]: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function signatureParts(value: string | null) {
  const parts = new Map<string, string>();
  for (const rawPart of value?.split(",") ?? []) {
    const [key, ...rest] = rawPart.trim().split("=");
    const normalizedKey = key?.trim();
    const normalizedValue = rest.join("=").trim();
    if (normalizedKey && normalizedValue) parts.set(normalizedKey, normalizedValue);
  }
  return {
    timestamp: parts.get("t") ?? null,
    signature: parts.get("v1") ?? null,
  };
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(leftHex: string, rightHex: string) {
  const left = hexBytes(leftHex);
  const right = hexBytes(rightHex);
  if (!left || !right || left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyAsistianSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
) {
  const { timestamp, signature } = signatureParts(signatureHeader);
  if (!timestamp || !signature) {
    return { ok: false, timestamp };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return { ok: constantTimeEqual(expected, signature), timestamp };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "receiver_not_configured" }, 503);
  }

  const url = new URL(request.url);
  const studioId = safeText(url.searchParams.get("studio"));
  if (
    !studioId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      studioId,
    )
  ) {
    return jsonResponse({ error: "studio_invalid" }, 400);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 262_144) {
    return jsonResponse({ error: "payload_too_large" }, 413);
  }

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 262_144) {
    return jsonResponse({ error: "payload_invalid" }, rawBody ? 413 : 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: secretData, error: secretError } = await supabase.rpc(
    "service_get_asistian_to_studio_signing_secret",
    { target_studio_id: studioId },
  );
  const signingSecret = safeText(secretData);
  if (secretError || !signingSecret) {
    return jsonResponse({ error: "receiver_secret_missing" }, 503);
  }

  const verification = await verifyAsistianSignature(
    signingSecret,
    rawBody,
    request.headers.get("x-asistian-signature"),
  );
  if (!verification.ok) {
    return jsonResponse({ error: "invalid_signature" }, 401);
  }

  let body: AsistianWebhookBody;
  try {
    body = JSON.parse(rawBody) as AsistianWebhookBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const headerEventId = safeText(request.headers.get("x-webhook-id"));
  const bodyEventId = safeText(body.event_id);
  if (headerEventId && bodyEventId && headerEventId !== bodyEventId) {
    return jsonResponse({ error: "event_id_mismatch" }, 400);
  }

  const providerEventId = bodyEventId ?? headerEventId;
  const eventName = safeText(body.event) ?? safeText(request.headers.get("x-webhook-event"));
  if (!providerEventId || !eventName) {
    return jsonResponse({ error: "event_identity_missing" }, 400);
  }

  const attemptRaw = safeText(request.headers.get("x-webhook-attempt"));
  const parsedAttempt = attemptRaw ? Number.parseInt(attemptRaw, 10) : null;
  const attempt =
    parsedAttempt !== null && Number.isInteger(parsedAttempt) && parsedAttempt >= 1
      ? parsedAttempt
      : null;

  const providerTimestamp =
    safeText(body.timestamp) ??
    safeText(request.headers.get("x-webhook-timestamp")) ??
    verification.timestamp;

  const { error: insertError } = await supabase.from("asistian_webhook_events").insert({
    studio_id: studioId,
    provider_event_id: providerEventId,
    event_name: eventName,
    provider_timestamp: providerTimestamp,
    attempt,
    payload: body,
    processing_status: "captured",
  });

  if (insertError?.code === "23505") {
    return jsonResponse({
      ok: true,
      accepted: true,
      duplicate: true,
      event_id: providerEventId,
    });
  }

  if (insertError) {
    return jsonResponse({ error: "capture_failed" }, 500);
  }

  return jsonResponse(
    {
      ok: true,
      accepted: true,
      duplicate: false,
      event_id: providerEventId,
    },
    202,
  );
});
