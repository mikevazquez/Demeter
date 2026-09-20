import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";

type MoreItem = {
  title: string;
  description: string;
  href: string;
  capability: Capability;
};

const items: MoreItem[] = [
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
    title: "Automatizaciones",
    description: "Mensajes, recordatorios y flujos automáticos.",
    href: "/admin/automatizaciones",
    capability: CAPABILITIES.AUTOMATIONS_READ,
  },
  {
    title: "Atención",
    description: "Incidencias y casos pendientes que requieren intervención.",
    href: "/admin/acciones",
    capability: CAPABILITIES.REQUIRED_ACTIONS_READ,
  },
];

export default async function MorePage() {
  const ctx = await getAdminContext();
  const visibleItems = items.filter((item) => ctx.can(item.capability));

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">NAVEGACIÓN · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Más</h1>
          <p>Herramientas y áreas de gestión disponibles para tu rol.</p>
        </div>
      </header>

      {visibleItems.length ? (
        <section className="grid gap-3 md:grid-cols-2">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-decoration-none transition hover:border-fuchsia-500/40 hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{item.description}</p>
                </div>
                <span className="text-xl text-fuchsia-300 transition group-hover:translate-x-1">→</span>
              </div>
            </Link>
          ))}
        </section>
      ) : (
        <section className="empty-state">No tienes herramientas adicionales disponibles.</section>
      )}
    </main>
  );
}
