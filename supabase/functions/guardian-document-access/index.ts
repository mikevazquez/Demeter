import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: { token?: unknown; versionId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  const versionId = typeof payload.versionId === "string" ? payload.versionId.trim() : "";
  if (!token || !versionId) return json({ error: "invalid_request" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server_not_configured" }, 500);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("guardian_document_invitation", {
    p_token: token,
  });
  if (error || !data) return json({ error: "guardian_invitation_invalid" }, 403);

  const invite = data as {
    items?: Array<{ version_id?: string; file_path?: string | null; file_name?: string | null }>;
  };
  const item = (invite.items ?? []).find((candidate) => candidate.version_id === versionId);
  if (!item || !item.file_path) return json({ error: "document_not_available" }, 404);

  const { data: signed, error: signedError } = await admin.storage
    .from("studio-documents")
    .createSignedUrl(item.file_path, 60 * 20);

  if (signedError || !signed?.signedUrl) return json({ error: "document_access_failed" }, 500);

  return json({
    ok: true,
    signedUrl: signed.signedUrl,
    fileName: item.file_name ?? "document.pdf",
    expiresIn: 1200,
  });
});
