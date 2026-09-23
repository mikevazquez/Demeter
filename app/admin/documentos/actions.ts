"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

type UploadResult = {
  ok?: boolean;
  path?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  error?: string;
};

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function documentRoute(documentId: string, suffix = "") {
  return `/admin/documentos/${documentId}${suffix}`;
}

export async function createDocumentAction(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);
  const name = text(formData, "name");
  const documentType = text(formData, "document_type") || "other";
  const description = text(formData, "description") || null;

  const { data, error } = await supabase.rpc("admin_create_document_draft", {
    p_studio_id: studio.id,
    p_name: name,
    p_document_type: documentType,
    p_description: description,
  });

  const result = data as { document_id?: string } | null;
  if (error || !result?.document_id) redirect("/admin/documentos/nuevo?error=create");

  revalidatePath("/admin/documentos");
  redirect(documentRoute(result.document_id, "/editar"));
}

export async function saveDocumentDraftAction(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);
  const documentId = text(formData, "document_id");
  const versionId = text(formData, "version_id");
  if (!documentId || !versionId) redirect("/admin/documentos?error=invalid");

  const { data: existing } = await supabase
    .from("document_versions")
    .select("file_path,file_name,mime_type,file_size_bytes,content_sha256,status")
    .eq("id", versionId)
    .eq("document_id", documentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!existing || existing.status !== "draft") {
    redirect(documentRoute(documentId, "?error=version_not_draft"));
  }

  let filePath = existing.file_path as string | null;
  let fileName = existing.file_name as string | null;
  let mimeType = existing.mime_type as string | null;
  let fileSize = existing.file_size_bytes as number | null;
  let sha256 = existing.content_sha256 as string | null;

  const fileValue = formData.get("file");
  if (fileValue instanceof File && fileValue.size > 0) {
    const uploadBody = new FormData();
    uploadBody.set("studio_id", studio.id);
    uploadBody.set("document_id", documentId);
    uploadBody.set("version_id", versionId);
    uploadBody.set("file", fileValue);

    const { data: uploadData, error: uploadError } = await supabase.functions.invoke(
      "upload-studio-document",
      { body: uploadBody },
    );
    const upload = uploadData as UploadResult | null;
    if (uploadError || !upload?.ok || !upload.path) {
      redirect(documentRoute(documentId, "/editar?error=upload"));
    }
    filePath = upload.path;
    fileName = upload.fileName ?? fileValue.name;
    mimeType = upload.mimeType ?? "application/pdf";
    fileSize = upload.size ?? fileValue.size;
    sha256 = upload.sha256 ?? null;
  }

  const audience = text(formData, "audience_scope") || "all";
  const targetType =
    audience === "activity" ? "activity" : audience === "event" ? "event" : audience === "student" ? "student" : null;
  const targets = targetType
    ? formData
        .getAll("target_id")
        .map(String)
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => ({ type: targetType, id }))
    : [];

  const effectiveValue = text(formData, "effective_at");
  const effectiveAt = effectiveValue ? new Date(effectiveValue).toISOString() : new Date().toISOString();

  const { error } = await supabase.rpc("admin_update_document_draft", {
    p_version_id: versionId,
    p_name: text(formData, "name"),
    p_document_type: text(formData, "document_type") || "other",
    p_description: text(formData, "description") || null,
    p_response_mode: text(formData, "response_mode") || "accept_required",
    p_acceptance_party: text(formData, "acceptance_party") || "student",
    p_audience_scope: audience,
    p_enforcement_scope: text(formData, "enforcement_scope") || "global_booking",
    p_requires_reacceptance: formData.get("requires_reacceptance") !== "false",
    p_effective_at: effectiveAt,
    p_affirmation_text:
      text(formData, "affirmation_text") || "He leído y acepto el contenido de este documento.",
    p_change_summary: text(formData, "change_summary") || null,
    p_file_path: filePath,
    p_file_name: fileName,
    p_mime_type: mimeType,
    p_file_size_bytes: fileSize,
    p_content_sha256: sha256,
    p_targets: targets,
  });

  if (error) {
    const code = error.message.includes("document_target_required")
      ? "target_required"
      : error.message.includes("informational_document_cannot_block")
        ? "informational_block"
        : "save";
    redirect(documentRoute(documentId, `/editar?error=${code}`));
  }

  revalidatePath("/admin/documentos");
  revalidatePath(documentRoute(documentId));
  const intent = text(formData, "intent");
  redirect(intent === "review" ? documentRoute(documentId, "/revisar") : documentRoute(documentId, "/editar?saved=1"));
}

export async function publishDocumentAction(formData: FormData) {
  const { supabase } = await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);
  const documentId = text(formData, "document_id");
  const versionId = text(formData, "version_id");
  if (!documentId || !versionId) redirect("/admin/documentos?error=invalid");

  const { error } = await supabase.rpc("admin_publish_document_version", {
    p_version_id: versionId,
  });

  if (error) {
    const code = error.message.includes("document_file_required") ? "file_required" : "publish";
    redirect(documentRoute(documentId, `/revisar?error=${code}`));
  }

  revalidatePath("/admin/documentos");
  revalidatePath(documentRoute(documentId));
  revalidatePath("/student/documentos");
  revalidatePath("/student/reservar");
  redirect(documentRoute(documentId, "?published=1"));
}

export async function createDocumentVersionAction(formData: FormData) {
  const { supabase } = await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);
  const documentId = text(formData, "document_id");
  if (!documentId) redirect("/admin/documentos?error=invalid");

  const { error } = await supabase.rpc("admin_create_document_version", {
    p_document_id: documentId,
  });
  if (error) redirect(documentRoute(documentId, "?error=new_version"));

  revalidatePath(documentRoute(documentId));
  redirect(documentRoute(documentId, "/editar"));
}

export async function retireDocumentVersionAction(formData: FormData) {
  const { supabase } = await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);
  const documentId = text(formData, "document_id");
  const versionId = text(formData, "version_id");
  if (!documentId || !versionId) redirect("/admin/documentos?error=invalid");

  const { error } = await supabase.rpc("admin_retire_document_version", {
    p_version_id: versionId,
    p_reason: text(formData, "reason") || "Retirado por Administración",
  });
  if (error) redirect(documentRoute(documentId, "?error=retire"));

  revalidatePath("/admin/documentos");
  revalidatePath(documentRoute(documentId));
  revalidatePath("/student/documentos");
  redirect(documentRoute(documentId, "?retired=1"));
}

export async function invalidateAcceptanceAction(formData: FormData) {
  const { supabase } = await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);
  const acceptanceId = text(formData, "acceptance_id");
  const documentId = text(formData, "document_id");
  if (!acceptanceId || !documentId) redirect("/admin/documentos?error=invalid");

  const { error } = await supabase.rpc("admin_invalidate_document_acceptance", {
    p_acceptance_id: acceptanceId,
    p_reason: text(formData, "reason"),
  });
  if (error) redirect(`/admin/documentos/aceptaciones/${acceptanceId}?error=invalidate`);

  revalidatePath(documentRoute(documentId, "/aceptaciones"));
  revalidatePath(`/admin/documentos/aceptaciones/${acceptanceId}`);
  revalidatePath("/student/documentos");
  redirect(`/admin/documentos/aceptaciones/${acceptanceId}?invalidated=1`);
}
