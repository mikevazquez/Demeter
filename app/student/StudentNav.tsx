"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/student", label: "Inicio", emoji: "🏠" },
  { href: "/student/reservar", label: "Reservar", emoji: "📅" },
  { href: "/student/mis-clases", label: "Mis clases", emoji: "🎟️" },
  { href: "/student/perfil", label: "Perfil", emoji: "👤" },
] as const;

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
                <span aria-hidden="true" className="text-xl leading-none">
                  {item.emoji}
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
              <span aria-hidden="true" className="mb-1 text-xl leading-none">
                {item.emoji}
              </span>
              <span className="block">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
