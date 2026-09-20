import { notFound } from "next/navigation";

import { StudioPortalLanding } from "@/app/components/studio-portal-landing";
import { getPublicStudioPortal } from "@/lib/studio-public-portal";

export default async function StudioPublicPortalPage({
  params,
}: {
  params: Promise<{ studioSlug: string }>;
}) {
  const { studioSlug } = await params;
  const portal = await getPublicStudioPortal(studioSlug);

  if (!portal) notFound();

  return <StudioPortalLanding portal={portal} />;
}
