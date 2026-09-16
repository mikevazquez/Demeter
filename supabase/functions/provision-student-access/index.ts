import { createClient } from "npm:@supabase/supabase-js@2.116.0";

type ProvisionRequest = {
  studentId?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function namedKey(environmentName: string, legacyName: string) {
  const rawNamedKeys = Deno.env.get(environmentName);
  if (rawNamedKeys) {
    try {
      const keys = JSON.parse(rawNamedKeys) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall back to the legacy hosted variable below.
    }
  }

  return Deno.env.get(legacyName) ?? "";
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

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse({ error: "unauthenticated" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !publishableKey || !secretKey) {
    return jsonResponse({ error: "server_configuration" }, 500);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const accessToken = authorization.slice("Bearer ".length);
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(accessToken);

  if (userError || !user) return jsonResponse({ error: "unauthenticated" }, 401);

  let payload: ProvisionRequest;
  try {
    payload = (await request.json()) as ProvisionRequest;
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const studentId = typeof payload.studentId === "string" ? payload.studentId.trim() : "";
  if (!studentId) return jsonResponse({ error: "invalid_request" }, 400);

  const { data: student, error: studentError } = await adminClient
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
  if (student.user_id) return jsonResponse({ error: "student_already_linked" }, 409);

  const { data: callerMembership, error: membershipError } = await adminClient
    .from("studio_memberships")
    .select("role, active")
    .eq("studio_id", student.studio_id)
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (membershipError) return jsonResponse({ error: "authorization_failed" }, 500);
  if (!callerMembership) return jsonResponse({ error: "forbidden" }, 403);

  const { data: permission, error: permissionError } = await adminClient
    .from("role_capabilities")
    .select("capability_key")
    .eq("role", callerMembership.role)
    .eq("capability_key", "settings.write")
    .maybeSingle();

  if (permissionError) return jsonResponse({ error: "authorization_failed" }, 500);
  if (!permission) return jsonResponse({ error: "forbidden" }, 403);

  const temporaryPassword = generateTemporaryPassword();
  const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
    phone: student.phone,
    password: temporaryPassword,
    phone_confirm: true,
    user_metadata: { full_name: student.full_name },
  });

  if (createError || !createdUser.user) {
    const message = createError?.message.toLowerCase() ?? "";
    const duplicate = message.includes("already") || message.includes("registered") || message.includes("exists");
    return jsonResponse({ error: duplicate ? "auth_phone_exists" : "auth_create_failed" }, duplicate ? 409 : 500);
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
});
