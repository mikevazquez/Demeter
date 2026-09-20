import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { AdminMobileNavigation, AdminNavigation } from "./admin-navigation";
import "./hoy.css";
import "./roster-uat.css";
import "./mobile-nav-overrides.css";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Administración",
  reception: "Recepción",
  instructor: "Coach",
};

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { supabase, studio, membership, can, user } = await getAdminContext();
  const instructorOnly = can(CAPABILITIES.INSTRUCTOR_PORTAL) && !can(CAPABILITIES.ADMIN_PORTAL);
  const brandLogoUrl = studio.logo_path
    ? supabase.storage.from("studio-branding").getPublicUrl(studio.logo_path).data.publicUrl
    : null;

  const [{ data: profile }, attentionResult] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    can(CAPABILITIES.REQUIRED_ACTIONS_READ)
      ? supabase
          .from("required_actions")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studio.id)
          .in("status", ["pending", "in_progress"])
      : Promise.resolve({ count: 0 }),
  ]);
  const userName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Usuario";
  const userInitials = userName
    .split(/\s+/)
    .slice(0, 2)
    .map((part: string) => part.slice(0, 1).toUpperCase())
    .join("");
  const attentionCount = attentionResult.count ?? 0;

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
          ? [{ href: "/admin/agenda", label: "Agenda", enabled: true }]
          : []),
        ...(can(CAPABILITIES.STUDENTS_READ)
          ? [{ href: "/admin/alumnas", label: "Alumnas", enabled: true }]
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
        ...(can(CAPABILITIES.REQUIRED_ACTIONS_READ)
          ? [
              {
                href: "/admin/acciones",
                label: "Atención",
                enabled: true,
                secondary: true,
                badge: attentionCount,
              },
            ]
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
    can(CAPABILITIES.PRODUCTS_READ) ||
    can(CAPABILITIES.INSTRUCTORS_READ) ||
    can(CAPABILITIES.AUTOMATIONS_READ) ||
    can(CAPABILITIES.REQUIRED_ACTIONS_READ) ||
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
                  "/admin/productos",
                  "/admin/instructores",
                  "/admin/automatizaciones",
                  "/admin/acciones",
                  "/admin/configuracion",
                ],
              },
            ]
          : []),
      ];

  return (
    <div className="admin-shell">
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
                {can(CAPABILITIES.REQUIRED_ACTIONS_READ) ? (
                  <Link className="admin-icon-button" href="/admin/acciones" aria-label="Atención">
                    <span aria-hidden="true">♧</span>
                    {attentionCount ? <b>{attentionCount}</b> : null}
                  </Link>
                ) : null}
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
              {can(CAPABILITIES.REQUIRED_ACTIONS_READ) ? (
                <Link className="admin-icon-button" href="/admin/acciones" aria-label="Atención">
                  <span aria-hidden="true">♧</span>
                  {attentionCount ? <b>{attentionCount}</b> : null}
                </Link>
              ) : null}
            </header>
          </>
        ) : null}
        {children}
      </div>

      <AdminMobileNavigation items={mobileNavItems} />
    </div>
  );
}
