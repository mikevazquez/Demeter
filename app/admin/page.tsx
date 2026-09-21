import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { SessionOperations } from "./hoy/SessionOperations";

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

function formatExpiry(value: string | null) {
  if (!value) return "Sin vencimiento";
  return `Vence ${new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`))}`;
}

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
  const canWriteAttendance = can(CAPABILITIES.ATTENDANCE_WRITE);

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
      .select("id,starts_at,capacity,status,template_id")
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
  const [{ data: reservations }, { data: templates }, { data: students }] = await Promise.all([
    sessionIds.length
      ? supabase
          .from("reservations")
          .select("id,session_id,student_id,guest_person_id,status,acquisition_id")
          .in("session_id", sessionIds)
          .in("status", ["reserved", "attended", "no_show"])
          .order("booked_at")
      : Promise.resolve({
          data: [] as {
            id: string;
            session_id: string;
            student_id: string | null;
            guest_person_id: string | null;
            status: string;
            acquisition_id: string | null;
          }[],
        }),
    templateIds.length
      ? supabase.from("class_templates").select("id,name").in("id", templateIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase
      .from("students")
      .select("id,full_name")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .order("full_name"),
  ]);

  const studentMap = new Map((students ?? []).map((item) => [item.id, item.full_name]));
  const guestPersonIds = [
    ...new Set((reservations ?? []).map((item) => item.guest_person_id).filter(Boolean)),
  ] as string[];
  const { data: guestPersons } = guestPersonIds.length
    ? await supabase
        .from("persons")
        .select("id,first_name,last_name")
        .eq("studio_id", studio.id)
        .in("id", guestPersonIds)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
  const guestNameMap = new Map(
    (guestPersons ?? []).map((person) => [
      person.id,
      [person.first_name, person.last_name].filter(Boolean).join(" ") || "Invitado",
    ]),
  );

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

  const templateMap = new Map((templates ?? []).map((item) => [item.id, item.name]));
  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.id, item]));
  const productMap = new Map((products ?? []).map((item) => [item.id, item.name]));
  const balanceMap = new Map(balances);
  const reservationsBySession = new Map<string, typeof reservations>();
  for (const reservation of reservations ?? []) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

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

  for (const session of selectedSessions ?? []) {
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
        const isGuest = Boolean(reservation.guest_person_id);
        const acquisition = reservation.acquisition_id
          ? acquisitionMap.get(reservation.acquisition_id)
          : null;
        const balance = reservation.acquisition_id
          ? balanceMap.get(reservation.acquisition_id)
          : null;
        return {
          id: reservation.id,
          studentName: isGuest
            ? (guestNameMap.get(reservation.guest_person_id!) ?? "Invitado")
            : reservation.student_id
              ? (studentMap.get(reservation.student_id) ?? "Alumna")
              : "Alumna",
          status: reservation.status,
          packageLabel: isGuest
            ? "Invitación"
            : acquisition
              ? (productMap.get(acquisition.product_template_id) ?? "Producto activo")
              : "Sin producto vinculado",
          creditsLabel: isGuest
            ? "Beneficio por nivel"
            : acquisition?.unlimited
              ? "Ilimitado"
              : acquisition
                ? `${balance ?? 0} créditos disponibles`
                : "—",
          expiresLabel: isGuest ? "Misma clase" : formatExpiry(acquisition?.expires_on ?? null),
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

      <section className="mock-overview-grid">
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
              const operation = operationsBySession.get(session.id);
              return (
                <div className="today-session-block" key={session.id}>
                  <div className="mock-list-row">
                    <span className="mock-time">{formatTime(session.starts_at, timeZone)}</span>
                    <span className="mock-dot" aria-hidden="true" />
                    <strong>{templateMap.get(session.template_id) ?? "Clase"}</strong>
                    <small>
                      {occupied}/{session.capacity}
                    </small>
                  </div>
                  {operation ? (
                    <SessionOperations
                      sessionId={session.id}
                      returnDate={selectedKey}
                      sessionStatus={session.status}
                      roster={operation.roster}
                      candidates={operation.candidates}
                      available={Math.max(session.capacity - occupied, 0)}
                      canAttendance={canWriteAttendance}
                      canBook={canWriteSchedule}
                      canCreateStudent={canWriteStudents}
                    />
                  ) : null}
                </div>
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
