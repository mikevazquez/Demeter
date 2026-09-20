import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { SessionOperations } from "./hoy/SessionOperations";
import RequiredActionContextPanel from "./acciones/RequiredActionContextPanel";

type EligibilityResult = {
  eligible?: boolean;
  reason_code?: string | null;
  available_credits?: number | null;
  unlimited?: boolean;
};

const eligibilityCopy: Record<string, string> = {
  student_not_operable: "perfil no habilitado",
  session_not_bookable: "clase no disponible",
  already_reserved: "ya reservada",
  session_full: "clase llena",
  no_active_product: "sin paquete activo",
  outside_product: "fuera de paquete",
  no_credits: "sin créditos",
};

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

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function formatDay(value: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(value);
}

function weekDay(value: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "short",
  })
    .format(value)
    .replace(".", "");
}

function formatExpiry(value: string | null) {
  if (!value) return "Sin vencimiento";
  return `Vence ${new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`))}`;
}

function CalendarIcon() {
  return (
    <span className="quick-icon" aria-hidden="true">
      ⌑
    </span>
  );
}

function StudentsIcon() {
  return (
    <span className="quick-icon" aria-hidden="true">
      ◎
    </span>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string; created?: string }>;
}) {
  const { supabase, user, studio, can } = await getAdminContext();
  const params = await searchParams;
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const timeZone = studio.timezone ?? "America/Mexico_City";
  const now = new Date();
  const todayKey = localDateKey(now, timeZone);
  const selectedDate = parseDateKey(params.date ?? "") ?? parseDateKey(todayKey)!;
  const selectedKey = dateKey(selectedDate);
  const dayOfWeek = selectedDate.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = shiftDays(selectedDate, mondayOffset);
  const weekDays = Array.from({ length: 7 }, (_, index) => shiftDays(weekStart, index));
  const previousWeekKey = dateKey(shiftDays(selectedDate, -7));
  const nextWeekKey = dateKey(shiftDays(selectedDate, 7));
  const offsetName =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(now)
      .find((item) => item.type === "timeZoneName")?.value ?? "GMT-06:00";
  const offset = offsetName.replace("GMT", "") || "+00:00";
  const start = new Date(`${selectedKey}T00:00:00${offset}`);
  const end = new Date(start.getTime() + 86400000);

  const [{ data: sessions }, { count: activeStudents }, { data: students }, { data: salesToday }] =
    await Promise.all([
    supabase
      .from("class_sessions")
      .select("id, starts_at, ends_at, capacity, status, template_id")
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
      .from("students")
      .select("id,full_name")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .order("full_name"),
    supabase
      .from("sales")
      .select("total_minor,status")
      .eq("studio_id", studio.id)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
  ]);

  const sessionIds = (sessions ?? []).map((session) => session.id);
  const { data: reservations } = sessionIds.length
    ? await supabase
        .from("reservations")
        .select("id,session_id,student_id,status,acquisition_id")
        .in("session_id", sessionIds)
        .in("status", ["reserved", "attended", "no_show"])
        .order("booked_at")
    : {
        data: [] as {
          id: string;
          session_id: string;
          student_id: string | null;
          status: string;
          acquisition_id: string | null;
        }[],
      };

  const acquisitionIds = [
    ...new Set((reservations ?? []).map((item) => item.acquisition_id).filter(Boolean)),
  ] as string[];
  const { data: acquisitions } = acquisitionIds.length
    ? await supabase
        .from("product_acquisitions")
        .select("id,product_template_id,expires_on,unlimited")
        .in("id", acquisitionIds)
    : {
        data: [] as {
          id: string;
          product_template_id: string;
          expires_on: string | null;
          unlimited: boolean;
        }[],
      };
  const productIds = [...new Set((acquisitions ?? []).map((item) => item.product_template_id))];
  const { data: products } = productIds.length
    ? await supabase.from("product_templates").select("id,name").in("id", productIds)
    : { data: [] as { id: string; name: string }[] };
  const balances = await Promise.all(
    (acquisitions ?? []).map(async (acquisition) => {
      if (acquisition.unlimited) return [acquisition.id, null] as const;
      const { data } = await supabase.rpc("acquisition_credit_balance", {
        target_acquisition_id: acquisition.id,
      });
      return [acquisition.id, typeof data === "number" ? data : 0] as const;
    }),
  );

  const balanceMap = new Map(balances);
  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.id, item]));
  const productMap = new Map((products ?? []).map((item) => [item.id, item.name]));
  const studentMap = new Map((students ?? []).map((item) => [item.id, item.full_name]));
  const reservationsBySession = new Map<string, typeof reservations>();
  for (const reservation of reservations ?? []) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

  const reservationsCount = (reservations ?? []).filter(
    (reservation) => reservation.status === "reserved",
  ).length;
  const occupiedCount = (reservations ?? []).filter((reservation) =>
    occupyingReservationStatuses.has(reservation.status),
  ).length;
  const templateIds = [...new Set((sessions ?? []).map((session) => session.template_id))];
  const { data: templates } = templateIds.length
    ? await supabase.from("class_templates").select("id, name").in("id", templateIds)
    : { data: [] as { id: string; name: string }[] };
  const templateMap = new Map((templates ?? []).map((item) => [item.id, item.name]));
  const totalCapacity = (sessions ?? []).reduce((sum, session) => sum + session.capacity, 0);
  const occupancy = totalCapacity > 0 ? Math.round((occupiedCount / totalCapacity) * 100) : null;
  const viewingToday = selectedKey === todayKey;
  const nextSession = viewingToday
    ? (sessions ?? []).find((session) => new Date(session.ends_at).getTime() >= now.getTime())
    : sessions?.[0];
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "Mike";

  const canReadSchedule = can(CAPABILITIES.SCHEDULE_READ);
  const canWriteSchedule = can(CAPABILITIES.SCHEDULE_WRITE);
  const canReadStudents = can(CAPABILITIES.STUDENTS_READ);
  const canWriteStudents = can(CAPABILITIES.STUDENTS_WRITE);
  const canAttendance = can(CAPABILITIES.ATTENDANCE_WRITE);
  const canCreateWalkinStudent = canAttendance && canWriteStudents;
  const canReadRequiredActions = can(CAPABILITIES.REQUIRED_ACTIONS_READ);
  const canWriteSales = can(CAPABILITIES.SALES_WRITE);

  const requiredActionsResult = canReadRequiredActions
    ? await supabase
        .from("required_actions")
        .select("id,priority,status,reason,created_at", { count: "exact" })
        .eq("studio_id", studio.id)
        .in("status", ["pending", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(5)
    : { data: [], count: 0 };
  const requiredActions = requiredActionsResult.data ?? [];
  const visibleSales = (salesToday ?? []).filter((sale) => sale.status !== "voided");
  const salesTotalMinor = visibleSales.reduce((sum, sale) => sum + (sale.total_minor ?? 0), 0);
  const salesTotal = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: studio.currency ?? "MXN",
    maximumFractionDigits: 0,
  }).format(salesTotalMinor / 100);

  const operationsBySession = new Map<
    string,
    {
      roster: {
        id: string;
        studentName: string;
        status: string;
        packageLabel: string;
        creditsLabel: string;
        expiresLabel: string;
      }[];
      candidates: { id: string; fullName: string; eligible: boolean; detail: string }[];
    }
  >();

  if (canReadSchedule) {
    for (const session of sessions ?? []) {
      const sessionReservations = reservationsBySession.get(session.id) ?? [];
      const bookedIds = new Set(sessionReservations.map((item) => item.student_id).filter(Boolean));
      const candidates = (students ?? []).filter((student) => !bookedIds.has(student.id));
      const eligibilityEntries = canWriteSchedule
        ? await Promise.all(
            candidates.map(async (student) => {
              const { data } = await supabase.rpc("booking_eligibility", {
                target_session_id: session.id,
                target_student_id: student.id,
              });
              return [student.id, (data ?? {}) as EligibilityResult] as const;
            }),
          )
        : [];
      const eligibilityMap = new Map(eligibilityEntries);

      operationsBySession.set(session.id, {
        roster: sessionReservations.map((reservation) => {
          const acquisition = reservation.acquisition_id
            ? acquisitionMap.get(reservation.acquisition_id)
            : null;
          const balance = reservation.acquisition_id
            ? balanceMap.get(reservation.acquisition_id)
            : null;

          return {
            id: reservation.id,
            studentName: reservation.student_id
              ? (studentMap.get(reservation.student_id) ?? "Alumna")
              : "Alumna",
            status: reservation.status,
            packageLabel: acquisition
              ? (productMap.get(acquisition.product_template_id) ?? "Producto activo")
              : "Sin producto vinculado",
            creditsLabel: acquisition?.unlimited
              ? "Ilimitado"
              : acquisition
                ? `${balance ?? 0} créditos disponibles`
                : "—",
            expiresLabel: formatExpiry(acquisition?.expires_on ?? null),
          };
        }),
        candidates: candidates.map((student) => {
          const eligibility = eligibilityMap.get(student.id);
          const reason = eligibility?.reason_code
            ? (eligibilityCopy[eligibility.reason_code] ?? "no elegible")
            : "no elegible";

          return {
            id: student.id,
            fullName: student.full_name,
            eligible: eligibility?.eligible === true,
            detail: eligibility?.eligible
              ? eligibility.unlimited
                ? "membresía ilimitada"
                : `${eligibility.available_credits ?? 0} créditos`
              : reason,
          };
        }),
      });
    }
  }

  const nextSessionOccupied = nextSession
    ? (reservationsBySession.get(nextSession.id) ?? []).filter((reservation) =>
        occupyingReservationStatuses.has(reservation.status),
      ).length
    : 0;

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
            {canWriteSchedule ? <Link href="/admin/agenda#programar-clase">Crear clase</Link> : null}
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
            <small>{(sessions ?? []).filter((session) => session.status === "scheduled").length} programadas</small>
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
            <small>{requiredActions.filter((action) => action.priority === "high").length} urgentes</small>
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
                  <small>{occupied}/{session.capacity}</small>
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
              <h2>Atención <span>(pendientes)</span></h2>
              <Link href="/admin/acciones">Ver todas →</Link>
            </div>
            <div className="mock-list">
              {requiredActions.slice(0, 5).map((action) => (
                <Link className="mock-list-row attention-row" href={`/admin/acciones/${action.id}`} key={action.id}>
                  <span className={`mock-priority-dot is-${action.priority}`} aria-hidden="true" />
                  <strong>{action.reason}</strong>
                  <small>
                    {action.priority === "high" ? "Urgente" : action.status === "in_progress" ? "En proceso" : "Pendiente"}
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

      <section className="mock-detail-divider">
        <div>
          <span>Operación detallada</span>
          <small>Consulta y opera las clases sin perder las herramientas existentes.</small>
        </div>
      </section>

      <nav className="week-picker" aria-label="Seleccionar día de operación">
        <Link
          className="week-arrow"
          href={`/admin?date=${previousWeekKey}`}
          aria-label="Semana anterior"
        >
          ‹
        </Link>
        <div className="week-days">
          {weekDays.map((day) => {
            const key = dateKey(day);
            return (
              <Link
                key={key}
                href={`/admin?date=${key}`}
                className={`week-day${key === selectedKey ? " is-selected" : ""}${key === todayKey ? " is-today" : ""}`}
              >
                <span>{weekDay(day)}</span>
                <strong>{day.getUTCDate()}</strong>
              </Link>
            );
          })}
        </div>
        <Link
          className="week-arrow"
          href={`/admin?date=${nextWeekKey}`}
          aria-label="Semana siguiente"
        >
          ›
        </Link>
        {!viewingToday ? (
          <Link className="today-shortcut" href="/admin">
            Hoy
          </Link>
        ) : null}
      </nav>

      <section className="hoy-primary-grid">
        <article className={`panel next-class-card${nextSession ? "" : " is-empty"}`}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{viewingToday ? "PRÓXIMA CLASE" : "PRIMERA CLASE"}</p>
              <h2>
                {nextSession ? (templateMap.get(nextSession.template_id) ?? "Clase") : "Sin clases"}
              </h2>
            </div>
            {nextSession ? (
              <span className="status-pill">
                {nextSession.status === "scheduled" ? "Programada" : nextSession.status}
              </span>
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
                  <strong>{nextSessionOccupied}</strong>
                  <span>lugares ocupados</span>
                </div>
                <div>
                  <strong>{nextSession.capacity}</strong>
                  <span>capacidad</span>
                </div>
              </div>
            </>
          ) : (
            <div className="next-class-empty">
              <span>No hay clases programadas para este día.</span>
            </div>
          )}
        </article>

        <article className="panel hoy-quick-card">
          <p className="eyebrow">OPERACIÓN</p>
          <h2>Acciones rápidas</h2>
          <div className="quick-action-list">
            {canWriteStudents ? (
              <Link href="/admin/alumnas#alta-rapida">
                <StudentsIcon />
                <span>Alumnas</span>
                <strong>Nueva alumna →</strong>
              </Link>
            ) : null}
            {canWriteSales ? (
              <Link href="/admin/ventas/nueva">
                <span className="quick-icon" aria-hidden="true">
                  $
                </span>
                <span>Comercial</span>
                <strong>Registrar venta →</strong>
              </Link>
            ) : null}
            {canWriteSchedule ? (
              <Link href="/admin/agenda#clases-programadas">
                <CalendarIcon />
                <span>Agenda</span>
                <strong>Crear reserva →</strong>
              </Link>
            ) : null}
            {canWriteSchedule ? (
              <Link href="/admin/agenda#programar-clase">
                <span className="quick-icon" aria-hidden="true">
                  +
                </span>
                <span>Agenda</span>
                <strong>Crear clase →</strong>
              </Link>
            ) : null}
            {!canWriteStudents && !canWriteSales && !canWriteSchedule ? (
              <p className="quick-action-empty">No tienes acciones rápidas disponibles.</p>
            ) : null}
          </div>
        </article>
      </section>

      <section className="stat-grid hoy-stat-grid" aria-label="Indicadores operativos del día">
        <article className="stat-card">
          <span>Clases</span>
          <strong>{sessions?.length ?? 0}</strong>
          <small>Sesiones del día</small>
        </article>
        <article className="stat-card">
          <span>Reservas</span>
          <strong>{reservationsCount}</strong>
          <small>Lugares confirmados</small>
        </article>
        <article className="stat-card">
          <span>Alumnas activas</span>
          <strong>{activeStudents ?? 0}</strong>
          <small>Expedientes activos</small>
        </article>
        <article className="stat-card">
          <span>Ocupación</span>
          <strong>{occupancy === null ? "—" : `${occupancy}%`}</strong>
          <small>
            {totalCapacity ? `${occupiedCount} de ${totalCapacity} lugares` : "Sin cupo programado"}
          </small>
        </article>
      </section>

      {canReadRequiredActions ? (
        <RequiredActionContextPanel
          eyebrow="ATENCIÓN OPERATIVA"
          title="Acciones requeridas"
          actions={requiredActions}
          totalCount={requiredActionsResult.count ?? 0}
          emptyCopy="No hay incidencias abiertas que necesiten intervención."
        />
      ) : null}

      <section className="panel hoy-schedule-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AGENDA DEL DÍA</p>
            <h2>{viewingToday ? "Clases de hoy" : `Clases del ${formatDay(selectedDate)}`}</h2>
          </div>
          {canReadSchedule ? (
            <Link className="secondary-button" href="/admin/agenda">
              Administrar agenda
            </Link>
          ) : null}
        </div>

        {(sessions?.length ?? 0) === 0 ? (
          <div className="empty-state">No hay clases programadas para este día.</div>
        ) : (
          <div className="session-list hoy-timeline">
            {sessions?.map((session) => {
              const operation = operationsBySession.get(session.id);
              const occupied = (reservationsBySession.get(session.id) ?? []).filter((reservation) =>
                occupyingReservationStatuses.has(reservation.status),
              ).length;

              return (
                <div className="today-session-block" key={session.id}>
                  <div className="session-row">
                    <div className="timeline-marker" aria-hidden="true" />
                    <div className="session-time">
                      <strong>{formatTime(session.starts_at, timeZone)}</strong>
                      <span>hasta {formatTime(session.ends_at, timeZone)}</span>
                    </div>
                    <div className="session-copy">
                      <strong>{templateMap.get(session.template_id) ?? "Clase"}</strong>
                      <span>
                        {occupied} ocupados · {session.capacity} lugares
                      </span>
                    </div>
                    <div className="session-meta">
                      <span className="status-pill">
                        {session.status === "scheduled" ? "Programada" : session.status}
                      </span>
                    </div>
                  </div>

                  {operation ? (
                    <SessionOperations
                      sessionId={session.id}
                      returnDate={selectedKey}
                      sessionStatus={session.status}
                      roster={operation.roster}
                      candidates={operation.candidates}
                      available={Math.max(session.capacity - occupied, 0)}
                      canAttendance={canAttendance}
                      canBook={canWriteSchedule}
                      canCreateStudent={canCreateWalkinStudent}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
