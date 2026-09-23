import { redirect } from "next/navigation";

export default async function DocumentAcceptanceTrackingRedirect({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  redirect("/admin/documentos/" + documentId);
}
