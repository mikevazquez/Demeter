import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(value);
}

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

  if (!membership || !["owner", "admin", "coach"].includes(membership.role)) {
    redirect("/login/admin?error=access");
  }

  const [{ data: studio }, { data: profile }] = await Promise.all([
    supabase
      .from("studios")
      .select("name, timezone")
      .eq("id", membership.studio_id)
      .single(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const timeZone = studio?.timezone ?? "America/Mexico_City";
  const now = new Date();
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    todayParts.find((item) => item.type === type)?.value ?? "";
  const todayLocal = `${part("year")}-${part("month")}-${part("day")}`;
  const offsetName =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(now)
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
  const { data: reservations } = sessionIds.length
    ? await supabase
        .from("reservations")
        .select("session_id")
        .in("session_id", sessionIds)
        .eq("status", "booked")
    : { data: [] as { session_id: string }[] };

  const reservationsBySession = new Map<string, number>();
  for (const reservation of reservations ?? []) {
    reservationsBySession.set(
      reservation.session_id,
      (reservationsBySession.get(reservation.session_id) ?? 0) + 1,
    );
  }
  const reservationsCount = reservations?.length ?? 0;

  const templateIds = [
    ...new Set((sessions ?? []).map((session) => session.template_id)),
  ];
  const { data: templates } = templateIds.length
    ? await supabase.from("class_templates").select("id, name").in("id", templateIds)
    : { data: [] as { id: string; name: string }[] };
  const templateMap = new Map((templates ?? []).map((item) => [item.id, item.name]));

  const totalCapacity = (sessions ?? []).reduce(
    (sum, session) => sum + session.capacity,
    0,
  );
  const occupancy =
    totalCapacity > 0 ? Math.round((reservationsCount / totalCapacity) * 100) : null;
  const nextSession = (sessions ?? []).find(
    (session) => new Date(session.ends_at).getTime() >= now.getTime(),
  );
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "Mike";

  return (
    <main className="dashboard-shell hoy-dashboard">
      <header className="hoy-header">
        <div>
          <p className="eyebrow">HOY · {studio?.name ?? "ESTUDIO"}</p>
          <h1 className="dashboard-title">¡Hola, {firstName}!</h1>
          <p className="hoy-date">{formatDay(now, timeZone)}</p>
        </div>
        <span className="role-pill">{membership.role}</span>
      </header>

      <section className="stat-grid" aria-label="Indicadores operativos del día">
        <article className="stat-card">
          <span>Clases hoy</span>
          <strong>{sessions?.length ?? 0}</strong>
          <small>Sesiones programadas</small>
        </article>
        <article className="stat-card">
          <span>Reservas hoy</span>
          <strong>{reservationsCount}</strong>
          <small>Lugares confirmados</small>
        </article>
        <article className="stat-card">
          <span>Alumnas activas</span>
          <strong>{activeStudents ?? 0}</strong>
          <small>Expedientes activos</small>
        </article>
        <article className="stat-card">
          <span>Ocupación del día</span>
          <strong>{occupancy === null ? "—" : `${occupancy}%`}</strong>
          <small>
            {totalCapacity
              ? `${reservationsCount} de ${totalCapacity} lugares`
              : "Sin cupo programado"}
          </small>
        </article>
      </section>

      <section className="hoy-primary-grid">
        <article className="panel next-class-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PRÓXIMA CLASE</p>
              <h2>
                {nextSession
                  ? (templateMap.get(nextSession.template_id) ?? "Clase")
                  : "Sin próxima clase"}
              </h2>
            </div>
            {nextSession ? (
              <span className="status-pill">{nextSession.status}</span>
            ) : null}
          </div>

          {nextSession ? (
            <>
              <div className="next-class-time">
                <strong>{formatTime(nextSession.starts_at, timeZone)}</strong>
                <span>— {formatTime(nextSession.ends_at, timeZone)}</span>
              </div>
              <div className="next-class-capacity">
                <div>
                  <strong>{reservationsBySession.get(nextSession.id) ?? 0}</strong>
                  <span>reservadas</span>
                </div>
                <div>
                  <strong>{nextSession.capacity}</strong>
                  <span>capacidad</span>
                </div>
              </div>
              <Link
                className="primary-button next-class-action"
                href={`/admin/agenda/${nextSession.id}`}
              >
                Abrir clase
              </Link>
            </>
          ) : (
            <div className="empty-state compact-empty">
              No quedan clases programadas para hoy.
            </div>
          )}
        </article>

        <article className="panel hoy-quick-card">
          <p className="eyebrow">OPERACIÓN</p>
          <h2>Acciones rápidas</h2>
          <div className="quick-action-list">
            <Link href="/admin/agenda">
              <span>Agenda</span>
              <strong>Ver y programar clases →</strong>
            </Link>
            <Link href="/admin/alumnas">
              <span>Alumnas</span>
              <strong>Buscar o dar de alta →</strong>
            </Link>
          </div>
        </article>
      </section>

      <section className="panel hoy-schedule-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AGENDA DEL DÍA</p>
            <h2>Clases de hoy</h2>
          </div>
          <Link className="secondary-button" href="/admin/agenda">
            Ver agenda
          </Link>
        </div>

        {(sessions?.length ?? 0) === 0 ? (
          <div className="empty-state">Todavía no hay clases programadas para hoy.</div>
        ) : (
          <div className="session-list">
            {sessions?.map((session) => {
              const booked = reservationsBySession.get(session.id) ?? 0;
              return (
                <Link
                  className="session-row session-link"
                  href={`/admin/agenda/${session.id}`}
                  key={session.id}
                >
                  <div className="session-time">
                    <strong>{formatTime(session.starts_at, timeZone)}</strong>
                    <span>hasta {formatTime(session.ends_at, timeZone)}</span>
                  </div>
                  <div className="session-copy">
                    <strong>{templateMap.get(session.template_id) ?? "Clase"}</strong>
                    <span>
                      {booked} reservadas · {session.capacity} lugares
                    </span>
                  </div>
                  <div className="session-meta">
                    <span className="status-pill">{session.status}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
