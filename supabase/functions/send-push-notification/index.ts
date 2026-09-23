import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import {
  sendPushNotification,
  WebPushError,
} from "npm:@mmmike/web-push@1.3.0/send";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function safeUuid(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : null;
}

type PushRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  expiration_time: number | null;
};

type VapidConfig = {
  public_key?: unknown;
  private_key?: unknown;
  subject?: unknown;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "push_sender_not_configured" }, 503);
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) {
    return jsonResponse({ error: "unauthenticated" }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await adminClient.auth.getUser(token);

  if (userError || !user) {
    return jsonResponse({ error: "unauthenticated" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  if (body.mode !== "self_test") {
    return jsonResponse({ error: "unsupported_mode" }, 400);
  }

  const studioId = safeUuid(body.studio_id);
  if (!studioId) {
    return jsonResponse({ error: "studio_invalid" }, 400);
  }

  const { data: membership, error: membershipError } = await adminClient
    .from("studio_memberships")
    .select("studio_id,user_id,active")
    .eq("studio_id", studioId)
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (membershipError) {
    return jsonResponse({ error: "membership_lookup_failed" }, 500);
  }
  if (!membership) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const [{ data: subscriptions, error: subscriptionError }, { data: rawVapid, error: vapidError }] =
    await Promise.all([
      adminClient
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth_secret,expiration_time")
        .eq("studio_id", studioId)
        .eq("user_id", user.id)
        .is("revoked_at", null),
      adminClient.rpc("service_get_push_vapid_config"),
    ]);

  if (subscriptionError) {
    return jsonResponse({ error: "push_subscription_lookup_failed" }, 500);
  }
  if (vapidError) {
    return jsonResponse({ error: "push_vapid_lookup_failed" }, 503);
  }

  const rows = (subscriptions ?? []) as PushRow[];
  if (rows.length === 0) {
    return jsonResponse({ error: "push_subscription_missing" }, 409);
  }

  const vapid = (rawVapid ?? {}) as VapidConfig;
  const publicKey =
    typeof vapid.public_key === "string" ? vapid.public_key.trim() : "";
  const privateKey =
    typeof vapid.private_key === "string" ? vapid.private_key.trim() : "";
  const subject = typeof vapid.subject === "string" ? vapid.subject.trim() : "";

  if (!publicKey || !privateKey || !subject) {
    return jsonResponse({ error: "push_vapid_not_configured" }, 503);
  }

  let delivered = 0;
  let gone = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        const ok = await sendPushNotification(
          {
            endpoint: row.endpoint,
            expirationTime: row.expiration_time,
            keys: {
              p256dh: row.p256dh,
              auth: row.auth_secret,
            },
          },
          {
            title: "Studio Flow",
            body: "Las notificaciones Push están funcionando correctamente.",
            url: "/student",
            tag: "push-foundation-test",
          },
          {
            publicKey,
            privateKey,
            subject,
          },
          {
            ttl: 300,
            urgency: "normal",
          },
        );

        if (ok) {
          delivered += 1;
          return;
        }

        gone += 1;
        await adminClient.rpc("service_revoke_push_subscription", {
          p_subscription_id: row.id,
          p_reason: "push_endpoint_gone",
        });
      } catch (error) {
        failed += 1;

        if (
          error instanceof WebPushError &&
          (error.statusCode === 404 || error.statusCode === 410)
        ) {
          gone += 1;
          failed -= 1;
          await adminClient.rpc("service_revoke_push_subscription", {
            p_subscription_id: row.id,
            p_reason: "push_endpoint_gone",
          });
        }
      }
    }),
  );

  if (delivered === 0 && failed > 0) {
    return jsonResponse(
      {
        ok: false,
        delivered,
        gone,
        failed,
        error: "push_delivery_failed",
      },
      502,
    );
  }

  return jsonResponse({
    ok: true,
    delivered,
    gone,
    failed,
  });
});
