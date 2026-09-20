"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = {
  href: string;
  label: string;
  enabled: boolean;
  activeFor?: string[];
  secondary?: boolean;
};

function matchesPath(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActivePath(pathname: string, item: AdminNavItem) {
  if (matchesPath(pathname, item.href)) return true;
  return item.activeFor?.some((href) => matchesPath(pathname, href)) ?? false;
}

export function AdminNavigation({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Secciones de administración">
      {items.map((item, index) => {
        const showDivider = item.secondary && index > 0 && !items[index - 1]?.secondary;

        if (!item.enabled) {
          return (
            <span
              key={item.label}
              className={`admin-nav-item is-disabled${item.secondary ? " is-secondary" : ""}`}
              aria-disabled="true"
            >
              <span className="nav-dot" aria-hidden="true" />
              <span>{item.label}</span>
              <small>Próximamente</small>
            </span>
          );
        }

        const active = isActivePath(pathname, item);
        return (
          <div key={item.label}>
            {showDivider ? <div className="admin-nav-divider" aria-hidden="true" /> : null}
            <Link
              href={item.href}
              className={`admin-nav-item${active ? " is-active" : ""}${item.secondary ? " is-secondary" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="nav-dot" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

export function AdminMobileNavigation({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  const mobileItems = items.filter((item) => item.enabled);

  return (
    <nav className="admin-mobile-nav" aria-label="Navegación móvil">
      {mobileItems.map((item) => {
        const active = isActivePath(pathname, item);
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
