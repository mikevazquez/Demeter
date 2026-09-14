import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login/admin");

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("role, studio_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership || !["owner", "admin", "coach"].includes(membership.role))
    redirect("/login/admin?error=access");

  const { data: studio } = await supabase
    .from("studios")
    .select("name, timezone")
    .eq("id", membership.studio_id)
    .single();
  const timeZone = studio?.timezone ?? "America/Mexico_City";

  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => todayParts.find((item) => item.type === type)?.value ?? "";
  const todayLocal = `${part("year")}-${part("month")}-${part("day")}`;
  const offsetName =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit" })
      .formatToParts(new Date())
      .find((item) => item.type === "timeZoneName")?.value ?? "GMT-06:00";
  const offset = offsetName.replace("GMT", "") || "+00:00";
  const start = new Date(`${todayLocal}T00:00:00${offset}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const [{ data: sessions }, { count: activeStudents }] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("id, starts_at, ends_at, capacity, status, template_id")
      .eq("studio_id", membership.studio_id)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("studio_id", membership.studio_id)
      .eq("active", true),
  ]);

  const sessionIds = (sessions ?? []).map((session) => session.id);
  const { count: reservationsCount } = sessionIds.length
    ? await supabase
        .from("reservations")
        .select("*", { count: "exact", head: true })
        .in("session_id", sessionIds)
        .eq("status", "booked")
    : { count: 0 };

  const templateIds = [...new Set((sessions ?? []).map((session) => session.template_id))];
  const { data: templates } = templateIds.length
    ? await supabase.from("class_templates").select("id, name").in("id", templateIds)
    : { data: [] as { id: string; name: string }[] };
  const templateMap = new Map((templates ?? []).map((item) => [item.id, item.name]));

  const totalCapacity = (sessions ?? []).reduce((sum, session) => sum + session.capacity, 0);
  const occupancy =
    totalCapacity > 0 ? Math.round(((reservationsCount ?? 0) / totalCapacity) * 100) : null;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN</p>
          <h1 className="dashboard-title">Hoy en {studio?.name ?? "tu estudio"}</h1>
        </div>
        <div className="toolbar-actions">
          <Link className="secondary-button" href="/admin/alumnas">
            Alumnas
          </Link>
          <Link className="secondary-button" href="/admin/agenda">
            Agenda
          </Link>
          <form action={signOut}>
            <button className="ghost-button" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <section className="stat-grid">
        <article className="stat-card">
          <span>Clases hoy</span>
          <strong>{sessions?.length ?? 0}</strong>
          <small>Sesiones programadas</small>
        </article>
        <article className="stat-card">
          <span>Reservas hoy</span>
          <strong>{reservationsCount ?? 0}</strong>
          <small>En clases de hoy</small>
        </article>
        <article className="stat-card">
          <span>Alumnas activas</span>
          <strong>{activeStudents ?? 0}</strong>
          <small>Expedientes activos</small>
        </article>
        <article className="stat-card">
          <span>Ocupación</span>
          <strong>{occupancy === null ? "—" : `${occupancy}%`}</strong>
          <small>Sobre capacidad del día</small>
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AGENDA</p>
              <h2>Clases de hoy</h2>
            </div>
            <Link className="secondary-button" href="/admin/agenda">
              Administrar
            </Link>
          </div>
          {(sessions?.length ?? 0) === 0 ? (
            <div className="empty-state">Todavía no hay clases programadas para hoy.</div>
          ) : (
            <div className="session-list">
              {sessions?.map((session) => (
                <Link
                  className="session-row session-link"
                  href={`/admin/agenda/${session.id}`}
                  key={session.id}
                >
                  <div className="session-time">
                    <strong>
                      {new Intl.DateTimeFormat("es-MX", {
                        timeZone,
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(session.starts_at))}
                    </strong>
                    <span>
                      hasta{" "}
                      {new Intl.DateTimeFormat("es-MX", {
                        timeZone,
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(session.ends_at))}
                    </span>
                  </div>
                  <div className="session-copy">
                    <strong>{templateMap.get(session.template_id) ?? "Clase"}</strong>
                    <span>{session.capacity} lugares</span>
                  </div>
                  <div className="session-meta">
                    <span className="status-pill">{session.status}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
        <article className="panel">
          <p className="eyebrow">ACCESO</p>
          <h2>Rol actual</h2>
          <div className="role-pill">{membership.role}</div>
          <p>La sesión está protegida por Supabase Auth y las reglas RLS de Studio Flow.</p>
        </article>
      </section>
    </main>
  );
}
