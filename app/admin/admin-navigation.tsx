"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = {
  href: string;
  label: string;
  enabled: boolean;
  activeFor?: string[];
  secondary?: boolean;
  badge?: number;
};

function matchesPath(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActivePath(pathname: string, item: AdminNavItem) {
  if (matchesPath(pathname, item.href)) return true;
  return item.activeFor?.some((href) => matchesPath(pathname, href)) ?? false;
}

function NavIcon({ label }: { label: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (label === "Hoy") {
    return (
      <svg {...common}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
        <path d="M9 21v-7h6v7" />
      </svg>
    );
  }
  if (label === "Agenda" || label === "Mis clases") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18" />
      </svg>
    );
  }
  if (label === "Alumnas") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20c.6-4 2.6-6 5.5-6s4.9 2 5.5 6" />
        <path d="M16 7.5a2.5 2.5 0 0 1 0 5M17 15c2.2.6 3.4 2.3 3.8 5" />
      </svg>
    );
  }
  if (label === "Evaluaciones") {
    return (
      <svg {...common}>
        <path d="M5 20V12M12 20V7M19 20V4" />
        <path d="M3 20h18" />
      </svg>
    );
  }
  if (label === "Productos") {
    return (
      <svg {...common}>
        <path d="M5 7h14l-1 14H6L5 7Z" />
        <path d="M8 7a4 4 0 0 1 8 0" />
      </svg>
    );
  }
  if (label === "Equipo") {
    return (
      <svg {...common}>
        <circle cx="8" cy="9" r="3" />
        <circle cx="16" cy="9" r="3" />
        <path d="M2.5 20c.5-3.5 2.4-5.5 5.5-5.5S13 16.5 13.5 20" />
        <path d="M10.5 20c.5-3.5 2.4-5.5 5.5-5.5s5 2 5.5 5.5" />
      </svg>
    );
  }
  if (label === "Automatizaciones") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V21h-4v-.1A1.8 1.8 0 0 0 8.8 19a1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2A1.8 1.8 0 0 0 2.7 13H2v-4h.7A1.8 1.8 0 0 0 4.4 8a1.8 1.8 0 0 0-.4-2l-.1-.1 2.8-2.8.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 10 1.9V2h4v-.1A1.8 1.8 0 0 0 15.1 3.6a1.8 1.8 0 0 0 2-.4l.1-.1L20 5.9l-.1.1a1.8 1.8 0 0 0-.4 2A1.8 1.8 0 0 0 21.3 9h.7v4h-.7a1.8 1.8 0 0 0-1.9 2Z" />
      </svg>
    );
  }
  if (label === "Configuración") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.5 1A7 7 0 0 0 14.7 6L14.4 3h-4.8L9.3 6a7 7 0 0 0-1.7 1L5 6 3 9.5 5 11a7 7 0 0 0 0 2l-2 1.5L5 18l2.6-1a7 7 0 0 0 1.7 1l.3 3h4.8l.3-3a7 7 0 0 0 1.7-1l2.6 1 2-3.5-2-1.5a7 7 0 0 0 .1-1Z" />
      </svg>
    );
  }
  if (label === "Más") {
    return (
      <svg {...common}>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export function AdminNavigation({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Secciones de administración">
      {items.map((item, index) => {
        const showDivider = item.secondary && index > 0 && !items[index - 1]?.secondary;
        if (!item.enabled) return null;

        const active = isActivePath(pathname, item);
        return (
          <div key={item.label}>
            {showDivider ? <div className="admin-nav-divider" aria-hidden="true" /> : null}
            <Link
              href={item.href}
              className={`admin-nav-item${active ? " is-active" : ""}${item.secondary ? " is-secondary" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="nav-icon">
                <NavIcon label={item.label} />
              </span>
              <span>{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
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
            <span className="mobile-nav-icon">
              <NavIcon label={item.label} />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
