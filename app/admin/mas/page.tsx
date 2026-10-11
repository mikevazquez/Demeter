import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES, STUDIO_ROLE_LABELS, type Capability } from "@/lib/auth/capabilities";

type Item = {
  title: string;
  description: string;
  href: string;
  capability: Capability;
  ownerOnly?: boolean;
};
const groups: { title: string; tone: string; items: Item[] }[] = [
  {
    title: "Tu estudio día a día",
    tone: "green",
    items: [
      {
        title: "Actividades",
        description: "Clases, horarios, cupos y reglas.",
        href: "/admin/actividades",
        capability: CAPABILITIES.SCHEDULE_READ,
      },
      {
        title: "Paquetes",
        description: "Por clases, ilimitados, por disciplina y talleres.",
        href: "/admin/productos",
        capability: CAPABILITIES.PRODUCTS_READ,
      },
      {
        title: "Equipo",
        description: "Coaches, recepción y permisos.",
        href: "/admin/instructores",
        capability: CAPABILITIES.INSTRUCTORS_READ,
      },
      {
        title: "Recursos y espacios",
        description: "Salones, tubos y aros.",
        href: "/admin/configuracion/recursos",
        capability: CAPABILITIES.SETTINGS_WRITE,
      },
      {
        title: "Documentos",
        description: "Responsivas, reglamento y firmas.",
        href: "/admin/documentos",
        capability: CAPABILITIES.DOCUMENTS_READ,
      },
      {
        title: "Evaluaciones",
        description: "Niveles y criterios por disciplina.",
        href: "/admin/evaluaciones",
        capability: CAPABILITIES.EVALUATIONS_READ,
      },
    ],
  },
  {
    title: "Crecer y retener",
    tone: "violet",
    items: [
      {
        title: "Inteligencia",
        description: "Ingresos, asistencia, conversión y retención.",
        href: "/admin/inteligencia",
        capability: CAPABILITIES.REPORTS_READ,
      },
      {
        title: "Notificaciones y automatizaciones",
        description: "Qué detona cada mensaje, por qué canal y cuándo.",
        href: "/admin/comunicacion",
        capability: CAPABILITIES.AUTOMATIONS_READ,
      },
      {
        title: "Recompensas y retos",
        description: "Medallas, logros, retos y premios.",
        href: "/admin/recompensas",
        capability: CAPABILITIES.REWARDS_READ,
      },
    ],
  },
  {
    title: "Asistentes IA",
    tone: "red",
    items: [
      {
        title: "Demi y Polina",
        description: "Instrucciones, pruebas y consumo.",
        href: "/admin/asistentes",
        capability: CAPABILITIES.SETTINGS_WRITE,
      },
    ],
  },
  {
    title: "Configuración",
    tone: "blue",
    items: [
      {
        title: "Configuración del estudio",
        description: "Datos, reservas, festivos, pagos, apariencia y región.",
        href: "/admin/configuracion",
        capability: CAPABILITIES.SETTINGS_WRITE,
      },
      {
        title: "Integraciones",
        description: "Mercado Pago, Asistian y WhatsApp.",
        href: "/admin/integraciones",
        capability: CAPABILITIES.SETTINGS_WRITE,
      },
      {
        title: "Plan y suscripción",
        description: "Tu plan de StudioFlow.",
        href: "/admin/suscripcion",
        capability: CAPABILITIES.PLAN_MANAGE,
        ownerOnly: true,
      },
    ],
  },
];

export default async function MorePage() {
  const ctx = await getAdminContext();
  const coach = ctx.can(CAPABILITIES.INSTRUCTOR_PORTAL) && !ctx.can(CAPABILITIES.ADMIN_PORTAL);
  return (
    <main className="portal-page dashboard-shell admin-module-page more-page flow-more">
      <header className="hoy-product-header">
        <div className="hoy-product-wordmark">
          <span>
            STUDIO <b>FLOW</b>
          </span>
          <small>{ctx.studio.name}</small>
        </div>
        <details className="flow-account">
          <summary>{STUDIO_ROLE_LABELS[ctx.membership.role] ?? "Equipo"}</summary>
          <div>
            <strong>{ctx.profile?.full_name ?? "Tu cuenta"}</strong>
            <p>{ctx.user.email}</p>
            <form action={signOut}>
              <input type="hidden" name="mode" value="studio" />
              <button type="submit">Cerrar sesión</button>
            </form>
          </div>
        </details>
      </header>
      <h1>Más</h1>
      {coach ? (
        <section className="flow-card">
          <h2>Tu cuenta de coach</h2>
          <p>
            Tienes acceso a Mis clases y a la agenda de tus clases. Para cambios de horario, ventas
            o alumnas, pide apoyo a administración.
          </p>
        </section>
      ) : (
        groups.map((group) => {
          const items = group.items.filter(
            (item) =>
              (ctx.membership.role !== "reception" ||
                ["Actividades", "Paquetes"].includes(item.title)) &&
              (!item.ownerOnly || ctx.membership.role === "owner") &&
              ctx.can(item.capability),
          );
          return items.length ? (
            <section key={group.title} className={`flow-more-group is-${group.tone}`}>
              <h2>{group.title}</h2>
              <div className="more-list">
                {items.map((item) => (
                  <Link key={item.href} href={item.href} className="more-row">
                    <span className="more-row-icon" aria-hidden="true">
                      {item.title.slice(0, 1)}
                    </span>
                    <span className="more-row-copy">
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="module-chevron" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null;
        })
      )}
    </main>
  );
}
