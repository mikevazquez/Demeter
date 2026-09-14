import Link from "next/link";
import { signOut } from "@/app/auth/actions";
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

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Navegación principal">
        <div className="brand-lockup">
          <span className="brand-mark">SF</span>
          <div>
            <strong>Studio Flow</strong>
            <small>Demeter Fitness</small>
          </div>
        </div>

        <nav className="admin-nav">
          {navItems.map((item) =>
            item.enabled ? (
              <Link key={item.label} href={item.href} className="admin-nav-item">
                <span className="nav-dot" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            ) : (
              <span key={item.label} className="admin-nav-item is-disabled" aria-disabled="true">
                <span className="nav-dot" aria-hidden="true" />
                <span>{item.label}</span>
                <small>Próximamente</small>
              </span>
            ),
          )}
        </nav>

        <div className="sidebar-footer">
          <span className="sidebar-caption">Administración</span>
          <form action={signOut}>
            <button type="submit" className="sidebar-signout">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-content">{children}</div>

      <nav className="admin-mobile-nav" aria-label="Navegación móvil">
        <Link href="/admin">Hoy</Link>
        <Link href="/admin/agenda">Agenda</Link>
        <Link href="/admin/alumnas">Alumnas</Link>
      </nav>
    </div>
  );
}
