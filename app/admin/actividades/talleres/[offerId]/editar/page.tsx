import { notFound } from "next/navigation";
import { workshopUuid } from "@/src/lib/workshops/admin";
import { WorkshopEditorScreen } from "../../WorkshopEditorScreen";
export default async function EditWorkshopPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const { offerId } = await params;
  if (!workshopUuid.test(offerId)) notFound();
  return <WorkshopEditorScreen offerId={offerId} />;
}
