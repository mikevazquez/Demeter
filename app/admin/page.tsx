import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { TodayClasses, type TodayClassItem } from "./hoy/TodayClasses";

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
  enrollment_required: "inscripción no vigente",
  payment_pending: "pago pendiente",
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
    month: "long",
  }).format(value)}`;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; date?: string }>;
}) {
  const { supabase, studio, can } = await getAdminContext();
  const params = await searchParams;
  const timeZone = studio.timezone ?? "America/Mexico_City";
  const now = new Date();
  const todayKey = localDateKey(now, timeZone);
  const selectedDate = parseDateKey(params.date) ?? parseDateKey(todayKey)!;
  const selectedKey = utcDateKey(selectedDate);
  const weekStart = weekStartMonday(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => shiftUtcDays(weekStart, index));
  const previousWeekKey = utcDateKey(shiftUtcDays(weekStart, -7));
  const nextWeekKey = utcDateKey(shiftUtcDays(weekStart, 7));
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
    { data: todaySessions },
    { data: selectedSessions },
    { count: activeStudents },
    { data: salesToday },
    { data: students },
  ] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("id,status")
      .eq("studio_id", studio.id)
      .gte("starts_at", todayStart.toISOString())
      .lt("starts_at", todayEnd.toISOString()),
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
    supabase
      .from("students")
      .select("id,full_name")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .order("full_name"),
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

  const guestPersonIds = [
    ...new Set((reservations ?? []).map((reservation) => reservation.guest_person_id).filter(Boolean)),
  ] as string[];
  const personIds = [
    ...new Set([
      ...(instructors ?? []).map((instructor) => instructor.person_id),
      ...guestPersonIds,
    ]),
  ];

  const { data: persons } = personIds.length
    ? await supabase
        .from("persons")
        .select("id,first_name,last_name")
        .eq("studio_id", studio.id)
        .in("id", personIds)
    : {
        data: [] as { id: string; first_name: string | null; last_name: string | null }[],
      };

  const acquisitionIds = [
    ...new Set((reservations ?? []).map((reservation) => reservation.acquisition_id).filter(Boolean)),
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

  const templateMap = new Map((templates ?? []).map((item) => [item.id, item]));
  const personMap = new Map(
    (persons ?? []).map((person) => [
      person.id,
      [person.first_name, person.last_name].filter(Boolean).join(" ") || "Persona",
    ]),
  );
  const instructorMap = new Map(
    (instructors ?? []).map((instructor) => [
      instructor.id,
      personMap.get(instructor.person_id) ?? "Instructor",
    ]),
  );
  const spaceMap = new Map((spaces ?? []).map((space) => [space.id, space.name]));
  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));
  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.id, item]));
  const productMap = new Map((products ?? []).map((item) => [item.id, item.name]));
  const balanceMap = new Map(balances);

  const reservationsBySession = new Map<string, typeof reservations>();
  for (const reservation of reservations ?? []) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

  const classes: TodayClassItem[] = [];

  for (const session of selectedSessions ?? []) {
    const sessionReservations = reservationsBySession.get(session.id) ?? [];
    const bookedIds = new Set(
      sessionReservations.map((reservation) => reservation.student_id).filter(Boolean),
    );
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
    const template = templateMap.get(session.template_id);
    const occupied = sessionReservations.filter((reservation) =>
      occupyingReservationStatuses.has(reservation.status),
    ).length;

    classes.push({
      id: session.id,
      time: formatTime(session.starts_at, timeZone),
      name: template?.name ?? "Clase",
      instructor: session.instructor_id
        ? (instructorMap.get(session.instructor_id) ?? "Instructor")
        : "Sin instructor",
      space: session.space_id ? (spaceMap.get(session.space_id) ?? "Espacio") : "Sin espacio",
      occupied,
      capacity: session.capacity,
      color: template?.color_hex ?? "#FF0A8A",
      sessionStatus: session.status,
      available: Math.max(session.capacity - occupied, 0),
      returnTo: `/admin?date=${selectedKey}#session-${session.id}`,
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
            ? (personMap.get(reservation.guest_person_id!) ?? "Invitado")
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
                ? `${balance ?? 0} créditos`
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

  const visibleSales = (salesToday ?? []).filter((sale) => sale.status !== "voided");
  const salesTotalMinor = visibleSales.reduce((sum, sale) => sum + (sale.total_minor ?? 0), 0);
  const salesTotal = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: studio.currency ?? "MXN",
    maximumFractionDigits: 0,
  }).format(salesTotalMinor / 100);

  return (
    <main className="dashboard-shell hoy-dashboard hoy-approved">
      <header className="hoy-title-block">
        <h1>{selectedDayLabel(selectedDate, selectedKey === todayKey)}</h1>
        <p>Administra, conecta, haz fluir.</p>
      </header>

      {params.error ? (
        <div className="notice error">
          No se pudo completar la operación: {decodeURIComponent(params.error)}
        </div>
      ) : null}

      <section className="hoy-week-card" aria-label="Calendario semanal">
        <div className="hoy-week-heading">
          <Link href={`/admin?date=${previousWeekKey}`} aria-label="Semana anterior">
            ‹
          </Link>
          <strong>
            {weekStart.getUTCDate()} {shortMonth(weekStart)} — {weekEnd.getUTCDate()}{" "}
            {shortMonth(weekEnd)}
          </strong>
          <Link href={`/admin?date=${nextWeekKey}`} aria-label="Semana siguiente">
            ›
          </Link>
        </div>

        <nav className="mock-week-calendar">
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
      </section>

      <section className="hoy-kpi-grid" aria-label="Resumen del estudio">
        <Link className="hoy-kpi-card" href={`/admin?date=${todayKey}`}>
          <span className="hoy-kpi-icon" aria-hidden="true">
            ◫
          </span>
          <span>
            <small>Clases hoy</small>
            <strong>{todaySessions?.length ?? 0}</strong>
          </span>
          <b aria-hidden="true">›</b>
        </Link>

        <Link className="hoy-kpi-card" href="/admin/alumnas">
          <span className="hoy-kpi-icon" aria-hidden="true">
            ♧
          </span>
          <span>
            <small>Alumnas activas</small>
            <strong>{activeStudents ?? 0}</strong>
          </span>
          <b aria-hidden="true">›</b>
        </Link>

        {canWriteSales ? (
          <Link className="hoy-kpi-card" href="/admin/ventas">
            <span className="hoy-kpi-icon" aria-hidden="true">
              ▥
            </span>
            <span>
              <small>Ventas hoy</small>
              <strong>{salesTotal}</strong>
            </span>
            <b aria-hidden="true">›</b>
          </Link>
        ) : (
          <article className="hoy-kpi-card">
            <span className="hoy-kpi-icon" aria-hidden="true">
              ▥
            </span>
            <span>
              <small>Ventas hoy</small>
              <strong>{salesTotal}</strong>
            </span>
          </article>
        )}
      </section>

      <TodayClasses
        classes={classes}
        returnDate={selectedKey}
        canAttendance={canWriteAttendance}
        canBook={canWriteSchedule}
        canCreateStudent={canWriteStudents}
      />
    </main>
  );
}
