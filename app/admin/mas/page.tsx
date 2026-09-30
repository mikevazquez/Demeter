import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";

type MoreItem = {
  title: string;
  description: string;
  href: string;
  capability?: Capability;
  ownerOnly?: boolean;
};

const items: MoreItem[] = [
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
    capability: CAPABILITIES.EVALUATIONS_READ,
  },
  {
    title: "Paquetes",
    description: "Paquetes por clases, restricciones, ilimitados y talleres.",
    href: "/admin/productos",
    capability: CAPABILITIES.PRODUCTS_READ,
  },
  {
    title: "Reservas",
    description: "Cancelaciones, no-show y penalizaciones del estudio.",
    href: "/admin/configuracion/reservas",
    ownerOnly: true,
  },
  {
    title: "Equipo",
    description: "Miembros del estudio, perfiles operativos y estado.",
    href: "/admin/instructores",
    capability: CAPABILITIES.INSTRUCTORS_READ,
  },
  {
    title: "Apariencia",
    description: "Nombre, logo, color e identidad visible del estudio.",
    href: "/admin/configuracion/apariencia",
    ownerOnly: true,
  },
  {
    title: "Comunicación",
    description: "Procesos, marketing, plantillas y horarios de envío.",
    href: "/admin/automatizaciones",
    capability: CAPABILITIES.AUTOMATIONS_READ,
  },
  {
    title: "Progreso y recompensas",
    description: "Programas, logros, retos, seguimiento y recompensas generadas.",
    href: "/admin/recompensas",
    capability: CAPABILITIES.REWARDS_READ,
  },
  {
    title: "Avanzado",
    description: "Región, integraciones, recursos y plan del estudio.",
    href: "/admin/configuracion",
    ownerOnly: true,
  },
];

export default async function MorePage() {
  const ctx = await getAdminContext();
  const visibleItems = items.filter((item) => {
    if (item.ownerOnly && ctx.membership.role !== "owner") return false;
    return item.capability ? ctx.can(item.capability) : true;
  });

  return (
    <main className="dashboard-shell admin-module-page more-page admin-ux04-secondary">
      <header className="module-header">
        <div>
          <h1>Más</h1>
          <p>Herramientas y áreas de gestión disponibles para tu rol.</p>
        </div>
      </header>

      {visibleItems.length ? (
        <section className="more-list">
          {visibleItems.map((item) => (
            <Link key={item.href} href={item.href} className="more-row">
              <span className="more-row-icon" aria-hidden="true">
                ◇
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
        </section>
      ) : (
        <section className="empty-state">No tienes herramientas adicionales disponibles.</section>
      )}
    </main>
  );
}
