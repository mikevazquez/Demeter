"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/student", label: "Inicio", icon: "⌂" },
  { href: "/student/reservar", label: "Reservar", icon: "◫" },
  { href: "/student/mis-clases", label: "Mis clases", icon: "≡" },
  { href: "/student/perfil", label: "Perfil", icon: "○" },
];

function isActive(pathname: string, href: string) {
  if (href === "/student") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StudentNav() {
  const pathname = usePathname();

  return (
    <>
      <nav className="hidden w-64 shrink-0 lg:block" aria-label="Navegación de alumna">
        <div className="sticky top-6 space-y-2 rounded-3xl border border-white/10 bg-white/[0.03] p-3">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  active
                    ? "bg-fuchsia-600 text-white"
                    : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {item.label}
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
              className={`rounded-2xl px-2 py-3 text-center text-xs font-semibold transition sm:text-sm ${
                active ? "bg-fuchsia-600 text-white" : "text-zinc-400"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mx-auto mb-1 block text-lg leading-none ${active ? "text-fuchsia-200" : "text-zinc-500"}`}
              >
                {item.icon}
              </span>
              <span className="block">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
