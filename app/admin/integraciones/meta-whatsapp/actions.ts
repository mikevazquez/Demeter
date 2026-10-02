"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(
    /(meta_app_secret_invalid|meta_verify_token_invalid|meta_whatsapp_not_configured|meta_whatsapp_connection_incomplete|pilot_phone_invalid|forbidden)/,
  );
  return match?.[1] ?? "save_failed";
}

export async function saveMetaWhatsAppInbound(formData: FormData) {
  const appSecret = String(formData.get("app_secret") ?? "").trim();
  const verifyToken = String(formData.get("verify_token") ?? "").trim();

  if (!appSecret) {
    redirect(
      "/admin/integraciones/meta-whatsapp?inbound=error&code=meta_app_secret_required",
    );
  }

  const { supabase, studio } = await getAdminContext(
    CAPABILITIES.SETTINGS_WRITE,
  );

  const { error } = await supabase.rpc("admin_set_meta_whatsapp_inbound", {
    target_studio_id: studio.id,
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
    redirect(
      "/admin/integraciones/meta-whatsapp?pilot=error&code=pilot_phone_required",
    );
  }

  const { supabase, studio } = await getAdminContext(
    CAPABILITIES.SETTINGS_WRITE,
  );

  const { error: pilotError } = await supabase.rpc(
    "admin_set_meta_whatsapp_pilot_contact",
    {
      target_studio_id: studio.id,
      target_contact_phone: phone,
    },
  );

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
    redirect(
      "/admin/integraciones/meta-whatsapp?pilot=error&code=pilot_mode_update_failed",
    );
  }

  revalidatePath("/admin/integraciones/meta-whatsapp");
  redirect("/admin/integraciones/meta-whatsapp?pilot=active");
}

export async function disableMetaWhatsAppPilot() {
  const { supabase, studio } = await getAdminContext(
    CAPABILITIES.SETTINGS_WRITE,
  );

  const { error } = await supabase
    .from("assistant_configs")
    .update({
      mode: "demo",
      updated_at: new Date().toISOString(),
    })
    .eq("studio_id", studio.id);

  if (error) {
    redirect(
      "/admin/integraciones/meta-whatsapp?pilot=error&code=pilot_mode_update_failed",
    );
  }

  revalidatePath("/admin/integraciones/meta-whatsapp");
  redirect("/admin/integraciones/meta-whatsapp?pilot=disabled");
}
