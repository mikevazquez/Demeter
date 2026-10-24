import "server-only";

import { createHmac } from "node:crypto";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { loadMetaWhatsAppWebhookConfig } from "@/lib/assistant/meta-whatsapp-channel";
import {
  dynamicUrlSuffix,
  recoveryTemplateShape,
  type RecoveryPortal,
} from "@/lib/auth/password-recovery-core";
import { studentAuthEmailFromPhone } from "@/lib/auth/student-login-identifier";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";

// AUTH-REC-01. Every public entry point answers the same way whether or not an account exists.

type Outcome =
  | "sent"
  | "no_account"
  | "rate_limited"
  | "delivery_failed"
  | "not_configured"
  | "template_without_link";

export type RecoveryRequestResult = {
  // Only filled outside production when AUTH_RECOVERY_PREVIEW_LINK=1, for Sandbox demos.
  previewLink: string | null;
};

const PASSWORD_RESET_TEMPLATE = "password_reset";

export async function requestOrigin() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host")?.trim();
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}

async function clientAddress() {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    null
  );
}

function hashSecret() {
  const secret =
    process.env.AUTH_RECOVERY_HASH_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("auth_recovery_secret_missing");
  return secret;
}

function previewLinksEnabled() {
  return (
    process.env.AUTH_RECOVERY_PREVIEW_LINK === "1" &&
    process.env.VERCEL_ENV !== "production" &&
    process.env.NODE_ENV !== "test"
  );
}

// Identifiers are never stored in clear text: an HMAC keyed by a server secret.
function recoveryIdentifierHash(secret: string, portal: RecoveryPortal, identifier: string) {
  return createHmac("sha256", secret)
    .update(`${portal}:${identifier.trim().toLowerCase()}`)
    .digest("hex");
}

type Service = ReturnType<typeof createServiceClient>;

async function beginRequest(service: Service, portal: RecoveryPortal, identifier: string) {
  const secret = hashSecret();
  const address = await clientAddress();
  const { data, error } = await service.rpc("service_begin_password_recovery_request", {
    p_portal: portal,
    p_identifier_hash: recoveryIdentifierHash(secret, portal, identifier),
    p_client_hash: address ? recoveryIdentifierHash(secret, portal, `ip:${address}`) : null,
  });

  if (error) {
    console.error("[auth.recovery] request log unavailable", { portal, code: error.code });
    return { allowed: false, requestId: null as string | null };
  }

  const result = (data ?? {}) as { allowed?: boolean; request_id?: string };
  return { allowed: result.allowed === true, requestId: result.request_id ?? null };
}

async function finishRequest(
  service: Service,
  requestId: string | null,
  outcome: Outcome,
  studioId: string | null = null,
) {
  if (!requestId) return;
  const { error } = await service.rpc("service_finish_password_recovery_request", {
    p_request_id: requestId,
    p_outcome: outcome,
    p_studio_id: studioId,
  });
  if (error) console.error("[auth.recovery] outcome not recorded", { outcome, code: error.code });
}

type GraphConfig = NonNullable<Awaited<ReturnType<typeof loadMetaWhatsAppWebhookConfig>>>;

