"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function readValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function verifyGuardianIdentityAction(formData: FormData) {
  const token = readValue(formData, "token");
  const confirmed = formData.get("confirmed") === "true";
  if (!token || !confirmed) {
    redirect("/responsable/documentos/" + encodeURIComponent(token) + "?error=confirm");
  }
  redirect("/responsable/documentos/" + encodeURIComponent(token) + "/pendientes");
}

export async function acceptGuardianDocumentAction(formData: FormData) {
  const token = readValue(formData, "token");
  const versionId = readValue(formData, "version_id");
  const decision = readValue(formData, "decision") || "accepted";
  const confirmed = formData.get("confirmation") === "true";

  if (!token || !versionId || !confirmed) {
    redirect(
      "/responsable/documentos/" +
        encodeURIComponent(token) +
        "/" +
        encodeURIComponent(versionId) +
        "?error=confirm",
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_accept_document", {
    p_token: token,
    p_version_id: versionId,
    p_decision: decision,
    p_evidence: {
      identity_confirmed: true,
      confirmation_checked: true,
      source: "guardian_documents",
    },
  });

  const result = data as {
    ok?: boolean;
    acceptance_id?: string;
    guardian_pending?: number;
  } | null;

  if (error || !result?.ok || !result.acceptance_id) {
    redirect(
      "/responsable/documentos/" +
        encodeURIComponent(token) +
        "/" +
        encodeURIComponent(versionId) +
        "?error=accept",
    );
  }

  redirect(
    "/responsable/documentos/" +
      encodeURIComponent(token) +
      "/confirmacion?acceptance=" +
      encodeURIComponent(result.acceptance_id) +
      "&remaining=" +
      encodeURIComponent(String(result.guardian_pending ?? 0)),
  );
}
