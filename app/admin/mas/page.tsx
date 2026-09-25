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
    title: "Disciplinas",
    description: "Imágenes y presentación visual de cada disciplina en el portal.",
    href: "/admin/disciplinas",
    capability: CAPABILITIES.SCHEDULE_WRITE,
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
    title: "Productos",
    description: "Paquetes, membresías, clases sueltas e inscripciones.",
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
    description: "Procesos, marketing, plantillas y preferencias de comunicación.",
    href: "/admin/notificaciones",
    capability: CAPABILITIES.AUTOMATIONS_READ,
  },
  {
    title: "Retos",
    description: "Crea retos individuales y competencias con ranking, premios y progreso.",
    href: "/admin/retos",
    capability: CAPABILITIES.REWARDS_READ,
  },
  {
    title: "Rewards",
    description: "Programas, logros, medallas, seguimiento y recompensas generadas.",
    href: "/admin/recompensas",
    capability: CAPABILITIES.REWARDS_READ,
  },
  {
    title: "Integraciones",
    description: "Conecta WhatsApp directo con Meta y administra servicios externos.",
    href: "/admin/integraciones/whatsapp",
    ownerOnly: true,
  },
  {
    title: "Configuración",
    description: "Identidad pública y preferencias del estudio.",
    href: "/admin/configuracion",
    ownerOnly: true,
  },
];

export default async function MorePage() {
  const ctx = await getAdminContext();
  const visibleItems = items.filter((item) => {
    if (item.ownerOnly) return ctx.membership.role === "owner";
    return item.capability ? ctx.can(item.capability) : false;
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
