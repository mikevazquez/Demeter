import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

type CompanySection = {
  title: string;
  description: string;
  href: string;
  capability: string;
  eyebrow: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

const sections: CompanySection[] = [
  {
    title: "Agenda y actividades",
    description: "Disciplinas, actividades, horarios recurrentes, sesiones, espacios y cupos.",
    href: "/admin/agenda",
    capability: CAPABILITIES.SCHEDULE_READ,
    eyebrow: "OPERACIÓN",
  },
  {
    title: "Coaches",
    description: "Da de alta y administra a las personas que imparten clases en el estudio.",
    href: "/admin/instructores",
    capability: CAPABILITIES.INSTRUCTORS_READ,
    eyebrow: "EQUIPO",
  },
  {
    title: "Productos y paquetes",
    description: "Paquetes, membresías, clases sueltas e inscripción con sus precios y vigencias.",
    href: "/admin/productos",
    capability: CAPABILITIES.PRODUCTS_READ,
    eyebrow: "CATÁLOGO",
  },
  {
    title: "Ventas y pagos",
    description: "Ventas, pagos posteriores, reembolsos, anulaciones y control comercial.",
    href: "/admin/ventas",
    capability: CAPABILITIES.SALES_READ,
    eyebrow: "COMERCIAL",
    secondaryHref: "/admin/ventas/inscripcion",
    secondaryLabel: "Política de inscripción",
  },
];

export default async function CompanyPage() {
  const ctx = await getAdminContext();
  const visibleSections = sections.filter((section) => ctx.can(section.capability));

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">EMPRESA · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Empresa</h1>
          <p>Todo lo necesario para configurar y operar tu estudio, sin llenar el menú principal.</p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {visibleSections.map((section) => (
          <article
            key={section.href}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              {section.eyebrow}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">{section.title}</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-zinc-400">{section.description}</p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href={section.href}
                className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:border-fuchsia-500/40 hover:bg-white/[0.07]"
              >
                Abrir
              </Link>
              {section.secondaryHref && section.secondaryLabel ? (
                <Link
                  href={section.secondaryHref}
                  className="text-sm font-semibold text-zinc-400 transition hover:text-fuchsia-300"
                >
                  {section.secondaryLabel} →
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      {!visibleSections.length ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-400">
          Tu rol no tiene acceso a secciones de empresa.
        </section>
      ) : null}
    </main>
  );
}
