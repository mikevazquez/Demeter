import { getPublicStudioPortal } from "@/lib/studio-public-portal";

import { LoginCard } from "../login-card";

export default async function StudentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; studio?: string }>;
}) {
  const { error, studio } = await searchParams;
  const portal = studio ? await getPublicStudioPortal(studio) : null;

  return (
    <LoginCard
      mode="student"
      error={error}
      brandName={portal?.name ?? "Studio Flow"}
      studioSlug={portal?.slug}
    />
  );
}
