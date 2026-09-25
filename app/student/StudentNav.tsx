"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavIconName = "home" | "calendar" | "classes" | "profile";

const items: Array<{ href: string; label: string; icon: NavIconName }> = [
  { href: "/student", label: "Inicio", icon: "home" },
  { href: "/student/reservar", label: "Reservar", icon: "calendar" },
  { href: "/student/mis-clases", label: "Mis clases", icon: "classes" },
  { href: "/student/perfil", label: "Perfil", icon: "profile" },
];

const profileOwnedRoutes = [
  "/student/perfil",
  "/student/evaluaciones",
  "/student/recompensas",
  "/student/retos",
  "/student/paquete",
  "/student/movimientos",
  "/student/pagos",
  "/student/documentos",
];

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "home") {
    return (
      <svg {...common} aria-hidden="true" className="h-5 w-5">
        <path d="M3 10.8 12 3l9 7.8" />
        <path d="M5.5 9.5V21h13V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg {...common} aria-hidden="true" className="h-5 w-5">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    );
  }

  if (name === "classes") {
    return (
      <svg {...common} aria-hidden="true" className="h-5 w-5">
        <path d="M6 6h15M6 12h15M6 18h15" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    );
  }

  return (
    <svg {...common} aria-hidden="true" className="h-5 w-5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/student") return pathname === href;

  if (href === "/student/perfil") {
    return profileOwnedRoutes.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`),
    );
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StudentNav() {
  const pathname = usePathname();

  return (
    <>
      <nav className="hidden w-64 shrink-0 lg:block" aria-label="Navegación de alumna">
        <div className="sticky top-24 space-y-1.5 rounded-3xl border border-white/10 bg-white/[0.025] p-2.5">
          {items.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={item.href === "/student/reservar" ? false : undefined}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-2xl px-3.5 text-sm font-semibold transition ${
                  active
                    ? "bg-fuchsia-600 text-white shadow-[0_10px_28px_rgba(236,72,153,0.18)]"
                    : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span className={active ? "text-white" : "text-zinc-500"}>
                  <NavIcon name={item.icon} />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <nav
        className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-4 gap-1 rounded-3xl border border-white/10 bg-[#111218]/95 p-2 shadow-2xl backdrop-blur lg:hidden"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        aria-label="Navegación de alumna"
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={item.href === "/student/reservar" ? false : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center rounded-2xl px-2 py-2 text-center text-xs font-semibold transition sm:text-sm ${
                active ? "bg-fuchsia-600 text-white" : "text-zinc-400"
              }`}
            >
              <span className={`mb-1 ${active ? "text-white" : "text-zinc-500"}`}>
                <NavIcon name={item.icon} />
              </span>
              <span className="block">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
