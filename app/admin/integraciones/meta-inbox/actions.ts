"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { createServiceClient } from "@/lib/supabase/service";

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(
    /(meta_page_access_token_invalid|meta_page_id_invalid|meta_instagram_access_token_invalid|meta_instagram_user_id_invalid|meta_graph_api_version_invalid|meta_app_secret_invalid|meta_verify_token_invalid|meta_page_credentials_incomplete|meta_instagram_credentials_incomplete|meta_channel_credentials_required|meta_inbox_not_configured|meta_instagram_pilot_contact_invalid|meta_messenger_pilot_contact_invalid|forbidden)/,
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

  // Channel credentials already on file are preserved by the secure RPC.
  // Allow an administrator to update an App Secret without re-entering Page tokens.
  if (!graphApiVersion) {
    redirect("/admin/integraciones/meta-inbox?connection=error&code=required_fields");
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  // Validate newly entered Facebook Page credentials before replacing the saved token.
  // Never put a token into a URL, logs, an error message, or client-side state.
  if (pageAccessToken || pageId) {
    if (!pageAccessToken || !/^[0-9]{5,32}$/.test(pageId)) {
      redirect("/admin/integraciones/meta-inbox?connection=error&code=page_credentials_pair_required");
    }
    type PageTokenStatus =
      | "valid" | "invalid" | "wrong_page" | "unavailable" | "expired"
      | "malformed" | "permissions" | "paste_format";
    let pageTokenStatus: PageTokenStatus = "unavailable";

    // Catch common copy/paste errors locally; never return or log the token.
    if (/^(?:Bearer\\s+|access_token\\s*=|https?:\\/\\/|["'])/i.test(pageAccessToken)
      || /\\s/.test(pageAccessToken)
      || /["']$/.test(pageAccessToken)) {
      pageTokenStatus = "paste_format";
    } else if (/^v[0-9]+\\.[0-9]+$/.test(graphApiVersion)) {
      try {
        const response = await fetch(
          `https://graph.facebook.com/${graphApiVersion}/me?fields=id`,
          {
            headers: {
              authorization: `Bearer ${pageAccessToken}`,
              accept: "application/json",
            },
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          },
        );
        const responseData: unknown = await response.json().catch(() => null);
        const value = responseData && typeof responseData === "object" && !Array.isArray(responseData)
          ? responseData as Record<string, unknown> : null;

        if (response.ok) {
          pageTokenStatus = String(value?.id ?? "") === pageId ? "valid" : "wrong_page";
        } else {
          const metaError = value?.error && typeof value.error === "object"
            ? value.error as Record<string, unknown> : null;
          const metaCode = typeof metaError?.code === "number" ? metaError.code : null;
          const metaSubcode = typeof metaError?.error_subcode === "number"
            ? metaError.error_subcode : null;
          const metaMessage = typeof metaError?.message === "string" ? metaError.message : "";

          if (metaCode === 190) {
            pageTokenStatus = [458, 463, 467].includes(metaSubcode ?? -1)
              ? "expired"
              : /cannot parse access token/i.test(metaMessage)
                ? "malformed"
                : "invalid";
          } else if (metaCode === 10 || metaCode === 200 || response.status === 403) {
            pageTokenStatus = "permissions";
          } else if (metaCode === 100 && /access.token/i.test(metaMessage)) {
            pageTokenStatus = "malformed";
          } else {
            pageTokenStatus = "unavailable";
          }
        }
      } catch {
        pageTokenStatus = "unavailable";
      }
    }
    if (pageTokenStatus !== "valid") {
      redirect(`/admin/integraciones/meta-inbox?connection=error&code=page_token_${pageTokenStatus}`);
    }
  }

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
  redirect(pageAccessToken ? "/admin/integraciones/meta-inbox?connection=page_token_valid" : "/admin/integraciones/meta-inbox?connection=saved");
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


// Credential diagnostic runs only by an authorized studio administrator. Secrets stay server-side.
export async function diagnoseMetaInboxApp(formData: FormData) {
  const appId = String(formData.get("app_id") ?? "").trim();
  if (!/^[0-9]{5,32}$/.test(appId)) {
    redirect("/admin/integraciones/meta-inbox?app_check=invalid_id");
  }

  const { studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  let result: "valid" | "mismatch" | "not_configured" | "unavailable" = "unavailable";

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("service_get_meta_inbox_webhook_config", {
      target_studio_id: studio.id,
    });
    const connection = data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
    const secret = typeof connection?.app_secret === "string" ? connection.app_secret.trim() : "";
    const apiVersion = typeof connection?.graph_api_version === "string" ? connection.graph_api_version.trim() : "";

    if (error || !secret || !/^v[0-9]+\.[0-9]+$/.test(apiVersion)) {
      result = "not_configured";
    } else {
      // App access token: only send over HTTPS in an authorization header.
      // Never return, persist, or log the Meta App Secret or resulting token.
      const url = new URL(`https://graph.facebook.com/${apiVersion}/${appId}`);
      url.searchParams.set("fields", "id,name");
      const response = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${appId}|${secret}`,
          accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const payload: unknown = await response.json().catch(() => null);
      const value = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
      const metaError = value?.error && typeof value.error === "object"
        ? (value.error as Record<string, unknown>)
        : null;
      const errorCode = typeof metaError?.code === "number" ? metaError.code : null;

      if (response.ok && String(value?.id ?? "") === appId) {
        result = "valid";
      } else if ((response.status === 400 || response.status === 401) && (errorCode === 190 || errorCode === 102)) {
        result = "mismatch";
      } else {
        result = "unavailable";
      }
    }
  } catch {
    result = "unavailable";
  }

  redirect(`/admin/integraciones/meta-inbox?app_check=${result}&app_id=${encodeURIComponent(appId)}`);
}
