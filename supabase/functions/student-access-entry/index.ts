import { createClient } from "npm:@supabase/supabase-js@2.116.0";

type EntryStatus = "login" | "pending" | "not_found";

function normalizeMexicanPhone(value: unknown) {
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  let normalized: string;

  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    normalized = `+52${digits}`;
  } else if (digits.length === 12 && digits.startsWith("52")) {
    normalized = `+${digits}`;
  } else {
    return null;
  }

  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : null;
}

function normalizedStudioSlug(value: unknown) {
  if (typeof value !== "string") return "";
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

function response(status: EntryStatus, httpStatus = 200) {
  return new Response(JSON.stringify({ status }), {
    status: httpStatus,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return response("not_found");
  }

  const phone = normalizeMexicanPhone(payload.phone);
  const studioSlug = normalizedStudioSlug(payload.studioSlug);

  if (!phone || !studioSlug) return response("not_found");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "service_unavailable" }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: studio, error: studioError } = await admin
    .from("studios")
    .select("id")
    .eq("slug", studioSlug)
    .eq("status", "active")
    .maybeSingle();

  if (studioError) {
    console.error("[student-access-entry] studio lookup failed", {
      code: studioError.code,
    });
    return new Response(JSON.stringify({ error: "lookup_failed" }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  if (!studio) return response("not_found");

  const { data: students, error: studentError } = await admin
    .from("students")
    .select("id, user_id")
    .eq("studio_id", studio.id)
    .eq("phone", phone)
    .eq("active", true)
    .neq("lifecycle_status", "archived")
    .limit(1);

  if (studentError) {
    console.error("[student-access-entry] student lookup failed", {
      code: studentError.code,
    });
    return new Response(JSON.stringify({ error: "lookup_failed" }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const student = students?.[0] ?? null;
  if (!student) return response("not_found");
  if (!student.user_id) return response("pending");

  const [{ data: account, error: accountError }, { data: membership, error: membershipError }] =
    await Promise.all([
      admin
        .from("user_accounts")
        .select("status, must_change_password")
        .eq("id", student.user_id)
        .maybeSingle(),
      admin
        .from("studio_memberships")
        .select("role, active")
        .eq("studio_id", studio.id)
        .eq("user_id", student.user_id)
        .eq("role", "student")
        .eq("active", true)
        .maybeSingle(),
    ]);

  if (accountError || membershipError) {
    console.error("[student-access-entry] access lookup failed", {
      accountCode: accountError?.code,
      membershipCode: membershipError?.code,
    });
    return new Response(JSON.stringify({ error: "lookup_failed" }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  if (!account || account.status !== "active" || !membership) return response("pending");
  if (account.must_change_password === true) return response("pending");

  return response("login");
});
