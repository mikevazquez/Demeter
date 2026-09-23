"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStudentPortalContext } from "@/lib/student/portal";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function revalidateDocumentSurfaces() {
  revalidatePath("/student");
  revalidatePath("/student/documentos");
  revalidatePath("/student/reservar");
  revalidatePath("/student/recompensas");
}

export async function acceptStudentDocumentAction(formData: FormData) {
  const versionId = value(formData, "version_id");
  const decision = value(formData, "decision") || "accepted";
  if (!versionId) redirect("/student/documentos?error=invalid");

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_accept_document", {
    p_version_id: versionId,
    p_decision: decision,
    p_evidence: {
      confirmation_checked: formData.get("confirmation") === "true",
      source: "student_documents",
    },
  });

  const result = data as {
    ok?: boolean;
    acceptance_id?: string;
    satisfied?: boolean;
    remaining_blockers?: unknown[];
  } | null;

  if (error || !result?.ok || !result.acceptance_id) {
    const code = error?.message.includes("guardian_acceptance_required")
      ? "guardian_required"
      : error?.message.includes("document_acceptance_required")
        ? "acceptance_required"
        : "accept";
    redirect(`/student/documentos/${versionId}/confirmar?error=${code}`);
  }

  revalidateDocumentSurfaces();
  redirect(
    `/student/documentos/confirmacion?version=${encodeURIComponent(versionId)}&acceptance=${encodeURIComponent(result.acceptance_id)}`,
  );
}

export async function registerGuardianAction(formData: FormData) {
  const fullName = value(formData, "full_name");
  const email = value(formData, "email") || null;
  const phone = value(formData, "phone") || null;
  const relationship = value(formData, "relationship") || "legal_guardian";
  const relationshipDetail = value(formData, "relationship_detail") || null;

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_register_guardian", {
    p_full_name: fullName,
    p_email: email,
    p_phone: phone,
    p_relationship: relationship,
    p_relationship_detail: relationshipDetail,
  });

  const result = data as { ok?: boolean; token?: string; invitation_id?: string } | null;
  if (error || !result?.ok || !result.token) {
    const code = error?.message.includes("guardian_not_required")
      ? "not_required"
      : error?.message.includes("guardian_contact_required")
        ? "contact_required"
        : "save";
    redirect(`/student/documentos/responsable?error=${code}`);
  }

  revalidateDocumentSurfaces();
  redirect(`/student/documentos/responsable?created=1&token=${encodeURIComponent(result.token)}`);
}
