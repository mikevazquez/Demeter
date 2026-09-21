"use server";

import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function safeWebhookUrl(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function sendAsistianHandshake(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const webhookUrl = safeWebhookUrl(String(formData.get("webhook_url") ?? ""));
  if (!webhookUrl) {
    redirect("/admin/integraciones/asistian?error=invalid_url");
  }

  const { error: saveError } = await supabase.rpc("admin_set_asistian_webhook", {
    target_studio_id: studio.id,
    target_template: "student_welcome",
    target_url: webhookUrl,
  });

  if (saveError) {
    redirect("/admin/integraciones/asistian?error=save");
  }

  const eventId = crypto.randomUUID();
  const payload = {
    event: "sf174_handshake",
    event_id: eventId,
    timestamp: new Date().toISOString(),
    phone: "+5213300000000",
    data: {
      nombre: "Prueba Studio Flow",
      mensaje: "Handshake Studio Flow → Asistian",
      prueba: true,
    },
    metadata: {
      source: "studio_flow_preview",
      sf_ticket: "SF-174",
    },
  };

  let response: Response;

  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-studio-flow-event-id": eventId,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    redirect("/admin/integraciones/asistian?error=network");
  }

  if (!response.ok) {
    redirect(
      `/admin/integraciones/asistian?error=http&status=${encodeURIComponent(String(response.status))}`,
    );
  }

  redirect(
    `/admin/integraciones/asistian?sent=1&status=${encodeURIComponent(String(response.status))}`,
  );
}

export async function saveAsistianSigningSecret(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const signingSecret = String(formData.get("signing_secret") ?? "").trim();
  if (signingSecret.length < 12) {
    redirect("/admin/integraciones/asistian?error=invalid_secret");
  }

  const { error: saveError } = await supabase.rpc("admin_set_asistian_signing_secret", {
    target_studio_id: studio.id,
    target_secret: signingSecret,
  });

  if (saveError) {
    redirect("/admin/integraciones/asistian?error=secret_save");
  }

  redirect("/admin/integraciones/asistian?secret_saved=1");
}
