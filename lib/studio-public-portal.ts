import { createClient } from "@/lib/supabase/server";

export type PublicStudioPortal = {
  id: string;
  name: string;
  slug: string;
  primaryColor: string;
  logoPath: string | null;
  logoUrl: string | null;
  tagline: string | null;
};

type PublicStudioPortalRow = {
  id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  logo_path: string | null;
  tagline: string | null;
};

export async function getPublicStudioPortal(
  slug?: string | null,
): Promise<PublicStudioPortal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_studio_portal", {
    p_slug: slug ?? null,
  });

  if (error) {
    console.error("[studio.portal] Public branding lookup failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    return null;
  }

  const row = ((data ?? []) as PublicStudioPortalRow[])[0];
  if (!row) return null;

  const logoUrl = row.logo_path
    ? supabase.storage.from("studio-branding").getPublicUrl(row.logo_path).data.publicUrl
    : null;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    primaryColor: row.primary_color ?? "#FF0A8A",
    logoPath: row.logo_path,
    logoUrl,
    tagline: row.tagline?.trim() || null,
  };
}
