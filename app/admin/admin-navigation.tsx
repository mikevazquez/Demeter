"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = {
  href: string;
  label: string;
  enabled: boolean;
};

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavigation({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Secciones de administración">
      {items.map((item) => {
        if (!item.enabled) {
          return (
            <span key={item.label} className="admin-nav-item is-disabled" aria-disabled="true">
              <span className="nav-dot" aria-hidden="true" />
              <span>{item.label}</span>
              <small>Próximamente</small>
            </span>
          );
        }

        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.label}
            href={item.href}
            className={`admin-nav-item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="nav-dot" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminMobileNavigation({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  const mobileItems = items.filter(
    (item) =>
      item.enabled &&
      ["/admin", "/admin/agenda", "/admin/alumnas", "/admin/ventas"].includes(item.href),
  );

  return (
    <nav className="admin-mobile-nav" aria-label="Navegación móvil">
      {mobileItems.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
