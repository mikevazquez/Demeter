import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

export default async function StudentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login/student");

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("role, studio_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership || membership.role !== "student") {
    redirect("/login/student?error=access");
  }

  const { data: studio } = await supabase
    .from("studios")
    .select("name")
    .eq("id", membership.studio_id)
    .single();

  const { data: activePackage } = await supabase
    .from("student_packages")
    .select("credits_remaining, credits_total, expires_on, package_id")
    .eq("student_user_id", user.id)
    .gte("expires_on", new Date().toISOString().slice(0, 10))
    .order("expires_on", { ascending: true })
    .limit(1)
    .maybeSingle();

  let packageName: string | null = null;

  if (activePackage?.package_id) {
    const { data: packageRecord } = await supabase
      .from("packages")
      .select("name")
      .eq("id", activePackage.package_id)
      .maybeSingle();

    packageName = packageRecord?.name ?? null;
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PORTAL DE ALUMNA</p>
          <h1 className="dashboard-title">Hola</h1>
          <p>{studio?.name ?? "Tu estudio"}</p>
        </div>
        <form action={signOut}><button className="ghost-button" type="submit">Cerrar sesión</button></form>
      </header>

      <section className="student-hero">
        <div>
          <p className="eyebrow">TU PAQUETE ACTIVO</p>
          <h2>{packageName ?? "Sin paquete activo"}</h2>
          <p>{activePackage ? `Vence el ${activePackage.expires_on}` : "Cuando tengas un paquete activo aparecerá aquí."}</p>
        </div>
        <div className="credits-block">
          <strong>{activePackage?.credits_remaining ?? 0}</strong>
          <span>clases disponibles</span>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">PRÓXIMAS CLASES</p><h2>Tu agenda</h2></div><button className="secondary-button" disabled>Reservar</button></div>
          <div className="empty-state">No tienes clases reservadas todavía.</div>
        </article>
        <article className="panel">
          <p className="eyebrow">TU ACTIVIDAD</p>
          <h2>Estadísticas</h2>
          <div className="mini-stats"><div><strong>0</strong><span>racha</span></div><div><strong>—</strong><span>clase favorita</span></div></div>
        </article>
      </section>
    </main>
  );
}
