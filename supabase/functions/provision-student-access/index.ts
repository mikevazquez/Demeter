import { withSupabase } from "npm:@supabase/server";

type ProvisionRequest = {
  studentId?: unknown;
  mode?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function randomCharacter(characters: string) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return characters[bytes[0] % characters.length];
}

function generateTemporaryPassword() {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%*-_";
  const all = uppercase + lowercase + digits + symbols;

  const characters = [
    randomCharacter(uppercase),
    randomCharacter(lowercase),
    randomCharacter(digits),
    randomCharacter(symbols),
  ];

  while (characters.length < 20) characters.push(randomCharacter(all));

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const swapIndex = bytes[0] % (index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }

  return characters.join("");
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    const userClient = context.supabase;
    const adminClient = context.supabaseAdmin;

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return jsonResponse({ error: "unauthenticated" }, 401);

    let payload: ProvisionRequest;
    try {
      payload = (await request.json()) as ProvisionRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const studentId = typeof payload.studentId === "string" ? payload.studentId.trim() : "";
    const mode = payload.mode === "reset" ? "reset" : payload.mode === undefined ? "provision" : "";
    if (!studentId || !mode) return jsonResponse({ error: "invalid_request" }, 400);

    const { data: student, error: studentError } = await userClient
      .from("students")
      .select("id, studio_id, person_id, user_id, full_name, phone, active, lifecycle_status")
      .eq("id", studentId)
      .maybeSingle();

    if (studentError) return jsonResponse({ error: "student_lookup_failed" }, 500);
    if (!student) return jsonResponse({ error: "student_not_found" }, 404);
    if (!student.person_id) return jsonResponse({ error: "student_person_missing" }, 409);
    if (!student.active || student.lifecycle_status !== "active") {
      return jsonResponse({ error: "student_not_active" }, 409);
    }

    const { data: callerMembership, error: membershipError } = await userClient
      .from("studio_memberships")
      .select("role, active")
      .eq("studio_id", student.studio_id)
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (membershipError) return jsonResponse({ error: "authorization_failed" }, 500);
    if (!callerMembership) return jsonResponse({ error: "forbidden" }, 403);

    const { data: permission, error: permissionError } = await userClient
      .from("role_capabilities")
      .select("capability_key")
      .eq("role", callerMembership.role)
      .eq("capability_key", "settings.write")
      .maybeSingle();

    if (permissionError) return jsonResponse({ error: "authorization_failed" }, 500);
    if (!permission) return jsonResponse({ error: "forbidden" }, 403);

    const temporaryPassword = generateTemporaryPassword();

    if (mode === "reset") {
      if (!student.user_id) return jsonResponse({ error: "student_access_missing" }, 409);

      const [{ data: account, error: accountError }, { data: targetMembership, error: targetError }] =
        await Promise.all([
          userClient
            .from("user_accounts")
            .select("status, must_change_password")
            .eq("id", student.user_id)
            .maybeSingle(),
          userClient
            .from("studio_memberships")
            .select("role, active")
            .eq("studio_id", student.studio_id)
            .eq("user_id", student.user_id)
            .maybeSingle(),
        ]);

      if (accountError || targetError) return jsonResponse({ error: "access_lookup_failed" }, 500);
      if (
        !account ||
        account.status !== "active" ||
        !targetMembership ||
        targetMembership.role !== "student" ||
        targetMembership.active !== true
      ) {
        return jsonResponse({ error: "student_access_inconsistent" }, 409);
      }
      if (account.must_change_password !== true) {
        return jsonResponse({ error: "temporary_password_reset_closed" }, 409);
      }

      const { error: resetError } = await adminClient.auth.admin.updateUserById(student.user_id, {
        password: temporaryPassword,
      });

      if (resetError) return jsonResponse({ error: "auth_password_reset_failed" }, 500);

      return jsonResponse({
        ok: true,
        temporaryPassword,
        phone: student.phone,
        mustChangePassword: true,
      });
    }

    if (student.user_id) return jsonResponse({ error: "student_already_linked" }, 409);

    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      phone: student.phone,
      password: temporaryPassword,
      phone_confirm: true,
      user_metadata: { full_name: student.full_name },
    });

    if (createError || !createdUser.user) {
      const message = createError?.message.toLowerCase() ?? "";
      const duplicate =
        message.includes("already") || message.includes("registered") || message.includes("exists");
      return jsonResponse(
        { error: duplicate ? "auth_phone_exists" : "auth_create_failed" },
        duplicate ? 409 : 500,
      );
    }

    const { error: linkError } = await adminClient.rpc("service_link_student_access", {
      target_student_id: student.id,
      target_user_id: createdUser.user.id,
    });

    if (linkError) {
      await adminClient.auth.admin.deleteUser(createdUser.user.id);
      return jsonResponse({ error: "link_failed" }, 500);
    }

    return jsonResponse({
      ok: true,
      temporaryPassword,
      phone: student.phone,
      mustChangePassword: true,
    });
  }),
};

export default handler;
