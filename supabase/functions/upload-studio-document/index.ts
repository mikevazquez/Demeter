import { withSupabase } from "npm:@supabase/server";

const BUCKET = "studio-documents";
const MAX_BYTES = 10 * 1024 * 1024;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function cleanFileName(name: string) {
  const normalized = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "document.pdf";
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const userClient = context.supabase;
    const adminClient = context.supabaseAdmin;
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "unauthenticated" }, 401);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "invalid_form" }, 400);
    }

    const studioId = String(form.get("studio_id") ?? "").trim();
    const documentId = String(form.get("document_id") ?? "").trim();
    const versionId = String(form.get("version_id") ?? "").trim();
    const fileValue = form.get("file");
    if (!studioId || !documentId || !versionId || !fileValue || typeof fileValue === "string") {
      return json({ error: "invalid_request" }, 400);
    }
    const file = fileValue as File;
    if (file.type !== "application/pdf") return json({ error: "pdf_required" }, 400);
    if (file.size <= 0 || file.size > MAX_BYTES) return json({ error: "file_size_invalid" }, 400);

    const { data: membership, error: membershipError } = await userClient
      .from("studio_memberships")
      .select("role,active")
      .eq("studio_id", studioId)
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (membershipError) return json({ error: "authorization_failed" }, 500);
    if (!membership) return json({ error: "forbidden" }, 403);

    const { data: capability, error: capabilityError } = await userClient
      .from("role_capabilities")
      .select("capability_key")
      .eq("role", membership.role)
      .eq("capability_key", "documents.manage")
      .maybeSingle();
    if (capabilityError) return json({ error: "authorization_failed" }, 500);
    if (!capability) return json({ error: "forbidden" }, 403);

    const { data: version, error: versionError } = await adminClient
      .from("document_versions")
      .select("id,document_id,studio_id,status")
      .eq("id", versionId)
      .eq("document_id", documentId)
      .eq("studio_id", studioId)
      .maybeSingle();
    if (versionError) return json({ error: "version_lookup_failed" }, 500);
    if (!version) return json({ error: "document_version_not_found" }, 404);
    if (version.status !== "draft") return json({ error: "document_version_not_draft" }, 409);

    const { data: bucket } = await adminClient.storage.getBucket(BUCKET);
    if (!bucket) {
      const { error: bucketError } = await adminClient.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: ["application/pdf"],
      });
      if (bucketError && !bucketError.message.toLowerCase().includes("already")) {
        return json({ error: "bucket_create_failed" }, 500);
      }
    }

    const fileName = cleanFileName(
      file.name.toLowerCase().endsWith(".pdf") ? file.name : file.name + ".pdf",
    );
    const objectName =
      studioId + "/" + documentId + "/" + versionId + "/" + crypto.randomUUID() + "-" + fileName;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { data: upload, error: uploadError } = await adminClient.storage
      .from(BUCKET)
      .upload(objectName, bytes, { contentType: "application/pdf", upsert: false });
    if (uploadError || !upload?.path) return json({ error: "upload_failed" }, 500);

    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return json({
      ok: true,
      bucket: BUCKET,
      path: upload.path,
      fileName,
      mimeType: "application/pdf",
      size: file.size,
      sha256: hash,
    });
  }),
};

export default handler;
