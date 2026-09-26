import { withSupabase } from "npm:@supabase/server";
import type { SupabaseClient } from "npm:@supabase/supabase-js";

type ProvisionStudioRequest = {
  studioName?: unknown;
  studioSlug?: unknown;
  timezone?: unknown;
  currency?: unknown;
  locale?: unknown;
  phoneCountryCallingCode?: unknown;
  primaryColor?: unknown;
  ownerName?: unknown;
  ownerEmail?: unknown;
  siteName?: unknown;
  address?: unknown;
  spaceName?: unknown;
  activationUrl?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function generateInternalPassword() {
  return `Sf!${crypto.randomUUID()}A9`;
}

function validateActivationUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.pathname === "/login/studio/activar";
  } catch {
    return false;
  }
}

async function findUserByEmail(adminClient: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) throw new Error("owner_lookup_failed");

    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) break;
  }

  return null;
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const userClient = context.supabase;
    const adminClient = context.supabaseAdmin;

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "unauthenticated" }, 401);
    }

    const { data: platformAdmin, error: platformAdminError } = await adminClient
      .from("platform_admins")
      .select("user_id,active")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (platformAdminError) {
      return jsonResponse({ error: "authorization_failed" }, 500);
    }
    if (!platformAdmin) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    let payload: ProvisionStudioRequest;
    try {
      payload = (await request.json()) as ProvisionStudioRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const studioName = stringValue(payload.studioName);
    const studioSlug = stringValue(payload.studioSlug).toLowerCase();
    const timezone = stringValue(payload.timezone) || "America/Mexico_City";
    const currency = (stringValue(payload.currency) || "MXN").toUpperCase();
    const locale = stringValue(payload.locale) || "es-MX";
    const phoneCountryCallingCode =
      stringValue(payload.phoneCountryCallingCode) || "+52";
    const primaryColor = (stringValue(payload.primaryColor) || "#FF0A8A").toUpperCase();
    const ownerName = stringValue(payload.ownerName);
    const ownerEmail = stringValue(payload.ownerEmail).toLowerCase();
    const siteName = stringValue(payload.siteName) || "Principal";
    const address = stringValue(payload.address);
    const spaceName = stringValue(payload.spaceName) || "Sala principal";
    const activationUrl = stringValue(payload.activationUrl);

    if (
      !studioName ||
      !ownerName ||
      !ownerEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(studioSlug) ||
      !/^#[0-9A-F]{6}$/.test(primaryColor) ||
      !/^[A-Z]{3}$/.test(currency) ||
      !/^\+[1-9][0-9]{0,3}$/.test(phoneCountryCallingCode) ||
      !validateActivationUrl(activationUrl)
    ) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const { data: existingStudio, error: studioLookupError } = await adminClient
      .from("studios")
      .select("id")
      .eq("slug", studioSlug)
      .maybeSingle();

    if (studioLookupError) {
      return jsonResponse({ error: "studio_lookup_failed" }, 500);
    }
    if (existingStudio) {
      return jsonResponse({ error: "studio_slug_exists" }, 409);
    }

    let ownerUser;
    let createdOwnerUser = false;
    let ownerRequiresActivation = false;

    try {
      const existingUser = await findUserByEmail(adminClient, ownerEmail);

      if (existingUser) {
        const { data: account, error: accountError } = await adminClient
          .from("user_accounts")
          .select("status,must_change_password")
          .eq("id", existingUser.id)
          .maybeSingle();

        if (accountError) {
          return jsonResponse({ error: "owner_account_lookup_failed" }, 500);
        }

        if (!account || account.status !== "active") {
          return jsonResponse({ error: "owner_account_unavailable" }, 409);
        }

        ownerUser = existingUser;
        ownerRequiresActivation = account.must_change_password === true;
      } else {
        const { data: created, error: createError } = await adminClient.auth.admin.createUser({
          email: ownerEmail,
          password: generateInternalPassword(),
          email_confirm: true,
          user_metadata: { full_name: ownerName },
        });

        if (createError || !created.user) {
          return jsonResponse({ error: "owner_create_failed" }, 500);
        }

        ownerUser = created.user;
        createdOwnerUser = true;
        ownerRequiresActivation = true;
      }

      const { data: provisioned, error: provisionError } = await adminClient.rpc(
        "service_provision_studio_v2",
        {
          p_name: studioName,
          p_slug: studioSlug,
          p_timezone: timezone,
          p_currency: currency,
          p_locale: locale,
          p_phone_country_calling_code: phoneCountryCallingCode,
          p_primary_color: primaryColor,
          p_owner_user_id: ownerUser.id,
          p_owner_full_name: ownerName,
          p_owner_requires_activation: ownerRequiresActivation,
          p_site_name: siteName,
          p_address: address || null,
          p_space_name: spaceName,
        },
      );

      if (provisionError) {
        if (createdOwnerUser) {
          await adminClient.auth.admin.deleteUser(ownerUser.id);
        }

        if (provisionError.message.includes("studio_slug_exists")) {
          return jsonResponse({ error: "studio_slug_exists" }, 409);
        }

        return jsonResponse({ error: "studio_provision_failed" }, 500);
      }

      let activationLink: string | null = null;

      if (ownerRequiresActivation) {
        const { data: activationData, error: activationError } =
          await adminClient.auth.admin.generateLink({
            type: "recovery",
            email: ownerEmail,
            options: { redirectTo: activationUrl },
          });

        if (!activationError && activationData.properties?.action_link) {
          activationLink = activationData.properties.action_link;
        }
      }

      return jsonResponse({
        ok: true,
        studio: provisioned,
        ownerEmail,
        reusedExistingAccount: !createdOwnerUser,
        activationRequired: ownerRequiresActivation,
        activationLink,
      });
    } catch (error) {
      if (createdOwnerUser && ownerUser?.id) {
        await adminClient.auth.admin.deleteUser(ownerUser.id);
      }

      return jsonResponse({
        error: error instanceof Error ? error.message : "studio_provision_failed",
      }, 500);
    }
  }),
};

export default handler;

Deno.serve(handler.fetch);
