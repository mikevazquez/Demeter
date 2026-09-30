import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StudioPortalLanding } from "@/app/components/studio-portal-landing";
import { getPublicStudioPortal } from "@/lib/studio-public-portal";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ studioSlug: string }>;
}): Promise<Metadata> {
  const { studioSlug } = await params;
  const portal = await getPublicStudioPortal(studioSlug);

  if (!portal) {
    return { title: "Portal del estudio" };
  }

  return {
    title: portal.name,
    description: portal.tagline ?? `Portal de ${portal.name}`,
  };
}

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
