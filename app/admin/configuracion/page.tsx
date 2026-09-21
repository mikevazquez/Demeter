import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { PortalIdentityForm } from "./PortalIdentityForm";

const errorCopy: Record<string, string> = {
  name: "El nombre del estudio debe tener entre 2 y 80 caracteres.",
  logo_type: "Usa un logo PNG, JPG o WebP.",
  logo_size: "El logo debe pesar máximo 2 MB.",
  logo_upload: "No pudimos subir el logo. Inténtalo nuevamente.",
  save: "No pudimos guardar la identidad del estudio.",
};

export default async function ConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const logoUrl = ctx.studio.logo_path
    ? ctx.supabase.storage.from("studio-branding").getPublicUrl(ctx.studio.logo_path).data.publicUrl
    : null;

  const portalPath = `/s/${ctx.studio.slug}`;

  return (
    <main className="dashboard-shell admin-ux04-secondary configuration-page">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/mas">
            ← Más
          </Link>
          <p className="eyebrow">CONFIGURACIÓN · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Configuración</h1>
          <p>Define cómo se presenta tu estudio antes de iniciar sesión.</p>
        </div>
      </header>

      {params.saved === "1" ? (
        <div className="notice success">Identidad del portal actualizada correctamente.</div>
      ) : null}

      {params.error ? (
        <div className="notice error">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <PortalIdentityForm
        initialName={ctx.studio.name}
        initialLogoUrl={logoUrl}
        portalPath={portalPath}
        primaryColor={ctx.studio.primary_color ?? "#FF0A8A"}
      />
    </main>
  );
}
