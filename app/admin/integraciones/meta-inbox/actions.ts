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
  const metaAppId = String(formData.get("meta_app_id") ?? "").trim();
  const instagramAccessToken = String(formData.get("instagram_access_token") ?? "").trim();
  let instagramUserId = String(formData.get("instagram_user_id") ?? "").trim();
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
      redirect(
        "/admin/integraciones/meta-inbox?connection=error&code=page_credentials_pair_required",
      );
    }
    type PageTokenStatus =
      | "valid"
      | "invalid"
      | "wrong_page"
      | "wrong_app"
      | "wrong_type"
      | "unavailable"
      | "expired"
      | "malformed"
      | "permissions"
      | "paste_format"
      | "app_id_required"
      | "app_secret_required";
    let pageTokenStatus: PageTokenStatus = "unavailable";

    // Meta's Access Token Debugger is authoritative for PAGE tokens; a /me lookup
    // can be restricted even when pages_messaging is valid. Do not trust /{pageId}
    // alone: it can be publicly readable with an unrelated token.
    if (
      /^(?:Bearer\s+|access_token\s*=|https?:\/\/|["'])/i.test(pageAccessToken) ||
      /\s/.test(pageAccessToken) ||
      /["']$/.test(pageAccessToken)
    ) {
      pageTokenStatus = "paste_format";
    } else if (!/^[0-9]{5,32}$/.test(metaAppId)) {
      pageTokenStatus = "app_id_required";
    } else if (/^v[0-9]+\.[0-9]+$/.test(graphApiVersion)) {
      try {
        const service = createServiceClient();
        const { data: currentConnection, error: connectionError } = await service.rpc(
          "service_get_meta_inbox_webhook_config",
          { target_studio_id: studio.id },
        );
        const existing =
          currentConnection &&
          typeof currentConnection === "object" &&
          !Array.isArray(currentConnection)
            ? (currentConnection as Record<string, unknown>)
            : null;
        const savedSecret =
          typeof existing?.app_secret === "string" ? existing.app_secret.trim() : "";
        const secretForCheck = appSecret || savedSecret;

        if (connectionError || !secretForCheck) {
          pageTokenStatus = "app_secret_required";
        } else {
          // Meta's documented /debug_token endpoint uses input_token as a query
          // parameter. This request is server-to-Meta only over HTTPS; no token
          // or raw URL is logged or returned to the client.
          const url = new URL("https://graph.facebook.com/" + graphApiVersion + "/debug_token");
          url.searchParams.set("input_token", pageAccessToken);
          const response = await fetch(url, {
            method: "GET",
            headers: {
              authorization: "Bearer " + metaAppId + "|" + secretForCheck,
              accept: "application/json",
            },
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          });
          const raw: unknown = await response.json().catch(() => null);
          const payload =
            raw && typeof raw === "object" && !Array.isArray(raw)
              ? (raw as Record<string, unknown>)
              : null;
          const debugData =
            payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
              ? (payload.data as Record<string, unknown>)
              : null;

          if (response.ok && debugData) {
            const permissionList = Array.isArray(debugData.scopes) ? debugData.scopes : [];
            if (debugData.is_valid !== true) {
              pageTokenStatus = "invalid";
            } else if (String(debugData.app_id ?? "") !== metaAppId) {
              pageTokenStatus = "wrong_app";
            } else if (String(debugData.type ?? "").toUpperCase() !== "PAGE") {
              pageTokenStatus = "wrong_type";
            } else if (String(debugData.profile_id ?? "") !== pageId) {
              pageTokenStatus = "wrong_page";
            } else if (!permissionList.includes("pages_messaging")) {
              pageTokenStatus = "permissions";
            } else {
              pageTokenStatus = "valid";
            }
          } else {
            const err =
              payload?.error && typeof payload.error === "object" && !Array.isArray(payload.error)
                ? (payload.error as Record<string, unknown>)
                : null;
            const metaCode = typeof err?.code === "number" ? err.code : null;
            const subcode = typeof err?.error_subcode === "number" ? err.error_subcode : null;
            if (metaCode === 190) {
              pageTokenStatus = [458, 463, 467].includes(subcode ?? -1) ? "expired" : "invalid";
            } else if (metaCode === 10 || metaCode === 200) {
              pageTokenStatus = "permissions";
            } else {
              pageTokenStatus = "unavailable";
            }
          }
        }
      } catch {
        pageTokenStatus = "unavailable";
      }
    }
    if (pageTokenStatus !== "valid") {
      redirect(
        `/admin/integraciones/meta-inbox?connection=error&code=page_token_${pageTokenStatus}`,
      );
    }
  }

  // Instagram Login tokens identify the professional account. Resolve its ID on the
  // server instead of requiring the administrator to copy it from Meta.
  // Never log the token or include it in a query string or a redirect.
  if (instagramAccessToken) {
    if (instagramAccessToken.startsWith("Bearer ") || instagramAccessToken.startsWith("http") || instagramAccessToken.includes(" ") || instagramAccessToken.includes("\n")) {
      redirect("/admin/integraciones/meta-inbox?connection=error&code=instagram_token_format");
    }
    let resolvedId = "";
    let resolvedUsername = "";
    try {
      const response = await fetch(`https://graph.instagram.com/${graphApiVersion}/me?fields=id,user_id,username`, {
        headers: { authorization: `Bearer ${instagramAccessToken}`, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        redirect("/admin/integraciones/meta-inbox?connection=error&code=instagram_token_rejected");
      }
      const payload: unknown = await response.json();
      const profile = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown> : null;
      resolvedId = String(profile?.user_id ?? profile?.id ?? "").trim();
      resolvedUsername = String(profile?.username ?? "").trim().replace(/^@/, "").toLowerCase();
    } catch (error) {
      // Next.js redirect throws a special control-flow error: do not swallow it.
      if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
      redirect("/admin/integraciones/meta-inbox?connection=error&code=instagram_profile_unavailable");
    }
    if (!/^[0-9]{5,32}$/.test(resolvedId)) {
      redirect("/admin/integraciones/meta-inbox?connection=error&code=instagram_profile_invalid");
    }
    if (studio.id === "9fe23cfa-fb47-4670-afeb-ed4a56433772" && resolvedUsername !== "demeter_fitness_studio") {
      const safeUsername = /^[a-z0-9._]{1,30}$/.test(resolvedUsername) ? resolvedUsername : "unknown";
      redirect(`/admin/integraciones/meta-inbox?connection=error&code=instagram_wrong_account&instagram_username=${encodeURIComponent(safeUsername)}`);
    }
    if (instagramUserId && instagramUserId !== resolvedId) {
      redirect("/admin/integraciones/meta-inbox?connection=error&code=instagram_id_mismatch");
    }
    instagramUserId = resolvedId;
  } else if (instagramUserId) {
    redirect("/admin/integraciones/meta-inbox?connection=error&code=instagram_token_required");
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
  redirect(
    pageAccessToken
      ? "/admin/integraciones/meta-inbox?connection=page_token_valid"
      : "/admin/integraciones/meta-inbox?connection=saved",
  );
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
      `/admin/integraciones/meta-inbox?pilot=error&code=${encodeURIComponent(safeCode(error))}`,
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
    const connection =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    const secret = typeof connection?.app_secret === "string" ? connection.app_secret.trim() : "";
    const apiVersion =
      typeof connection?.graph_api_version === "string" ? connection.graph_api_version.trim() : "";

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
      const value =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      const metaError =
        value?.error && typeof value.error === "object"
          ? (value.error as Record<string, unknown>)
          : null;
      const errorCode = typeof metaError?.code === "number" ? metaError.code : null;

      if (response.ok && String(value?.id ?? "") === appId) {
        result = "valid";
      } else if (
        (response.status === 400 || response.status === 401) &&
        (errorCode === 190 || errorCode === 102)
      ) {
        result = "mismatch";
      } else {
        result = "unavailable";
      }
    }
  } catch {
    result = "unavailable";
  }

  redirect(
    `/admin/integraciones/meta-inbox?app_check=${result}&app_id=${encodeURIComponent(appId)}`,
  );
}

/**
 * Instagram Login subscription check / activation. Only the Demeter sandbox studio.
 * Tokens are read from the server-side vault and never returned to the browser.
 */
export async function manageInstagramWebhookSubscription(formData: FormData) {
  const operation = String(formData.get("operation") ?? "");
  if (operation !== "check" && operation !== "subscribe") {
    redirect("/admin/integraciones/meta-inbox?ig_subscription=invalid");
  }

  const { studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (studio.id !== "9fe23cfa-fb47-4670-afeb-ed4a56433772" || process.env.VERCEL_ENV !== "preview") {
    redirect("/admin/integraciones/meta-inbox?ig_subscription=restricted");
  }

  let outcome = "unavailable";
  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("service_get_meta_inbox_webhook_config", {
      target_studio_id: studio.id,
    });
    const config = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown> : null;
    const token = typeof config?.instagram_access_token === "string" ? config.instagram_access_token.trim() : "";
    const accountId = typeof config?.instagram_user_id === "string" ? config.instagram_user_id.trim() : "";
    const version = typeof config?.graph_api_version === "string" ? config.graph_api_version.trim() : "";
    if (error || !token || !/^\d+$/.test(accountId) || !/^v\d+\.\d+$/.test(version)) {
      outcome = "missing_credentials";
    } else {
      const url = `https://graph.instagram.com/${version}/${accountId}/subscribed_apps`;
      const response = await fetch(url, {
        method: operation === "subscribe" ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(operation === "subscribe" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(operation === "subscribe" ? { body: new URLSearchParams({ subscribed_fields: "messages" }) } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      const payload: unknown = await response.json().catch(() => null);
      const result = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown> : {};
      if (!response.ok) {
        outcome = response.status === 401 ? "token_rejected" : "meta_error";
      } else if (operation === "subscribe") {
        outcome = result.success === true ? "subscribed" : "unconfirmed";
      } else {
        const entries = Array.isArray(result.data) ? result.data : [];
        outcome = entries.some((entry) => {
          if (!entry || typeof entry !== "object") return false;
          const fields = (entry as Record<string, unknown>).subscribed_fields;
          return Array.isArray(fields) && fields.includes("messages");
        }) ? "active" : "not_active";
      }
    }
  } catch {
    outcome = "unavailable";
  }
  revalidatePath("/admin/integraciones/meta-inbox");
  redirect(`/admin/integraciones/meta-inbox?ig_subscription=${outcome}`);
}
