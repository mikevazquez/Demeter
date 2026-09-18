import { signOut } from "@/app/auth/actions";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { AdminMobileNavigation, AdminNavigation } from "./admin-navigation";
import "./hoy.css";
import "./roster-uat.css";
import "./mobile-nav-overrides.css";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { studio, membership, can } = await getAdminContext();

  const navItems = [
    { href: "/admin", label: "Hoy", enabled: true },
    ...(can(CAPABILITIES.REQUIRED_ACTIONS_READ)
      ? [{ href: "/admin/acciones", label: "Acciones", enabled: true }]
      : []),
    { href: "/admin/alumnas", label: "Alumnas", enabled: true },
    {
      href: "/admin/empresa",
      label: "Empresa",
      enabled: true,
      activeFor: [
        "/admin/agenda",
        "/admin/productos",
        "/admin/ventas",
        "/admin/instructores",
        "/admin/reportes",
        "/admin/configuracion",
      ],
    },
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
          <span className="sidebar-caption">{membership.role}</span>
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
