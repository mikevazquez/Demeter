"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(
    /(meta_page_access_token_invalid|meta_page_id_invalid|meta_instagram_access_token_invalid|meta_instagram_user_id_invalid|meta_graph_api_version_invalid|meta_app_secret_invalid|meta_verify_token_invalid|meta_inbox_not_configured|meta_instagram_pilot_contact_invalid|meta_messenger_pilot_contact_invalid|forbidden)/,
  );
  return match?.[1] ?? "save_failed";
}

export async function saveMetaInboxConnection(formData: FormData) {
  const pageAccessToken = String(formData.get("page_access_token") ?? "").trim();
  const pageId = String(formData.get("page_id") ?? "").trim();
  const instagramAccessToken = String(formData.get("instagram_access_token") ?? "").trim();
  const instagramUserId = String(formData.get("instagram_user_id") ?? "").trim();
  const graphApiVersion = String(formData.get("graph_api_version") ?? "").trim();
  const appSecret = String(formData.get("app_secret") ?? "").trim();
  const verifyToken = String(formData.get("verify_token") ?? "").trim();

  if (
    !pageAccessToken ||
    !pageId ||
    !instagramAccessToken ||
    !instagramUserId ||
    !graphApiVersion ||
    !appSecret
  ) {
    redirect("/admin/integraciones/meta-inbox?connection=error&code=required_fields");
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { error } = await supabase.rpc("admin_set_meta_inbox_connection", {
    target_studio_id: studio.id,
    target_page_access_token: pageAccessToken,
    target_page_id: pageId,
    target_instagram_access_token: instagramAccessToken,
    target_instagram_user_id: instagramUserId,
    target_graph_api_version: graphApiVersion,
    target_app_secret: appSecret,
    target_verify_token: verifyToken || null,
  });

  if (error) {
    redirect(
      `/admin/integraciones/meta-inbox?connection=error&code=${encodeURIComponent(
        safeCode(error),
      )}`,
    );
  }

  revalidatePath("/admin/integraciones");
  revalidatePath("/admin/integraciones/meta-inbox");
  redirect("/admin/integraciones/meta-inbox?connection=saved");
}

export async function saveMetaInboxPilotContacts(formData: FormData) {
  const instagramContactId = String(formData.get("instagram_contact_id") ?? "").trim();
  const messengerContactId = String(formData.get("messenger_contact_id") ?? "").trim();

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { error } = await supabase.rpc("admin_set_meta_inbox_pilot_contacts", {
    target_studio_id: studio.id,
    target_instagram_contact_id: instagramContactId || null,
    target_messenger_contact_id: messengerContactId || null,
  });

  if (error) {
    redirect(
      `/admin/integraciones/meta-inbox?pilot=error&code=${encodeURIComponent(
        safeCode(error),
      )}`,
    );
  }

  revalidatePath("/admin/integraciones/meta-inbox");
  redirect("/admin/integraciones/meta-inbox?pilot=saved");
}
