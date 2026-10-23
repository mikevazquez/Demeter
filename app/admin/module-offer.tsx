import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  PLATFORM_MODULES,
  formatMxn,
  moduleActivationQuote,
  platformPlan,
  type PlatformModuleKey,
} from "@/lib/platform/catalog";
import { MODULE_LABEL } from "@/lib/platform/entitlements";

import { requestModuleActivationAction } from "./module-actions";

const MODULE_PITCH: Record<PlatformModuleKey, string> = {
  recompensas:
    "Programas de lealtad, medallas, retos y premios para que tus alumnas regresen y recomienden tu estudio.",
  recursos:
    "Cada alumna elige su tubo, aro o lugar en el salón al reservar, con el mapa de tu espacio.",
  catalogo:
    "Catálogo de figuras por nivel, evaluaciones con calificación y el progreso de cada alumna.",
  demi: "Asistente de WhatsApp con IA que atiende prospectos, cobra y reserva por ti a cualquier hora.",
};

const NOTICES: Record<string, { tone: "ok" | "error"; text: (label: string) => string }> = {
  solicitado: {
    tone: "ok",
    text: (label) =>
      `Recibimos tu solicitud de ${label}. Nébora la activa y te avisa; muy pronto podrás pagarla aquí mismo con tarjeta.`,
  },
  module_already_active: { tone: "ok", text: (label) => `${label} ya está activo en tu estudio.` },
  forbidden: { tone: "error", text: () => "Tu rol no puede contratar módulos." },
  error: { tone: "error", text: () => "No pudimos enviar la solicitud. Intenta de nuevo." },
};

// NEB-01-03 · Pantalla de un módulo no contratado: qué hace, cuánto cuesta y botón para activarlo.
export default async function AdminModuleOffer({
  module: moduleKey,
  notice,
}: {
  module: PlatformModuleKey;
  notice?: string;
}) {
  const ctx = await getAdminContext();
  const label = MODULE_LABEL[moduleKey];
  const canActivate = ctx.can(CAPABILITIES.SETTINGS_WRITE);
  const entitlements = ctx.entitlements;
  const quote = entitlements
    ? moduleActivationQuote({
        plan: entitlements.plan,
        activeModules: PLATFORM_MODULES.filter((entry) => entitlements.modules[entry.key]).map(
          (entry) => entry.key,
        ),
        foundingAlumni: entitlements.foundingAlumni,
        moduleKey,
      })
    : null;
  const message = notice ? NOTICES[notice] : null;
  const isDemi = moduleKey === "demi";

  return (
    <main className="dashboard-shell admin-module-page admin-ux04-secondary module-offer">
      <header className="module-header">
        <div>
          <span className="module-offer-chip">No incluido en tu plan</span>
          <h1>{label}</h1>
          <p>{MODULE_PITCH[moduleKey]}</p>
        </div>
      </header>

      {message ? (
        <p className={`module-offer-notice is-${message.tone}`} role="status">
          {message.text(label)}
        </p>
      ) : null}

      <section className="module-offer-card" aria-label={`Precio de ${label}`}>
        {isDemi ? (
          <>
            <strong className="module-offer-price">
              {formatMxn(quote?.setupPriceMxn ?? 2999)} de configuración
            </strong>
            <p>
              Más una cuota mensual con un volumen de conversaciones incluido. Configuramos tu
              número de WhatsApp, tus precios y tus políticas; el uso de WhatsApp lo pagas directo a
              Meta.
            </p>
          </>
        ) : (
          <>
            <strong className="module-offer-price">
              + {formatMxn(quote?.modulePriceMxn ?? 299)} al mes
            </strong>
            {quote ? (
              <p>
                Tu mensualidad pasaría de {formatMxn(quote.monthlyBeforeMxn)} a{" "}
                {formatMxn(quote.monthlyAfterMxn)}. Hoy solo pagas la parte proporcional hasta tu
                fecha de corte.
              </p>
            ) : null}
          </>
        )}

        {quote?.suggestedPlan ? (
          <p className="module-offer-suggestion">
            Te conviene <strong>{quote.suggestedPlan.label}</strong>: incluye{" "}
            {platformPlan(quote.suggestedPlan.key)
              .includedModules.map((key) => MODULE_LABEL[key])
              .join(", ")}{" "}
            por {formatMxn(quote.suggestedPlan.monthlyPriceMxn)} al mes.
          </p>
        ) : null}

        {canActivate ? (
          <form action={requestModuleActivationAction}>
            <input type="hidden" name="module" value={moduleKey} />
            <button type="submit" className="module-offer-button">
              {isDemi ? "Solicitar Demi" : `Activar ${label}`}
            </button>
          </form>
        ) : (
          <p className="module-offer-muted">Pídele a administración que lo active.</p>
        )}
      </section>
    </main>
  );
}
