import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { STUDIO_MODULES } from "@/lib/auth/modules";

import { OperatingPolicyForm } from "./OperatingPolicyForm";
import { PortalIdentityForm } from "./PortalIdentityForm";
import { RegionalSettingsForm } from "./RegionalSettingsForm";

const errorCopy: Record<string, string> = {
  name: "El nombre del estudio debe tener entre 2 y 80 caracteres.",
  tagline: "La frase de marca debe tener máximo 120 caracteres.",
  primary_color: "Selecciona un color principal válido.",
  logo_type: "Usa un logo PNG, JPG o WebP.",
  logo_size: "El logo debe pesar máximo 2 MB.",
  logo_upload: "No pudimos subir el logo. Inténtalo nuevamente.",
  identity_save: "No pudimos guardar la identidad del estudio.",
  cutoff: "El límite de cancelación debe estar entre 0 y 168 horas.",
  minimum_defaults: "Revisa los defaults de mínimo de reservas y penalizaciones.",
  operating_save: "No pudimos guardar la política operativa.",
  regional: "Revisa zona horaria, moneda, locale y prefijo telefónico.",
  regional_save: "No pudimos guardar la configuración regional.",
};

const savedCopy: Record<string, string> = {
  identity: "Identidad del portal actualizada correctamente.",
  operating: "Política operativa actualizada correctamente.",
  regional: "Configuración regional actualizada correctamente.",
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

  const [{ data: operatingPolicy }, logoUrl] = await Promise.all([
    ctx.supabase
      .from("studio_operating_policies")
      .select(
        "cancellation_cutoff_minutes,late_cancellation_consumes_credit,no_show_consumes_credit,default_minimum_reservations_enabled,default_minimum_reservations,default_minimum_review_minutes_before,default_minimum_override_allowed,unlimited_late_cancellation_penalty_minor,unlimited_no_show_penalty_minor",
      )
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    Promise.resolve(
      ctx.studio.logo_path
        ? ctx.supabase.storage.from("studio-branding").getPublicUrl(ctx.studio.logo_path).data
            .publicUrl
        : null,
    ),
  ]);

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
          <p>Ajusta la identidad, región y reglas operativas de este estudio.</p>
        </div>
      </header>

      {params.saved && savedCopy[params.saved] ? (
        <div className="notice success">{savedCopy[params.saved]}</div>
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
        initialPrimaryColor={ctx.studio.primary_color ?? "#FF0A8A"}
        initialTagline={ctx.studio.tagline ?? null}
      />

      <OperatingPolicyForm
        cancellationCutoffMinutes={operatingPolicy?.cancellation_cutoff_minutes ?? 300}
        lateCancellationConsumesCredit={
          operatingPolicy?.late_cancellation_consumes_credit ?? true
        }
        noShowConsumesCredit={operatingPolicy?.no_show_consumes_credit ?? true}
        defaultMinimumReservationsEnabled={
          operatingPolicy?.default_minimum_reservations_enabled ?? false
        }
        defaultMinimumReservations={operatingPolicy?.default_minimum_reservations ?? 2}
        defaultMinimumReviewMinutesBefore={
          operatingPolicy?.default_minimum_review_minutes_before ?? 120
        }
        defaultMinimumOverrideAllowed={
          operatingPolicy?.default_minimum_override_allowed ?? true
        }
        unlimitedLateCancellationPenaltyMinor={
          operatingPolicy?.unlimited_late_cancellation_penalty_minor ?? 0
        }
        unlimitedNoShowPenaltyMinor={
          operatingPolicy?.unlimited_no_show_penalty_minor ?? 0
        }
        currency={ctx.studio.currency}
      />

      <RegionalSettingsForm
        timezone={ctx.studio.timezone}
        currency={ctx.studio.currency}
        locale={ctx.studio.locale}
        phoneCountryCallingCode={ctx.studio.phone_country_calling_code}
      />

      <section className="panel">
        <p className="eyebrow">INTEGRACIONES</p>
        <h2>Asistian</h2>
        <p>
          Configura y prueba los webhooks firmados que conectan Studio Flow con las automatizaciones
          de WhatsApp en Asistian.
        </p>
        <Link className="primary-button" href="/admin/integraciones/asistian">
          Configurar Asistian
        </Link>
      </section>

      {ctx.hasModule(STUDIO_MODULES.RESOURCES) ? (
        <section className="panel">
          <p className="eyebrow">RECURSOS</p>
          <h2>Recursos y mapa</h2>
          <p>
            Define qué recursos físicos existen y dónde están ubicados. Las sesiones administran
            después su disponibilidad y capacidad.
          </p>
          <Link className="primary-button" href="/admin/configuracion/recursos">
            Configurar recursos
          </Link>
        </section>
      ) : null}
    </main>
  );
}
