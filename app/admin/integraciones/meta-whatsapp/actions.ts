"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(
    /(meta_access_token_invalid|meta_phone_number_id_invalid|meta_waba_id_invalid|meta_graph_api_version_invalid|meta_app_secret_invalid|meta_verify_token_invalid|meta_whatsapp_not_configured|meta_whatsapp_connection_incomplete|pilot_phone_invalid|forbidden)/,
  );
  return match?.[1] ?? "save_failed";
}

export async function saveMetaWhatsAppConnection(formData: FormData) {
  const accessToken = String(formData.get("access_token") ?? "").trim();
  const phoneNumberId = String(formData.get("phone_number_id") ?? "").trim();
  const wabaId = String(formData.get("waba_id") ?? "").trim();
  const graphApiVersion = String(formData.get("graph_api_version") ?? "").trim();
  const appSecret = String(formData.get("app_secret") ?? "").trim();
  const verifyToken = String(formData.get("verify_token") ?? "").trim();

  if (!accessToken || !phoneNumberId || !wabaId || !graphApiVersion || !appSecret) {
    redirect(
      "/admin/integraciones/meta-whatsapp?inbound=error&code=meta_connection_fields_required",
    );
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const { error } = await supabase.rpc("admin_set_meta_whatsapp_connection", {
    target_studio_id: studio.id,
    target_access_token: accessToken,
    target_phone_number_id: phoneNumberId,
    target_waba_id: wabaId,
    target_graph_api_version: graphApiVersion,
    target_app_secret: appSecret,
    target_verify_token: verifyToken || null,
  });

  if (error) {
    redirect(
      `/admin/integraciones/meta-whatsapp?inbound=error&code=${encodeURIComponent(
        safeCode(error),
      )}`,
    );
  }

  revalidatePath("/admin/integraciones/meta-whatsapp");
  redirect("/admin/integraciones/meta-whatsapp?inbound=saved");
}

export async function activateMetaWhatsAppPilot(formData: FormData) {
  const phone = String(formData.get("pilot_phone") ?? "").trim();
  if (!phone) {
    redirect("/admin/integraciones/meta-whatsapp?pilot=error&code=pilot_phone_required");
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const { error: pilotError } = await supabase.rpc("admin_set_meta_whatsapp_pilot_contact", {
    target_studio_id: studio.id,
    target_contact_phone: phone,
  });

  if (pilotError) {
    redirect(
      `/admin/integraciones/meta-whatsapp?pilot=error&code=${encodeURIComponent(
        safeCode(pilotError),
      )}`,
    );
  }

  const { error: modeError } = await supabase
    .from("assistant_configs")
    .update({
      mode: "pilot",
      updated_at: new Date().toISOString(),
    })
    .eq("studio_id", studio.id);

  if (modeError) {
    redirect("/admin/integraciones/meta-whatsapp?pilot=error&code=pilot_mode_update_failed");
  }

  revalidatePath("/admin/integraciones/meta-whatsapp");
  redirect("/admin/integraciones/meta-whatsapp?pilot=active");
}

export async function disableMetaWhatsAppPilot() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const { error } = await supabase
    .from("assistant_configs")
    .update({
      mode: "demo",
      updated_at: new Date().toISOString(),
    })
    .eq("studio_id", studio.id);

  if (error) {
    redirect("/admin/integraciones/meta-whatsapp?pilot=error&code=pilot_mode_update_failed");
  }

  revalidatePath("/admin/integraciones/meta-whatsapp");
  redirect("/admin/integraciones/meta-whatsapp?pilot=disabled");
}
