import type { Metadata } from "next";
import { cache } from "react";

import { signOut } from "@/app/auth/actions";
import PwaBrandingSync from "@/app/components/PwaBrandingSync";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { AdminMobileNavigation, AdminNavigation } from "./admin-navigation";
import "./hoy.css";
import "./roster-uat.css";
import "./mobile-nav-overrides.css";
import "./alumnas/profile-360.css";
import "./alumnas/admin-ux-04.css";
import "./alumnas/profile-360-admin-ux-04.css";
import "./agenda/agenda-calendar.css";
import "./agenda/session-detail-admin-ux-04.css";
import "./actividades/actividades.css";
import "./admin-ux-04-secondary.css";
import "./admin-ux-04-secondary-detail.css";
import "./evaluaciones/evaluaciones.css";

type PwaBrand = {
  name: string;
  slug: string;
  primary_color: string;
  logo_path: string | null;
};

function pwaBrandQuery(brand: PwaBrand) {
  return new URLSearchParams({
    name: brand.name,
    slug: brand.slug,
    primary: brand.primary_color,
    logo: brand.logo_path ?? "",
    v: "4",
  }).toString();
}

const getCachedAdminContext = cache(async () => getAdminContext());

export async function generateMetadata(): Promise<Metadata> {
  const { studio } = await getCachedAdminContext();
  const query = pwaBrandQuery(studio);

  return {
    applicationName: studio.name,
    title: studio.name,
    manifest: "/pwa/manifest?" + query,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: studio.name,
    },
    icons: {
      icon: [
        {
          url: "/pwa/studio-icon/192?" + query,
          sizes: "192x192",
          type: "image/png",
        },
        {
          url: "/pwa/studio-icon/512?" + query,
          sizes: "512x512",
          type: "image/png",
        },
      ],
      apple: [
        {
          url: "/pwa/studio-icon/180?" + query,
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
  };
}

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Administración",
  reception: "Recepción",
  instructor: "Coach",
};

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { supabase, studio, membership, can, user } = await getCachedAdminContext();
  const pwaQuery = pwaBrandQuery(studio);
  const instructorOnly = can(CAPABILITIES.INSTRUCTOR_PORTAL) && !can(CAPABILITIES.ADMIN_PORTAL);
  const brandLogoUrl = studio.logo_path
    ? supabase.storage.from("studio-branding").getPublicUrl(studio.logo_path).data.publicUrl
    : null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const userName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Usuario";
  const userInitials = userName
    .split(/\s+/)
    .slice(0, 2)
    .map((part: string) => part.slice(0, 1).toUpperCase())
    .join("");

  const desktopNavItems = instructorOnly
    ? [
        {
          href: "/admin/mis-clases",
          label: "Mis clases",
          enabled: true,
          activeFor: ["/coach"],
        },
      ]
    : [
        { href: "/admin", label: "Hoy", enabled: true },
        ...(can(CAPABILITIES.SCHEDULE_READ)
          ? [
              { href: "/admin/agenda", label: "Agenda", enabled: true },
              { href: "/admin/actividades", label: "Actividades", enabled: true },
            ]
          : []),
        ...(can(CAPABILITIES.STUDENTS_READ)
          ? [{ href: "/admin/alumnas", label: "Alumnas", enabled: true }]
          : []),
        ...(can(CAPABILITIES.DOCUMENTS_READ)
          ? [{ href: "/admin/documentos", label: "Documentos", enabled: true }]
          : []),
        ...(can(CAPABILITIES.REWARDS_READ)
          ? [{ href: "/admin/recompensas", label: "Progreso", enabled: true }]
          : []),
        ...(can(CAPABILITIES.EVALUATIONS_READ)
          ? [{ href: "/admin/evaluaciones", label: "Evaluaciones", enabled: true }]
          : []),
        ...(can(CAPABILITIES.PRODUCTS_READ)
          ? [{ href: "/admin/productos", label: "Productos", enabled: true }]
          : []),
        ...(can(CAPABILITIES.INSTRUCTORS_READ)
          ? [{ href: "/admin/instructores", label: "Equipo", enabled: true }]
          : []),
        ...(can(CAPABILITIES.AUTOMATIONS_READ)
          ? [{ href: "/admin/automatizaciones", label: "Automatizaciones", enabled: true }]
          : []),
        ...(membership.role === "owner"
          ? [
              {
                href: "/admin/configuracion",
                label: "Configuración",
                enabled: true,
                secondary: true,
              },
            ]
          : []),
      ];

  const hasMoreDestinations =
    can(CAPABILITIES.SCHEDULE_READ) ||
    can(CAPABILITIES.DOCUMENTS_READ) ||
    can(CAPABILITIES.REWARDS_READ) ||
    can(CAPABILITIES.EVALUATIONS_READ) ||
    can(CAPABILITIES.PRODUCTS_READ) ||
    can(CAPABILITIES.INSTRUCTORS_READ) ||
    can(CAPABILITIES.AUTOMATIONS_READ) ||
    membership.role === "owner";

  const mobileNavItems = instructorOnly
    ? desktopNavItems
    : [
        { href: "/admin", label: "Hoy", enabled: true },
        ...(can(CAPABILITIES.SCHEDULE_READ)
          ? [{ href: "/admin/agenda", label: "Agenda", enabled: true }]
          : []),
        ...(can(CAPABILITIES.STUDENTS_READ)
          ? [{ href: "/admin/alumnas", label: "Alumnas", enabled: true }]
          : []),
        ...(hasMoreDestinations
          ? [
              {
                href: "/admin/mas",
                label: "Más",
                enabled: true,
                activeFor: [
                  "/admin/actividades",
                  "/admin/documentos",
                  "/admin/recompensas",
                  "/admin/evaluaciones",
                  "/admin/productos",
                  "/admin/instructores",
                  "/admin/automatizaciones",
                  "/admin/configuracion",
                ],
              },
            ]
          : []),
      ];

  return (
    <div className="admin-shell">
      <PwaBrandingSync
        name={studio.name}
        manifestHref={"/pwa/manifest?" + pwaQuery}
        appleTouchIconHref={"/pwa/studio-icon/180?" + pwaQuery}
      />
      <aside className="admin-sidebar" aria-label="Navegación principal">
        <div className="brand-lockup">
          {brandLogoUrl ? (
            <span
              className="brand-mark brand-mark-logo"
              role="img"
              aria-label={`Logo de ${studio.name}`}
              style={{ backgroundImage: `url("${brandLogoUrl}")` }}
            />
          ) : (
            <span className="brand-mark">{studio.name.slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <strong>{studio.name}</strong>
            <small>Panel del estudio</small>
          </div>
        </div>

        <AdminNavigation items={desktopNavItems} />

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-avatar">{userInitials || "U"}</span>
            <span className="sidebar-user-copy">
              <strong>{userName}</strong>
              <small>{roleLabels[membership.role] ?? "Equipo"}</small>
            </span>
          </div>
          <form action={signOut}>
            <button type="submit" className="sidebar-signout">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-content">
        {!instructorOnly ? (
          <>
            <header className="admin-utility-bar">
              <form action="/admin/alumnas" method="get" className="admin-global-search">
                <span aria-hidden="true">⌕</span>
                <input
                  name="q"
                  type="search"
                  placeholder="Buscar alumna…"
                  aria-label="Buscar alumna"
                />
                <kbd>⌘K</kbd>
              </form>
              <div className="admin-utility-actions">
                <span className="admin-user-button" aria-label={userName}>
                  {userInitials || "U"}
                </span>
              </div>
            </header>
            <header className="admin-mobile-header">
              <div className="admin-mobile-brand">
                {brandLogoUrl ? (
                  <span
                    className="brand-mark brand-mark-logo"
                    role="img"
                    aria-label={`Logo de ${studio.name}`}
                    style={{ backgroundImage: `url("${brandLogoUrl}")` }}
                  />
                ) : (
                  <span className="brand-mark">{studio.name.slice(0, 1).toUpperCase()}</span>
                )}
                <strong>{studio.name}</strong>
              </div>
            </header>
          </>
        ) : null}
        {children}
      </div>

      <AdminMobileNavigation items={mobileNavItems} />
    </div>
  );
}
