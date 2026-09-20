import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

const occupyingReservationStatuses = new Set(["reserved", "attended"]);

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function localDateKey(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const { supabase, user, studio, can } = await getAdminContext();
  const params = await searchParams;
  const timeZone = studio.timezone ?? "America/Mexico_City";
  const now = new Date();
  const todayKey = localDateKey(now, timeZone);
  const offsetName =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(now)
      .find((item) => item.type === "timeZoneName")?.value ?? "GMT-06:00";
  const offset = offsetName.replace("GMT", "") || "+00:00";
  const start = new Date(`${todayKey}T00:00:00${offset}`);
  const end = new Date(start.getTime() + 86400000);

  const canReadSchedule = can(CAPABILITIES.SCHEDULE_READ);
  const canWriteSchedule = can(CAPABILITIES.SCHEDULE_WRITE);
  const canWriteStudents = can(CAPABILITIES.STUDENTS_WRITE);
  const canReadRequiredActions = can(CAPABILITIES.REQUIRED_ACTIONS_READ);
  const canWriteSales = can(CAPABILITIES.SALES_WRITE);

  const [
    { data: profile },
    { data: sessions },
    { count: activeStudents },
    { data: salesToday },
    requiredActionsResult,
  ] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("class_sessions")
      .select("id, starts_at, capacity, status, template_id")
      .eq("studio_id", studio.id)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("active", true),
    supabase
      .from("sales")
      .select("total_minor,status")
      .eq("studio_id", studio.id)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
    canReadRequiredActions
      ? supabase
          .from("required_actions")
          .select("id,priority,status,reason,created_at", { count: "exact" })
          .eq("studio_id", studio.id)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], count: 0 }),
  ]);

  const sessionIds = (sessions ?? []).map((session) => session.id);
  const [{ data: reservations }, { data: templates }] = await Promise.all([
    sessionIds.length
      ? supabase
          .from("reservations")
          .select("session_id,status")
          .in("session_id", sessionIds)
          .in("status", ["reserved", "attended", "no_show"])
      : Promise.resolve({ data: [] as { session_id: string; status: string }[] }),
    sessions?.length
      ? supabase
          .from("class_templates")
          .select("id,name")
          .in(
            "id",
            [...new Set(sessions.map((session) => session.template_id))],
          )
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const templateMap = new Map((templates ?? []).map((item) => [item.id, item.name]));
  const reservationsBySession = new Map<string, typeof reservations>();
  for (const reservation of reservations ?? []) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "Mike";
  const requiredActions = requiredActionsResult.data ?? [];
  const visibleSales = (salesToday ?? []).filter((sale) => sale.status !== "voided");
  const salesTotalMinor = visibleSales.reduce((sum, sale) => sum + (sale.total_minor ?? 0), 0);
  const salesTotal = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: studio.currency ?? "MXN",
    maximumFractionDigits: 0,
  }).format(salesTotalMinor / 100);

  return (
    <main className="dashboard-shell hoy-dashboard">
      <header className="hoy-overview-header">
        <div>
          <h1>Hola, {firstName}</h1>
          <p>Aquí tienes un resumen de hoy.</p>
        </div>
        <details className="admin-quick-menu">
          <summary>
            <span aria-hidden="true">＋</span>
            Acción rápida
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="admin-quick-popover">
            {canWriteStudents ? <Link href="/admin/alumnas#alta-rapida">Nueva alumna</Link> : null}
            {canWriteSales ? <Link href="/admin/ventas/nueva">Registrar venta</Link> : null}
            {canWriteSchedule ? (
              <Link href="/admin/agenda#clases-programadas">Crear reserva</Link>
            ) : null}
            {canWriteSchedule ? (
              <Link href="/admin/agenda#programar-clase">Crear clase</Link>
            ) : null}
          </div>
        </details>
      </header>

      {params.created ? (
        <div className="notice success">
          {params.created === "cancel"
            ? "Reserva cancelada correctamente."
            : "Reserva creada correctamente."}
        </div>
      ) : null}
      {params.error ? (
        <div className="notice error">
          No se pudo completar la operación: {decodeURIComponent(params.error)}
        </div>
      ) : null}

      <section className="mock-kpi-grid" aria-label="Resumen del estudio">
        <article className="mock-kpi-card">
          <div>
            <span>Clases hoy</span>
            <strong>{sessions?.length ?? 0}</strong>
            <small>
              {(sessions ?? []).filter((session) => session.status === "scheduled").length}{" "}
              programadas
            </small>
          </div>
          <b aria-hidden="true">▣</b>
        </article>
        <article className="mock-kpi-card">
          <div>
            <span>Alumnas activas</span>
            <strong>{activeStudents ?? 0}</strong>
            <small>Expedientes activos</small>
          </div>
          <b aria-hidden="true">◎</b>
        </article>
        <article className="mock-kpi-card">
          <div>
            <span>Ventas hoy</span>
            <strong>{salesTotal}</strong>
            <small>{visibleSales.length} ventas</small>
          </div>
          <b aria-hidden="true">▤</b>
        </article>
        <article className="mock-kpi-card">
          <div>
            <span>Incidencias</span>
            <strong>{requiredActionsResult.count ?? 0}</strong>
            <small>
              {requiredActions.filter((action) => action.priority === "high").length} urgentes
            </small>
          </div>
          <b aria-hidden="true">△</b>
        </article>
      </section>

      <section className="mock-overview-grid">
        <article className="mock-overview-card">
          <div className="mock-card-heading">
            <h2>Clases de hoy</h2>
            {canReadSchedule ? <Link href="/admin/agenda">Ver agenda →</Link> : null}
          </div>
          <div className="mock-list">
            {(sessions ?? []).slice(0, 5).map((session) => {
              const occupied = (reservationsBySession.get(session.id) ?? []).filter((reservation) =>
                occupyingReservationStatuses.has(reservation.status),
              ).length;
              return (
                <div className="mock-list-row" key={session.id}>
                  <span className="mock-time">{formatTime(session.starts_at, timeZone)}</span>
                  <span className="mock-dot" aria-hidden="true" />
                  <strong>{templateMap.get(session.template_id) ?? "Clase"}</strong>
                  <small>
                    {occupied}/{session.capacity}
                  </small>
                </div>
              );
            })}
            {(sessions?.length ?? 0) === 0 ? (
              <div className="mock-empty">No hay clases programadas hoy.</div>
            ) : null}
          </div>
        </article>

        {canReadRequiredActions ? (
          <article className="mock-overview-card">
            <div className="mock-card-heading">
              <h2>
                Atención <span>(pendientes)</span>
              </h2>
              <Link href="/admin/acciones">Ver todas →</Link>
            </div>
            <div className="mock-list">
              {requiredActions.slice(0, 5).map((action) => (
                <Link
                  className="mock-list-row attention-row"
                  href={`/admin/acciones/${action.id}`}
                  key={action.id}
                >
                  <span className={`mock-priority-dot is-${action.priority}`} aria-hidden="true" />
                  <strong>{action.reason}</strong>
                  <small>
                    {action.priority === "high"
                      ? "Urgente"
                      : action.status === "in_progress"
                        ? "En proceso"
                        : "Pendiente"}
                  </small>
                </Link>
              ))}
              {requiredActions.length === 0 ? (
                <div className="mock-empty">No hay incidencias abiertas.</div>
              ) : null}
            </div>
          </article>
        ) : null}
      </section>
    </main>
  );
}
