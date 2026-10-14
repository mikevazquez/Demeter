/** Server-only, bounded Auth fixture operation. Never an arbitrary admin API. */
export const B02_FIXTURE_EMAIL = "sf-gov-b02-diagnostic@auth.studioflow.invalid";
const CANDIDATE_ORIGIN = "https://sdmxtlgjkodidjtvikng.supabase.co";
const MAX_WINDOW_MS = 10 * 60 * 1000;

type Admin = {
  createUser(input: {
    email: string;
    password: string;
    email_confirm: true;
    app_metadata: Record<string, string | boolean>;
    user_metadata: { full_name: string };
  }): Promise<{
    data: { user: { id: string; email?: string } | null };
    error: unknown;
  }>;
};

export function candidateAuthBootstrap(input: {
  supabaseUrl: string;
  nonceSha256: string;
  issuedAtMs: number;
  expiresAtMs: number;
  sourceSha: string;
  admin: () => Admin;
  now?: () => number;
}) {
  return async (request: Request): Promise<Response> => {
    const respond = (error: string, status: number) =>
      Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
    if (request.method !== "POST") return respond("method_not_allowed", 405);
    let origin = "";
    try {
      const target = new URL(input.supabaseUrl);
      if (
        !target.username &&
        !target.password &&
        !target.search &&
        !target.hash &&
        target.pathname === "/"
      )
        origin = target.origin;
    } catch {}
    if (origin !== CANDIDATE_ORIGIN) return respond("candidate_target_required", 503);
    const now = (input.now ?? Date.now)();
    if (
      !Number.isFinite(input.issuedAtMs) ||
      !Number.isFinite(input.expiresAtMs) ||
      input.expiresAtMs <= input.issuedAtMs ||
      input.expiresAtMs - input.issuedAtMs > MAX_WINDOW_MS ||
      now < input.issuedAtMs ||
      now >= input.expiresAtMs ||
      !/^[a-f0-9]{40}$/.test(input.sourceSha) ||
      !/^[a-f0-9]{64}$/.test(input.nonceSha256)
    )
      return respond("bootstrap_disabled", 403);
    const nonce = request.headers.get("x-sf-gov-bootstrap-nonce") ?? "";
    if (!/^[a-f0-9]{64}$/.test(nonce)) return respond("bootstrap_unauthorized", 403);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
    const actual = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    // Fixed-length comparison; no request parameter can choose an account or role.
    let mismatch = 0;
    for (let i = 0; i < 64; i++) mismatch |= actual.charCodeAt(i) ^ input.nonceSha256.charCodeAt(i);
    if (mismatch) return respond("bootstrap_unauthorized", 403);
    if (Number(request.headers.get("content-length") ?? "0") > 4096)
      return respond("invalid_fixture_request", 400);
    const raw = await request.text();
    if (raw.length > 4096) return respond("invalid_fixture_request", 400);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return respond("invalid_fixture_request", 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("password" in body) ||
      typeof body.password !== "string" ||
      body.password.length < 32 ||
      body.password.length > 128
    )
      return respond("invalid_fixture_request", 400);
    if ((input.now ?? Date.now)() >= input.expiresAtMs) return respond("bootstrap_disabled", 403);
    try {
      const { data, error } = await input.admin().createUser({
        email: B02_FIXTURE_EMAIL,
        password: body.password,
        email_confirm: true,
        app_metadata: {
          synthetic: true,
          fixture: "SF-GOV-001-B02-DIAGNOSTIC",
          source_sha: input.sourceSha,
        },
        user_metadata: { full_name: "SF-GOV B02 synthetic diagnostic" },
      });
      if (error || !data.user || data.user.email !== B02_FIXTURE_EMAIL)
        return respond("fixture_creation_rejected", 409);
      return Response.json(
        { created: true, user_id: data.user.id, synthetic: true, no_email_requested: true },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    } catch {
      return respond("fixture_creation_rejected", 503);
    }
  };
}
