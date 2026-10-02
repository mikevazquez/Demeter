"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(
    /(meta_app_secret_invalid|meta_verify_token_invalid|meta_whatsapp_not_configured|meta_whatsapp_connection_incomplete|forbidden)/,
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
