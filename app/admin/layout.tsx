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
  const instructorOnly =
    can(CAPABILITIES.INSTRUCTOR_PORTAL) && !can(CAPABILITIES.ADMIN_PORTAL);

  const navItems = instructorOnly
    ? [
        { href: "/admin/mis-clases", label: "Mis clases", enabled: true },
        ...(can(CAPABILITIES.SCHEDULE_READ)
          ? [{ href: "/admin/agenda", label: "Agenda", enabled: true }]
          : []),
      ]
    : [
        { href: "/admin", label: "Hoy", enabled: true },
        ...(can(CAPABILITIES.REQUIRED_ACTIONS_READ)
          ? [{ href: "/admin/acciones", label: "Acciones", enabled: true }]
          : []),
        ...(can(CAPABILITIES.SCHEDULE_READ)
          ? [{ href: "/admin/agenda", label: "Agenda", enabled: true }]
          : []),
        ...(can(CAPABILITIES.STUDENTS_READ)
          ? [{ href: "/admin/alumnas", label: "Alumnas", enabled: true }]
          : []),
        ...(can(CAPABILITIES.ADMIN_PORTAL)
          ? [
              {
                href: "/admin/empresa",
                label: "Empresa",
                enabled: true,
                activeFor: [
                  "/admin/productos",
                  "/admin/ventas",
                  "/admin/instructores",
                  "/admin/automatizaciones",
                  "/admin/reportes",
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
          <span className="brand-mark">SF</span>
          <div>
            <strong>Studio Flow</strong>
            <small>{studio.name}</small>
          </div>
        </div>

        <AdminNavigation items={navItems} />

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

      <AdminMobileNavigation items={navItems} />
    </div>
  );
}
