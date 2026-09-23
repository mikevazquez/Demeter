"use server";

import { createHmac } from "node:crypto";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

const ASISTIAN_TEMPLATE = "reservation_confirmed";

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

export async function saveAsistianToStudioReceiverSecret(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const signingSecret = String(formData.get("provider_signing_secret") ?? "").trim();

  if (signingSecret.length < 12) {
    redirect("/admin/integraciones/asistian?error=receiver_secret_invalid");
  }

  const { error } = await supabase.rpc("admin_set_asistian_to_studio_signing_secret", {
    target_studio_id: studio.id,
    target_secret: signingSecret,
  });

  if (error) {
    redirect("/admin/integraciones/asistian?error=receiver_secret_save");
  }

  redirect("/admin/integraciones/asistian?receiver_saved=1");
}

export async function saveAsistianServiceMapping(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const serviceName = String(formData.get("service_name") ?? "").trim();
  const classTemplateId = String(formData.get("class_template_id") ?? "").trim();

  if (!serviceId || !classTemplateId) {
    redirect("/admin/integraciones/asistian?error=service_mapping_invalid");
  }

  const { error } = await supabase.rpc("admin_upsert_asistian_service_mapping", {
    target_studio_id: studio.id,
    target_service_id: serviceId,
    target_service_name: serviceName || null,
    target_class_template_id: classTemplateId,
  });

  if (error) {
    redirect("/admin/integraciones/asistian?error=service_mapping_save");
  }

  redirect("/admin/integraciones/asistian?service_mapping_saved=1");
}

export async function sendAsistianMappingProbe(formData: FormData) {
  await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const webhookUrl = safeWebhookUrl(String(formData.get("test_webhook_url") ?? ""));
  if (!webhookUrl) {
    redirect("/admin/integraciones/asistian?error=invalid_url");
  }

  const eventId = crypto.randomUUID();
  const payload = {
    event: "reservation_confirmed",
    event_id: eventId,
    timestamp: new Date().toISOString(),
    phone: "+5213300000000",
    data: {
      nombre: "Marco",
      disciplina: "Pole Fitness",
      fecha: "22/09/2026",
      hora: "19:30",
      coach: "Mike",
      ubicacion: "Demeter Fitness Studio",
    },
    metadata: {
      source: "studio_flow_mapping_probe",
      test: true,
    },
  };

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": eventId,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    redirect("/admin/integraciones/asistian?error=network");
  }

  if (!response.ok && response.status !== 403) {
    redirect(
      `/admin/integraciones/asistian?error=http&status=${encodeURIComponent(String(response.status))}`,
    );
  }

  redirect(
    `/admin/integraciones/asistian?mapping_sent=1&status=${encodeURIComponent(String(response.status))}`,
  );
}

export async function sendAsistianHandshake(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const webhookUrl = safeWebhookUrl(String(formData.get("webhook_url") ?? ""));
  if (!webhookUrl) {
    redirect("/admin/integraciones/asistian?error=invalid_url");
  }

  const signingSecret = String(formData.get("signing_secret") ?? "").trim();
  if (signingSecret.length < 12) {
    redirect("/admin/integraciones/asistian?error=invalid_secret");
  }

  const { error: saveError } = await supabase.rpc("admin_set_asistian_webhook_credentials", {
    target_studio_id: studio.id,
    target_template: ASISTIAN_TEMPLATE,
    target_url: webhookUrl,
    target_secret: signingSecret,
  });

  if (saveError) {
    redirect("/admin/integraciones/asistian?error=save");
  }

  const eventId = crypto.randomUUID();
  const payload = {
    event: ASISTIAN_TEMPLATE,
    event_id: eventId,
    timestamp: new Date().toISOString(),
    phone: "+5213300000000",
    data: {
      nombre: "Prueba Studio Flow",
      disciplina: "Pole Fitness",
      fecha: "23/09/2026",
      hora: "18:00",
      coach: "Coach de prueba",
      ubicacion: "Demeter Fitness Studio",
    },
    metadata: {
      source: "studio_flow_reservation_confirmation_handshake",
      test: true,
    },
  };
  const body = JSON.stringify(payload);
  const signature =
    "sha256=" + createHmac("sha256", signingSecret).update(body, "utf8").digest("hex");

  let response: Response;

  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Webhook-Signature": signature,
        "Idempotency-Key": eventId,
        "x-studio-flow-event-id": eventId,
      },
      body,
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
