"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/student", label: "Inicio", icon: "home" },
  { href: "/student/reservar", label: "Reservar", icon: "calendar" },
  { href: "/student/mis-clases", label: "Mis clases", icon: "ticket" },
  { href: "/student/perfil", label: "Perfil", icon: "profile" },
] as const;

type NavIconName = (typeof items)[number]["icon"];

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

function NavIcon({ name, active = false }: { name: NavIconName; active?: boolean }) {
  const stroke = active && name === "home" ? "#090A0E" : "currentColor";

  if (name === "home") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6">
        <path
          d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"
          fill={active ? "#090A0E" : "none"}
          stroke={active ? "none" : stroke}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="h-6 w-6"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
        <path d="M8 3.5v4M16 3.5v4M4 10h16" />
      </svg>
    );
  }

  if (name === "ticket") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="h-6 w-6"
        stroke={stroke}
        strokeWidth="1.8"
      >
        <path d="M4 7.5A2.5 2.5 0 0 0 6.5 10 2.5 2.5 0 0 0 4 12.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5a2.5 2.5 0 0 0-2.5-2.5A2.5 2.5 0 0 0 20 7.5V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v.5Z" />
        <path d="M12 7v10" strokeDasharray="2 2" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="h-6 w-6"
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" />
    </svg>
  );
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
                <NavIcon name={item.icon} active={active} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <nav
        className="fixed bottom-4 left-1/2 z-50 grid h-[78px] w-[calc(100%-1.5rem)] max-w-[406px] -translate-x-1/2 grid-cols-4 rounded-[28px] border border-[#282b37] bg-[#0c0e14]/95 px-[6px] py-[5px] shadow-2xl backdrop-blur lg:hidden"
        style={{ paddingBottom: "max(0.3rem, env(safe-area-inset-bottom))" }}
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
              className={`flex h-[68px] min-w-0 flex-col items-center justify-start rounded-[18px] text-center transition ${
                active ? "font-semibold text-[#ff0a8a]" : "font-normal text-[#dcdce2]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0 flex h-[48px] w-[48px] items-center justify-center rounded-[18px] ${
                  active ? "bg-[#ff0a8a] text-[#090a0e]" : "bg-transparent text-[#f7f8fb]"
                }`}
              >
                <NavIcon name={item.icon} active={active} />
              </span>
              <span className="mt-[2px] block text-[10px] leading-3">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
