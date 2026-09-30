import { withSupabase } from "npm:@supabase/server";

type ProvisionRequest = {
  instructorId?: unknown;
  mode?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function generateTemporaryPassword() {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  const suffix = Array.from(values, (value) => String(value % 10)).join("");
  return `Sf!${suffix}A9`;
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    const userClient = context.supabase;
    const adminClient = context.supabaseAdmin;
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return jsonResponse({ error: "unauthenticated" }, 401);

    let payload: ProvisionRequest;
    try {
      payload = (await request.json()) as ProvisionRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const instructorId =
      typeof payload.instructorId === "string" ? payload.instructorId.trim() : "";
    const mode = payload.mode === "reset" ? "reset" : payload.mode === undefined ? "provision" : "";
    if (!instructorId || !mode) return jsonResponse({ error: "invalid_request" }, 400);

    const { data: instructor } = await userClient
      .from("instructors")
      .select("id, studio_id, person_id, status")
      .eq("id", instructorId)
      .maybeSingle();
    if (!instructor) return jsonResponse({ error: "instructor_not_found" }, 404);
    if (instructor.status !== "active") {
      return jsonResponse({ error: "instructor_not_active" }, 409);
    }

    const { data: caller } = await userClient
      .from("studio_memberships")
      .select("role")
      .eq("studio_id", instructor.studio_id)
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (!caller) return jsonResponse({ error: "forbidden" }, 403);

    const { data: permission } = await userClient
      .from("role_capabilities")
      .select("capability_key")
      .eq("role", caller.role)
      .eq("capability_key", "settings.write")
      .maybeSingle();
    if (!permission) return jsonResponse({ error: "forbidden" }, 403);

    const [{ data: person }, { data: contacts }] = await Promise.all([
      userClient
        .from("persons")
        .select("first_name, last_name")
        .eq("id", instructor.person_id)
        .eq("studio_id", instructor.studio_id)
        .maybeSingle(),
      userClient
        .from("person_contacts")
        .select("kind, value, is_primary")
        .eq("person_id", instructor.person_id)
        .eq("studio_id", instructor.studio_id),
    ]);
    if (!person) return jsonResponse({ error: "instructor_identity_lookup_failed" }, 500);

    const primaryEmail = contacts?.find(
      (contact) => contact.kind === "email" && contact.is_primary === true,
    );
    const fallbackEmail = contacts?.find((contact) => contact.kind === "email");
    const email = String(primaryEmail?.value ?? fallbackEmail?.value ?? "")
      .trim()
      .toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "instructor_email_required" }, 409);
    }

    const { data: existing } = await adminClient
      .from("studio_memberships")
      .select("user_id, active")
      .eq("studio_id", instructor.studio_id)
      .eq("person_id", instructor.person_id)
      .eq("role", "instructor")
      .maybeSingle();

    const temporaryPassword = generateTemporaryPassword();

    if (mode === "reset") {
      if (!existing?.user_id) {
        return jsonResponse({ error: "instructor_access_missing" }, 409);
      }

      const { data: account } = await adminClient
        .from("user_accounts")
        .select("status, must_change_password")
        .eq("id", existing.user_id)
        .maybeSingle();
      if (!account || account.status !== "active" || !existing.active) {
        return jsonResponse({ error: "instructor_access_inconsistent" }, 409);
      }
      if (!account.must_change_password) {
        return jsonResponse({ error: "temporary_password_reset_closed" }, 409);
      }

      const { error } = await adminClient.auth.admin.updateUserById(existing.user_id, {
        email,
        email_confirm: true,
        password: temporaryPassword,
      });
      if (error) return jsonResponse({ error: "auth_password_reset_failed" }, 500);

      return jsonResponse({
        ok: true,
        email,
        temporaryPassword,
        mustChangePassword: true,
      });
    }

    if (existing?.user_id) {
      return jsonResponse({ error: "instructor_already_linked" }, 409);
    }

    const fullName = [person.first_name, person.last_name].filter(Boolean).join(" ");
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) {
      return jsonResponse({ error: "auth_create_failed" }, 409);
    }

    const { error: linkError } = await adminClient.rpc("service_link_instructor_access", {
      target_instructor_id: instructor.id,
      target_user_id: created.user.id,
    });
    if (linkError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return jsonResponse({ error: "link_failed" }, 500);
    }

    return jsonResponse({
      ok: true,
      email,
      temporaryPassword,
      mustChangePassword: true,
    });
  }),
};

export default handler;
