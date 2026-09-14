import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login/admin");

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("role, studio_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership || !["owner", "admin", "coach"].includes(membership.role)) {
    redirect("/login/admin?error=access");
  }

  const { data: studio } = await supabase
    .from("studios")
    .select("name")
    .eq("id", membership.studio_id)
    .single();

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN</p>
          <h1 className="dashboard-title">Hoy en {studio?.name ?? "tu estudio"}</h1>
        </div>
        <form action={signOut}><button className="ghost-button" type="submit">Cerrar sesión</button></form>
      </header>

      <section className="stat-grid">
        <article className="stat-card"><span>Clases hoy</span><strong>0</strong><small>Agenda lista para conectar</small></article>
        <article className="stat-card"><span>Reservas hoy</span><strong>0</strong><small>Sin registros todavía</small></article>
        <article className="stat-card"><span>Alumnas activas</span><strong>0</strong><small>Se llenará con membresías</small></article>
        <article className="stat-card"><span>Ocupación</span><strong>—</strong><small>Disponible al cargar clases</small></article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">AGENDA</p><h2>Próximas clases</h2></div><button className="secondary-button" disabled>Nueva clase</button></div>
          <div className="empty-state">Todavía no hay clases programadas. La siguiente fase conectará agenda, capacidad y reservaciones.</div>
        </article>
        <article className="panel">
          <p className="eyebrow">ACCESO</p>
          <h2>Rol actual</h2>
          <div className="role-pill">{membership.role}</div>
          <p>La sesión ya está protegida por Supabase Auth y las reglas RLS de Studio Flow.</p>
        </article>
      </section>
    </main>
  );
}
