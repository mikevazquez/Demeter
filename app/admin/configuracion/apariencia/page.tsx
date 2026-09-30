import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { AppearanceForm } from "./AppearanceForm";
import "./appearance-v2.css";

const errorCopy: Record<string, string> = {
  name: "El nombre del estudio debe tener entre 2 y 80 caracteres.",
  tagline: "La frase de marca debe tener máximo 120 caracteres.",
  primary_color: "Selecciona un color principal válido.",
  logo_type: "Usa un logo PNG, JPG o WebP.",
  logo_size: "El logo debe pesar máximo 2 MB.",
  logo_upload: "No pudimos subir el logo. Inténtalo nuevamente.",
  identity_save: "No pudimos guardar la apariencia del estudio.",
};

export default async function AppearancePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const { data: extraStudioSettings } = await ctx.supabase
    .from("studios")
    .select("tagline")
    .eq("id", ctx.studio.id)
    .maybeSingle();

  const logoUrl = ctx.studio.logo_path
    ? ctx.supabase.storage.from("studio-branding").getPublicUrl(ctx.studio.logo_path).data.publicUrl
    : null;

  return (
    <main className="appearance-v2">
      <header className="appearance-v2-header">
        <div>
          <Link className="appearance-v2-back" href="/admin/mas">
            ← Más
          </Link>
          <h1>Apariencia</h1>
          <p>Personaliza cómo se presenta tu estudio en Studio Flow.</p>
        </div>
      </header>

      {params.saved === "identity" ? (
        <div className="appearance-v2-notice is-success">
          Apariencia actualizada correctamente.
        </div>
      ) : null}

      {params.error ? (
        <div className="appearance-v2-notice is-error">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <AppearanceForm
        initialName={ctx.studio.name}
        initialLogoUrl={logoUrl}
        initialPrimaryColor={ctx.studio.primary_color ?? "#FF0A8A"}
        initialTagline={(extraStudioSettings as { tagline?: string | null } | null)?.tagline ?? null}
        portalPath={`/s/${ctx.studio.slug}`}
      />
    </main>
  );
}
