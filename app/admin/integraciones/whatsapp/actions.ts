"use server";

import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

const TEMPLATE_FIELDS = [
  "student_welcome",
  "reservation_confirmed",
  "reservation_cancelled",
  "waitlist_promoted",
  "class_reminder",
  "class_cancelled_coach",
] as const;

function fieldText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function normalizePhone(value: string, countryCallingCode: string) {
  const digits = value.replace(/\D/g, "");
  const countryCode = countryCallingCode.replace(/\D/g, "");

  if (/^[1-9][0-9]{9}$/.test(digits) && /^[1-9][0-9]{0,2}$/.test(countryCode)) {
    return `${countryCode}${digits}`;
  }

  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

async function parseResponse(response: Response) {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function saveMetaWhatsappConnection(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const wabaId = fieldText(formData, "waba_id");
  const phoneNumberId = fieldText(formData, "phone_number_id");
  const accessToken = fieldText(formData, "access_token");
  const graphApiVersion = fieldText(formData, "graph_api_version") || "v26.0";
  const languageCode = fieldText(formData, "language_code") || "es_MX";
  const countryCallingCode = fieldText(formData, "country_calling_code") || "52";
  const testRecipientRaw = fieldText(formData, "test_recipient");

  if (!/^\d+$/.test(wabaId) || !/^\d+$/.test(phoneNumberId)) {
    redirect("/admin/integraciones/whatsapp?error=ids_invalid");
  }

  if (accessToken.length < 20) {
    redirect("/admin/integraciones/whatsapp?error=token_invalid");
  }

  if (!/^v\d+\.\d+$/.test(graphApiVersion)) {
    redirect("/admin/integraciones/whatsapp?error=version_invalid");
  }

  if (!/^[a-z]{2}_[A-Z]{2}$/.test(languageCode)) {
    redirect("/admin/integraciones/whatsapp?error=language_invalid");
  }

  if (!/^[1-9][0-9]{0,2}$/.test(countryCallingCode)) {
    redirect("/admin/integraciones/whatsapp?error=country_invalid");
  }

  const templates = Object.fromEntries(
    TEMPLATE_FIELDS.map((key) => [key, fieldText(formData, `template_${key}`)]).filter(
      ([, value]) => Boolean(value),
    ),
  );

  if (
    Object.values(templates).some(
      (templateName) => typeof templateName !== "string" || !/^[a-z0-9_]+$/.test(templateName),
    )
  ) {
    redirect("/admin/integraciones/whatsapp?error=template_invalid");
  }

  const phoneLookupUrl =
    `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}` +
    "?fields=verified_name,display_phone_number,quality_rating";

  let phoneLookup: Response;
  try {
    phoneLookup = await fetch(phoneLookupUrl, {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    redirect("/admin/integraciones/whatsapp?error=meta_network");
  }

  if (!phoneLookup.ok) {
    redirect(
      `/admin/integraciones/whatsapp?error=meta_http&status=${encodeURIComponent(
        String(phoneLookup.status),
      )}`,
    );
  }

  await parseResponse(phoneLookup);

  const { error: saveError } = await supabase.rpc("admin_set_meta_whatsapp_connection", {
    target_studio_id: studio.id,
    target_waba_id: wabaId,
    target_phone_number_id: phoneNumberId,
    target_access_token: accessToken,
    target_graph_api_version: graphApiVersion,
    target_language_code: languageCode,
    target_country_calling_code: countryCallingCode,
    target_templates: templates,
  });

  if (saveError) {
    redirect("/admin/integraciones/whatsapp?error=save_failed");
  }

  if (testRecipientRaw) {
    const recipient = normalizePhone(testRecipientRaw, countryCallingCode);
    if (!recipient) {
      redirect("/admin/integraciones/whatsapp?saved=1&error=test_phone_invalid");
    }

    let testResponse: Response;
    try {
      testResponse = await fetch(
        `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: recipient,
            type: "template",
            template: {
              name: "hello_world",
              language: { code: "en_US" },
            },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      redirect("/admin/integraciones/whatsapp?saved=1&error=test_network");
    }

    if (!testResponse.ok) {
      redirect(
        `/admin/integraciones/whatsapp?saved=1&error=test_http&status=${encodeURIComponent(
          String(testResponse.status),
        )}`,
      );
    }

    redirect("/admin/integraciones/whatsapp?connected=1&test_sent=1");
  }

  redirect("/admin/integraciones/whatsapp?connected=1");
}
