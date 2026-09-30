import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RegionalSettingsForm } from "../RegionalSettingsForm";
import "../advanced-v2.css";

const errorCopy: Record<string, string> = {
  regional: "Revisa zona horaria, moneda, formato regional y prefijo telefónico.",
  regional_save: "No pudimos guardar la configuración regional.",
};

export default async function RegionSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  return (
    <main className="advanced-v2 advanced-v2-detail">
      <header className="advanced-v2-header">
        <div>
          <Link className="advanced-v2-back" href="/admin/configuracion">
            ← Avanzado
          </Link>
          <h1>Región y formatos</h1>
          <p>Define cómo se interpretan fechas, moneda y teléfonos en este estudio.</p>
        </div>
      </header>

      {params.saved === "regional" ? (
        <div className="advanced-v2-notice is-success">
          Configuración regional actualizada.
        </div>
      ) : null}

      {params.error ? (
        <div className="advanced-v2-notice is-error">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <section className="advanced-v2-form-card">
        <RegionalSettingsForm
          timezone={ctx.studio.timezone}
          currency={ctx.studio.currency}
          locale={ctx.studio.locale}
          phoneCountryCallingCode={ctx.studio.phone_country_calling_code}
        />
      </section>
    </main>
  );
}
