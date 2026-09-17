"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [{ href: "/coach", label: "Mis clases" }];

export function CoachNav() {
  const pathname = usePathname();

  return (
    <>
      <aside className="hidden w-56 shrink-0 lg:block" aria-label="Navegación Coach">
        <nav className="sticky top-6 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  active
                    ? "bg-fuchsia-500 text-white"
                    : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0d0e14]/95 px-4 py-3 backdrop-blur lg:hidden"
        aria-label="Navegación Coach móvil"
      >
        <div className="mx-auto flex max-w-md justify-center">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-5 py-2 text-sm font-semibold ${
                  active ? "bg-fuchsia-500 text-white" : "text-zinc-400"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
