import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { BusinessProfileForm } from "./BusinessProfileForm";
import "../advanced-v2.css";

const errorCopy: Record<string, string> = {
  business: "Revisa teléfono, correo, página web y domicilio.",
  business_save: "No pudimos guardar la información del estudio.",
};

export default async function BusinessProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [params, ctx] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.SETTINGS_WRITE),
  ]);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const [{ data: studioDetails }, { data: primaryLocation }, { data: fallbackLocation }] =
    await Promise.all([
      ctx.supabase
        .from("studios")
        .select("contact_phone,contact_email,website_url")
        .eq("id", ctx.studio.id)
        .maybeSingle(),
      ctx.supabase
        .from("studio_locations")
        .select("id,name,address")
        .eq("studio_id", ctx.studio.id)
        .eq("is_primary", true)
        .maybeSingle(),
      ctx.supabase
        .from("studio_locations")
        .select("id,name,address")
        .eq("studio_id", ctx.studio.id)
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  const location = primaryLocation ?? fallbackLocation;

  return (
    <main className="advanced-v2 advanced-v2-detail">
      <header className="advanced-v2-header">
        <div>
          <Link className="advanced-v2-back" href="/admin/mas">
            ← Más
          </Link>
          <h1>Información del estudio</h1>
          <p>
            Mantén aquí los datos públicos que Studio Flow y Demi pueden consultar y compartir.
          </p>
        </div>
      </header>

      {params.saved === "business" ? (
        <div className="advanced-v2-notice is-success">
          Información del estudio actualizada.
        </div>
      ) : null}

      {params.error ? (
        <div className="advanced-v2-notice is-error">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <section className="advanced-v2-form-card">
        <BusinessProfileForm
          contactPhone={
            (studioDetails as { contact_phone?: string | null } | null)?.contact_phone ?? ""
          }
          contactEmail={
            (studioDetails as { contact_email?: string | null } | null)?.contact_email ?? ""
          }
          websiteUrl={
            (studioDetails as { website_url?: string | null } | null)?.website_url ?? ""
          }
          locationName={location?.name ?? "Principal"}
          address={location?.address ?? ""}
        />
      </section>
    </main>
  );
}
