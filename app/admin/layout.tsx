import { signOut } from "@/app/auth/actions";
import { getAdminContext } from "@/lib/auth/admin-context";
import { AdminMobileNavigation, AdminNavigation } from "./admin-navigation";
import "./hoy.css";

const navItems = [
  { href: "/admin", label: "Hoy", enabled: true },
  { href: "/admin/agenda", label: "Agenda", enabled: true },
  { href: "/admin/alumnas", label: "Alumnas", enabled: true },
  { href: "/admin/productos", label: "Productos", enabled: false },
  { href: "/admin/ventas", label: "Ventas", enabled: false },
  { href: "/admin/instructores", label: "Instructores", enabled: false },
  { href: "/admin/reportes", label: "Reportes", enabled: false },
  { href: "/admin/configuracion", label: "Configuración", enabled: false },
];

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { studio, membership } = await getAdminContext();

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
