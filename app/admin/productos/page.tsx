import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

type CategoryIcon = "classes" | "schedule" | "unlimited" | "course";

function PackageIcon({ type }: { type: CategoryIcon }) {
  const common = {
    width: 34,
    height: 34,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (type === "classes") {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </svg>
    );
  }

  if (type === "schedule") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (type === "unlimited") {
    return (
      <svg {...common}>
        <path d="M7.2 8.5c-2.5 0-4.2 1.6-4.2 3.5s1.7 3.5 4.2 3.5c3.3 0 5-7 9.6-7 2.5 0 4.2 1.6 4.2 3.5s-1.7 3.5-4.2 3.5c-3.3 0-5-7-9.6-7Z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m3 9 9-5 9 5-9 5-9-5Z" />
      <path d="M7 12.5V17c2.7 2 7.3 2 10 0v-4.5M21 9v6" />
    </svg>
  );
}

const categories = [
  {
    title: "Por clases",
    description: "Paquetes por cantidad de clases y vigencia.",
    icon: "classes" as const,
    href: "/admin/productos/por-clases",
    tone: "",
    ready: true,
  },
  {
    title: "Por disciplina / horario",
    description: "Restringe a clases, días u horarios específicos.",
    icon: "schedule" as const,
    tone: "is-blue",
    ready: false,
  },
  {
    title: "Ilimitados",
    description: "Acceso libre por periodo.",
    icon: "unlimited" as const,
    tone: "is-amber",
    ready: false,
  },
  {
    title: "Cursos y talleres",
    description: "Vinculados a una actividad específica.",
    icon: "course" as const,
    tone: "is-purple",
    ready: false,
  },
];

export default async function ProductsPage() {
  await getAdminContext("products.read");

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <h1>Paquetes</h1>
        <p>Elige cómo quieres organizar tus paquetes.</p>
      </header>

      <section className="packages-v2-info" aria-label="Cómo usar paquetes">
        <span className="packages-v2-info-icon" aria-hidden="true">
          i
        </span>
        <p>Selecciona una categoría para ver sus paquetes y crear uno nuevo.</p>
      </section>

      <section className="package-category-grid" aria-label="Tipos de paquetes">
        {categories.map((category) =>
          category.ready ? (
            <Link
              key={category.title}
              href={category.href}
              className={`package-category-card ${category.tone}`}
            >
              <span className="package-category-icon">
                <PackageIcon type={category.icon} />
              </span>
              <span className="package-category-copy">
                <strong>{category.title}</strong>
                <span>{category.description}</span>
              </span>
              <span className="package-category-action">
                Ver <span aria-hidden="true">›</span>
              </span>
            </Link>
          ) : (
            <div
              key={category.title}
              className={`package-category-card is-disabled ${category.tone}`}
              aria-disabled="true"
            >
              <span className="package-category-icon">
                <PackageIcon type={category.icon} />
              </span>
              <span className="package-category-copy">
                <strong>{category.title}</strong>
                <span>{category.description}</span>
              </span>
              <span className="package-category-soon">Siguiente</span>
            </div>
          ),
        )}
      </section>
    </main>
  );
}
