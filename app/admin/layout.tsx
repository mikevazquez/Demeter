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
  const { studio, membership, can } = await getAdminContext();
  const instructorOnly = can(CAPABILITIES.INSTRUCTOR_PORTAL) && !can(CAPABILITIES.ADMIN_PORTAL);

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
          ? [{ href: "/admin/acciones", label: "Atención", enabled: true, secondary: true }]
          : []),
      ];

  const hasMoreDestinations =
    can(CAPABILITIES.PRODUCTS_READ) ||
    can(CAPABILITIES.INSTRUCTORS_READ) ||
    can(CAPABILITIES.AUTOMATIONS_READ) ||
    can(CAPABILITIES.REQUIRED_ACTIONS_READ);

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
                ],
              },
            ]
          : []),
      ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Navegación principal">
        <div className="brand-lockup">
          <span className="brand-mark">SF</span>
          <div>
            <strong>Studio Flow</strong>
            <small>{studio.name}</small>
          </div>
        </div>

        <AdminNavigation items={desktopNavItems} />

        <div className="sidebar-footer">
          <span className="sidebar-caption">{roleLabels[membership.role] ?? "Equipo"}</span>
          <form action={signOut}>
            <button type="submit" className="sidebar-signout">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-content">{children}</div>

      <AdminMobileNavigation items={mobileNavItems} />
    </div>
  );
}
