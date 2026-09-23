import { notFound, redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

export default async function AcceptanceEvidenceRedirect({
  params,
}: {
  params: Promise<{ acceptanceId: string }>;
}) {
  const { acceptanceId } = await params;
  const { supabase, studio } = await getAdminContext(CAPABILITIES.DOCUMENTS_READ);

  const { data: acceptance } = await supabase
    .from("document_acceptances")
    .select("student_id")
    .eq("id", acceptanceId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!acceptance?.student_id) notFound();

  redirect("/admin/alumnas/" + acceptance.student_id + "?view=documents");
}
