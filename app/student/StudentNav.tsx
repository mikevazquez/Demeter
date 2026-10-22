"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { studentNavigationItems as allItems } from "@/lib/student/navigation";

function isActive(pathname: string, href: string) {
  if (href === "/student") return pathname === href;
  if (href === "/student/perfil" && pathname.startsWith("/student/evaluaciones")) {
    return true;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StudentNav({ hiddenHrefs = [] }: { hiddenHrefs?: string[] }) {
  const pathname = usePathname();
  const items = allItems.filter((item) => !hiddenHrefs.includes(item.href));

  return (
    <>
      <nav className="hidden w-64 shrink-0 lg:block" aria-label="Navegación de alumna">
        <div className="sendero-desktop-nav sticky top-6 space-y-2 p-3">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={item.prefetch}
                className={`sendero-nav-item block rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  active ? "sendero-nav-item-active" : ""
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <nav
        className="sendero-mobile-nav fixed inset-x-3 bottom-3 z-50 grid grid-cols-5 gap-1 p-2 lg:hidden"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        aria-label="Navegación de alumna"
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`sendero-nav-item rounded-2xl px-2 py-3 text-center text-xs font-semibold transition sm:text-sm ${
                active ? "sendero-nav-item-active" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`mx-auto mb-1 block text-lg leading-none ${active ? "text-[var(--sendero-mint)]" : "text-[var(--sendero-faint)]"}`}
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
