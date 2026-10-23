import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { modulePriceLabel, type PlatformModuleKey } from "@/lib/platform/catalog";
import { configIssuesSummary, parseConfigIssues } from "@/lib/platform/config-issues";
import { loadStudioFeatureFlags, parseFeatureNews } from "@/lib/platform/features";

import { dismissFeatureNewsAction } from "./actions";
import "./more-news.css";

type MoreItem = {
  title: string;
  description: string;
  href: string;
  capability?: Capability;
  ownerOnly?: boolean;
  /** NEB-01-03 · módulo de Nébora que debe estar contratado. */
  requiresModule?: PlatformModuleKey;
  /** NEB-01-20 · función de Nébora que debe estar lanzada en el estudio. */
  feature?: string;
};

const items: MoreItem[] = [
  {
    title: "Demi",
    description: "Personalidad, objetivos, reglas, pruebas y atención del asistente del estudio.",
    href: "/admin/mas/demi",
    ownerOnly: true,
    requiresModule: "demi",
  },
  {
    title: "Actividades",
    description: "Qué ofreces, horarios, recursos y forma de acceso.",
    href: "/admin/actividades",
    capability: CAPABILITIES.SCHEDULE_READ,
  },
  {
    title: "Inteligencia",
    description: "Ingresos, conversión, clases, retención y señales para decidir.",
    href: "/admin/inteligencia",
    capability: CAPABILITIES.REPORTS_READ,
  },
  {
    title: "Documentos",
    description: "Contratos, responsivas, reglamentos y consentimientos.",
    href: "/admin/documentos",
    capability: CAPABILITIES.DOCUMENTS_READ,
  },
  {
    title: "Evaluaciones",
    description: "Configura disciplinas, niveles y criterios técnicos.",
    href: "/admin/evaluaciones",
    requiresModule: "catalogo",
    capability: CAPABILITIES.EVALUATIONS_READ,
  },
  {
    title: "Paquetes",
    description: "Paquetes por clases, restricciones, ilimitados y talleres.",
    href: "/admin/productos",
    capability: CAPABILITIES.PRODUCTS_READ,
  },
  {
    title: "Equipo",
    description: "Miembros del estudio, perfiles operativos y estado.",
    href: "/admin/instructores",
    capability: CAPABILITIES.INSTRUCTORS_READ,
  },
  {
    title: "Notificaciones",
    description: "Procesos, marketing, plantillas y horarios de envío.",
    href: "/admin/notificaciones",
    capability: CAPABILITIES.AUTOMATIONS_READ,
  },
  {
    title: "Retos",
    description: "Crea retos individuales y competencias con ranking, premios y progreso.",
    href: "/admin/retos",
    requiresModule: "recompensas",
    capability: CAPABILITIES.REWARDS_READ,
  },
  {
    title: "Rewards",
    description: "Programas, logros, medallas, seguimiento y recompensas generadas.",
    href: "/admin/recompensas",
    requiresModule: "recompensas",
    capability: CAPABILITIES.REWARDS_READ,
  },
  {
    title: "Información del estudio",
    description: "Domicilio, teléfono, correo y página web que Demi puede consultar.",
    href: "/admin/configuracion/empresa",
    ownerOnly: true,
  },
  {
    title: "Integraciones",
    description: "Conecta Mercado Pago, Asistian, Meta y otros servicios externos.",
    href: "/admin/integraciones",
    ownerOnly: true,
  },
  {
    title: "Apariencia",
    description: "Nombre, logo, color e identidad visible del estudio.",
    href: "/admin/configuracion/apariencia",
    ownerOnly: true,
  },
  {
    title: "Región y formatos",
    description: "Zona horaria, moneda, formato regional y prefijo telefónico.",
    href: "/admin/configuracion/region",
    ownerOnly: true,
  },
  {
    title: "Pagos y transferencias",
    description: "Datos bancarios que Demi comparte cuando una alumna elige transferencia.",
    href: "/admin/configuracion/pagos",
    ownerOnly: true,
  },
  {
    title: "Recursos y espacios",
    description: "Recursos físicos, mapas y distribución de los espacios.",
    href: "/admin/configuracion/recursos",
    requiresModule: "recursos",
    ownerOnly: true,
  },
  {
    title: "Ayuda de Nébora",
    description: "Pide soporte y consulta las respuestas.",
    href: "/admin/mas/ayuda",
    capability: CAPABILITIES.SETTINGS_WRITE,
    feature: "support_requests",
  },
  {
    title: "Revisión de configuración",
    description: "Lo que conviene corregir para vender y reservar sin trabas.",
    href: "/admin/configuracion/revision",
    capability: CAPABILITIES.SETTINGS_WRITE,
    feature: "config_review",
  },
  {
    title: "Plan y suscripción",
    description: "Estado del plan, periodo contratado y facturación de Studio Flow.",
    href: "/admin/suscripcion",
    ownerOnly: true,
  },
];

export default async function MorePage() {
  const ctx = await getAdminContext();
  const [features, news] = await Promise.all([
    loadStudioFeatureFlags(ctx.supabase, ctx.studio.id),
    ctx.supabase
      .rpc("studio_feature_news", { p_studio: ctx.studio.id })
      .then(({ data, error }) => (error ? [] : parseFeatureNews(data))),
  ]);
  const visibleItems = items.filter((item) => {
    if (item.feature && !features.has(item.feature)) return false;
    if (item.ownerOnly) return ctx.membership.role === "owner";
    return item.capability ? ctx.can(item.capability) : false;
  });
  // NEB-01-18 · contador de la revisión de configuración.
  const reviewSummary =
    ctx.can(CAPABILITIES.SETTINGS_WRITE) && features.has("config_review")
      ? await ctx.supabase
          .rpc("studio_config_issues", { p_studio: ctx.studio.id })
          .then(({ data, error }) => (error ? null : configIssuesSummary(parseConfigIssues(data))))
      : null;

  return (
    <main className="dashboard-shell admin-module-page more-page admin-ux04-secondary">
      <header className="module-header">
        <div>
          <h1>Más</h1>
          <p>Herramientas y áreas de gestión disponibles para tu rol.</p>
        </div>
      </header>

      {news.length ? (
        <section className="more-news" aria-label="Novedades">
          {news.map((item) => (
            <article key={item.key} className="more-news-item">
              <div>
                <span className="more-news-badge">Novedad</span>
                <strong>{item.name}</strong>
                {item.description ? <p>{item.description}</p> : null}
              </div>
              <form action={dismissFeatureNewsAction}>
                <input type="hidden" name="feature" value={item.key} />
                <button type="submit" aria-label={`Cerrar novedad ${item.name}`}>
                  Entendido
                </button>
              </form>
            </article>
          ))}
        </section>
      ) : null}

      {visibleItems.length ? (
        <section className="more-list">
          {visibleItems.map((item) => (
            <Link key={item.href} href={item.href} className="more-row">
              <span className="more-row-icon" aria-hidden="true">
                ◇
              </span>
              <span className="more-row-copy">
                <strong>{item.title}</strong>
                <small>
                  {item.requiresModule && !ctx.hasModule(item.requiresModule)
                    ? "Bloqueado · " + modulePriceLabel(item.requiresModule)
                    : item.href === "/admin/configuracion/revision" && reviewSummary
                      ? reviewSummary
                      : item.description}
                </small>
              </span>
              <span className="module-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="empty-state">No tienes herramientas adicionales disponibles.</section>
      )}
    </main>
  );
}