async function graph(config: GraphConfig, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${config.graphApiVersion}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function sendRecoveryWhatsApp(input: {
  service: Service;
  studioId: string;
  phone: string;
  name: string;
  link: string;
}): Promise<Outcome> {
  const config = await loadMetaWhatsAppWebhookConfig(input.service, input.studioId).catch(
    () => null,
  );
  const templateName = config?.templates[PASSWORD_RESET_TEMPLATE];
  if (!config || !templateName) return "not_configured";

  const lookup = await graph(
    config,
    `${config.wabaId}/message_templates?name=${encodeURIComponent(templateName)}` +
      "&fields=name,status,language,components&limit=20",
  );
  const rows = Array.isArray(lookup.body.data)
    ? (lookup.body.data as Record<string, unknown>[])
    : [];
  const approved = rows.filter(
    (row) => row.name === templateName && String(row.status).toUpperCase() === "APPROVED",
  );
  const template =
    approved.find((row) => row.language === config.languageCode) ?? approved[0] ?? null;
  if (!lookup.ok || !template) return "not_configured";

  const shape = recoveryTemplateShape(template.components);
  const suffix =
    shape.urlButtonTemplate !== null ? dynamicUrlSuffix(shape.urlButtonTemplate, input.link) : null;
  if (shape.urlButtonIndex === null || !suffix || shape.bodyVariableCount > 1) {
    console.error("[auth.recovery] template cannot carry the recovery link", {
      hasUrlButton: shape.urlButtonIndex !== null,
      prefixMatches: Boolean(suffix),
      bodyVariables: shape.bodyVariableCount,
    });
    return "template_without_link";
  }

  const components: Record<string, unknown>[] = [];
  if (shape.bodyVariableCount === 1) {
    components.push({ type: "body", parameters: [{ type: "text", text: input.name }] });
  }
  components.push({
    type: "button",
    sub_type: "url",
    index: String(shape.urlButtonIndex),
    parameters: [{ type: "text", text: suffix }],
  });

  const sent = await graph(config, `${config.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.phone.replace(/\D/g, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: String(template.language ?? config.languageCode) },
        components,
      },
    }),
  });

  if (!sent.ok) {
    const metaError = (sent.body.error ?? {}) as { code?: unknown };
    console.error("[auth.recovery] whatsapp send failed", {
      status: sent.status,
      metaCode: typeof metaError.code === "number" ? metaError.code : null,
    });
    return "delivery_failed";
  }
  return "sent";
}

function firstName(fullName: unknown) {
  const name = typeof fullName === "string" ? fullName.trim().split(/\s+/)[0] : "";
  return name || "Alumna";
}

export async function requestStudentPasswordRecovery(
  phone: string,
  origin: string,
): Promise<RecoveryRequestResult> {
  const service = createServiceClient();
  const { allowed, requestId } = await beginRequest(service, "student", phone);
  if (!allowed) return { previewLink: null };

  const authEmail = studentAuthEmailFromPhone(phone);
  const { data: students } = await service
    .from("students")
    .select("id,studio_id,user_id,full_name,phone,active")
    .eq("phone", phone)
    .eq("active", true)
    .not("user_id", "is", null)
    .limit(5);

  const candidates = students ?? [];
  let student: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    const [{ data: account }, { data: membership }] = await Promise.all([
      service.from("user_accounts").select("status").eq("id", candidate.user_id).maybeSingle(),
      service
        .from("studio_memberships")
        .select("role")
        .eq("user_id", candidate.user_id)
        .eq("studio_id", candidate.studio_id)
        .eq("role", "student")
        .eq("active", true)
        .maybeSingle(),
    ]);
    if (account?.status === "active" && membership) {
      student = candidate;
      break;
    }
  }

  if (!student) {
    await finishRequest(service, requestId, "no_account");
    return { previewLink: null };
  }

  // The Auth alias is normally derived from the phone; older accounts may differ, so ask Auth.
  const { data: authUser } = await service.auth.admin.getUserById(student.user_id);
  const recoveryEmail = authUser.user?.email ?? authEmail;
  if (!recoveryEmail) {
    await finishRequest(service, requestId, "no_account", student.studio_id);
    return { previewLink: null };
  }

  const recoveryBase = `${origin}/login/student/recuperar/nueva`;
  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type: "recovery",
    email: recoveryEmail,
    options: { redirectTo: recoveryBase },
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    await finishRequest(service, requestId, "no_account", student.studio_id);
    return { previewLink: null };
  }

  const link = `${recoveryBase}?token_hash=${encodeURIComponent(tokenHash)}`;
  const outcome = await sendRecoveryWhatsApp({
    service,
    studioId: student.studio_id,
    phone,
    name: firstName(student.full_name),
    link,
  });
  await finishRequest(service, requestId, outcome, student.studio_id);

  return { previewLink: previewLinksEnabled() ? link : null };
}

export async function requestStudioPasswordRecovery(email: string, origin: string) {
  const service = createServiceClient();
  const { allowed, requestId } = await beginRequest(service, "studio", email);
  if (!allowed) return;

  // Implicit flow: the session arrives in the URL fragment, so the link works in any browser
  // (the PKCE verifier would only exist in the browser that asked for it).
  const authClient = createSupabaseClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false },
  });
  const { error } = await authClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/login/studio/recuperar/nueva`,
  });

  if (error) {
    console.error("[auth.recovery] email not sent", { status: error.status, code: error.code });
  }
  await finishRequest(service, requestId, error ? "delivery_failed" : "sent");
}
