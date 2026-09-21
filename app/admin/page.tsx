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

function parseDateKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function utcDateKey(value: Date) {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function shiftUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function weekStartMonday(value: Date) {
  const weekday = value.getUTCDay();
  return shiftUtcDays(value, weekday === 0 ? -6 : 1 - weekday);
}

function shortWeekday(value: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "short",
  })
    .format(value)
    .replace(".", "")
    .slice(0, 3);
}

function shortMonth(value: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    month: "short",
  })
    .format(value)
    .replace(".", "");
}

function selectedDayLabel(value: Date, isToday: boolean) {
  if (isToday) return "Clases de hoy";
  return `Clases del ${new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(value)}`;
}

function sessionStatusLabel(status: string) {
  if (status === "completed") return "Finalizada";
  if (status === "cancelled") return "Cancelada";
  return "Programada";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; date?: string }>;
}) {
  const { supabase, user, studio, can } = await getAdminContext();
  const params = await searchParams;
  const timeZone = studio.timezone ?? "America/Mexico_City";
  const now = new Date();
  const todayKey = localDateKey(now, timeZone);
  const selectedDate = parseDateKey(params.date) ?? parseDateKey(todayKey)!;
  const selectedKey = utcDateKey(selectedDate);
  const weekStart = weekStartMonday(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => shiftUtcDays(weekStart, index));
  const previousWeekKey = utcDateKey(shiftUtcDays(selectedDate, -7));
  const nextWeekKey = utcDateKey(shiftUtcDays(selectedDate, 7));
  const weekEnd = shiftUtcDays(weekStart, 6);

  const offsetName =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(now)
      .find((item) => item.type === "timeZoneName")?.value ?? "GMT-06:00";
  const offset = offsetName.replace("GMT", "") || "+00:00";

  const todayStart = new Date(`${todayKey}T00:00:00${offset}`);
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const selectedStart = new Date(`${selectedKey}T00:00:00${offset}`);
  const selectedEnd = new Date(selectedStart.getTime() + 86400000);

  const canWriteSchedule = can(CAPABILITIES.SCHEDULE_WRITE);
  const canWriteStudents = can(CAPABILITIES.STUDENTS_WRITE);
  const canWriteSales = can(CAPABILITIES.SALES_WRITE);

  const [
    { data: profile },
    { data: todaySessions },
    { data: selectedSessions },
    { count: activeStudents },
    { data: salesToday },
  ] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("class_sessions")
      .select("id,starts_at,capacity,status,template_id")
      .eq("studio_id", studio.id)
      .gte("starts_at", todayStart.toISOString())
      .lt("starts_at", todayEnd.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("class_sessions")
      .select("id,starts_at,capacity,status,template_id,instructor_id,space_id")
      .eq("studio_id", studio.id)
      .gte("starts_at", selectedStart.toISOString())
      .lt("starts_at", selectedEnd.toISOString())
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
      .gte("created_at", todayStart.toISOString())
      .lt("created_at", todayEnd.toISOString()),
  ]);

  const sessionIds = (selectedSessions ?? []).map((session) => session.id);
  const templateIds = [...new Set((selectedSessions ?? []).map((session) => session.template_id))];
  const instructorIds = [
    ...new Set((selectedSessions ?? []).map((session) => session.instructor_id).filter(Boolean)),
  ] as string[];
  const spaceIds = [
    ...new Set((selectedSessions ?? []).map((session) => session.space_id).filter(Boolean)),
  ] as string[];

  const [
    { data: reservations },
    { data: templates },
    { data: instructors },
    { data: spaces },
  ] = await Promise.all([
    sessionIds.length
      ? supabase
          .from("reservations")
          .select("session_id,status")
          .in("session_id", sessionIds)
          .in("status", ["reserved", "attended", "no_show"])
      : Promise.resolve({ data: [] as { session_id: string; status: string }[] }),
    templateIds.length
      ? supabase.from("class_templates").select("id,name,color_hex").in("id", templateIds)
      : Promise.resolve({
          data: [] as { id: string; name: string; color_hex: string | null }[],
        }),
    instructorIds.length
      ? supabase.from("instructors").select("id,person_id").in("id", instructorIds)
      : Promise.resolve({ data: [] as { id: string; person_id: string }[] }),
    spaceIds.length
      ? supabase.from("spaces").select("id,name").in("id", spaceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const personIds = [...new Set((instructors ?? []).map((item) => item.person_id))];
  const { data: persons } = personIds.length
    ? await supabase.from("persons").select("id,first_name,last_name").in("id", personIds)
    : {
        data: [] as { id: string; first_name: string | null; last_name: string | null }[],
      };

  const templateMap = new Map((templates ?? []).map((item) => [item.id, item]));
  const personMap = new Map(
    (persons ?? []).map((item) => [
      item.id,
      [item.first_name, item.last_name].filter(Boolean).join(" ") || "Instructor",
    ]),
  );
  const instructorMap = new Map(
    (instructors ?? []).map((item) => [item.id, personMap.get(item.person_id) ?? "Instructor"]),
  );
  const spaceMap = new Map((spaces ?? []).map((item) => [item.id, item.name]));
  const reservationsBySession = new Map<string, typeof reservations>();
  for (const reservation of reservations ?? []) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "Mike";
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

      {params.created && !["attended", "no_show"].includes(params.created) ? (
        <div className="notice success">
          {params.created === "cancel"
            ? "Reserva cancelada correctamente."
            : "Cambio guardado correctamente."}
        </div>
      ) : null}
      {params.error ? (
        <div className="notice error">
          No se pudo completar la operación: {decodeURIComponent(params.error)}
        </div>
      ) : null}

      <section className="mock-kpi-grid hoy-kpi-grid" aria-label="Resumen del estudio">
        <article className="mock-kpi-card">
          <div>
            <span>Clases hoy</span>
            <strong>{todaySessions?.length ?? 0}</strong>
            <small>
              {(todaySessions ?? []).filter((session) => session.status === "scheduled").length}{" "}
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
      </section>

      <section className="mock-overview-grid hoy-overview-grid">
        <article className="mock-overview-card">
          <div className="mock-card-heading mock-calendar-heading">
            <h2>{selectedDayLabel(selectedDate, selectedKey === todayKey)}</h2>
            <div className="mock-week-nav" aria-label="Cambiar semana">
              <Link href={`/admin?date=${previousWeekKey}`} aria-label="Semana anterior">
                ‹
              </Link>
              <span>
                {weekStart.getUTCDate()} {shortMonth(weekStart)} — {weekEnd.getUTCDate()}{" "}
                {shortMonth(weekEnd)}
              </span>
              <Link href={`/admin?date=${nextWeekKey}`} aria-label="Semana siguiente">
                ›
              </Link>
            </div>
          </div>

          <nav className="mock-week-calendar" aria-label="Calendario semanal">
            {weekDays.map((day) => {
              const key = utcDateKey(day);
              const isSelected = key === selectedKey;
              const isToday = key === todayKey;
              return (
                <Link
                  key={key}
                  href={`/admin?date=${key}`}
                  className={`mock-week-day${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
                  aria-current={isSelected ? "date" : undefined}
                >
                  <span>{shortWeekday(day)}</span>
                  <strong>{day.getUTCDate()}</strong>
                </Link>
              );
            })}
          </nav>

          <div className="mock-list">
            {(selectedSessions ?? []).map((session) => {
              const occupied = (reservationsBySession.get(session.id) ?? []).filter((reservation) =>
                occupyingReservationStatuses.has(reservation.status),
              ).length;
              const template = templateMap.get(session.template_id);
              const instructor = session.instructor_id
                ? (instructorMap.get(session.instructor_id) ?? "Instructor")
                : "Sin instructor";
              const space = session.space_id
                ? (spaceMap.get(session.space_id) ?? "Espacio")
                : "Sin espacio";
              return (
                <Link
                  className="mock-list-row hoy-class-row"
                  href={`/admin/agenda/${session.id}?from=${selectedKey}`}
                  key={session.id}
                >
                  <span className="mock-time">{formatTime(session.starts_at, timeZone)}</span>
                  <span
                    className="mock-dot"
                    aria-hidden="true"
                    style={{ background: template?.color_hex ?? "#FF0A8A" }}
                  />
                  <span className="hoy-class-main">
                    <strong>{template?.name ?? "Clase"}</strong>
                    <small>
                      {instructor} · {space}
                    </small>
                  </span>
                  <span className="hoy-class-meta">
                    <small>
                      {occupied}/{session.capacity}
                    </small>
                    <span className="hoy-class-status">{sessionStatusLabel(session.status)}</span>
                    <b aria-hidden="true">›</b>
                  </span>
                </Link>
              );
            })}
            {(selectedSessions?.length ?? 0) === 0 ? (
              <div className="mock-empty">No hay clases programadas para este día.</div>
            ) : null}
          </div>
        </article>
      </section>
    </main>
  );
}
