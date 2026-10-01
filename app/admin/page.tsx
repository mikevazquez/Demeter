import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { TodayClasses, type TodayClassItem } from "./hoy/TodayClasses";
import QuickActions from "./hoy/QuickActions";

const occupyingReservationStatuses = new Set(["reserved", "attended", "no_show"]);

function formatExpiry(value: string | null, locale: string) {
  if (!value) return "Sin vencimiento";
  return `Vence ${new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`))}`;
}

function formatTime(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
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

function shortWeekday(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
  })
    .format(value)
    .replace(".", "")
    .slice(0, 3);
}

function shortMonth(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "short",
  })
    .format(value)
    .replace(".", "");
}

function selectedDayLabel(value: Date, isToday: boolean, locale: string) {
  if (isToday) return "Clases de hoy";
  return `Clases del ${new Intl.DateTimeFormat(locale, {
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
  const { supabase, studio, can, user, profile } = await getAdminContext();
  const params = await searchParams;
  const headerName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Usuario";
  const headerInitials =
    headerName
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part.slice(0, 1).toUpperCase())
      .join("") || "U";
  const timeZone = studio.timezone;
  const locale = studio.locale;
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
  const canReadProducts = can(CAPABILITIES.PRODUCTS_READ);
  const [
    { data: serverNow },
    { data: selectedSessions },
    { data: activeProductAcquisitions },
    { data: selectedPayments },
  ] = await Promise.all([
    supabase.rpc("current_server_time"),
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,capacity,status,template_id,instructor_id,space_id,minimum_reservations_enabled,minimum_reservations,minimum_review_status",
      )
      .eq("studio_id", studio.id)
      .gte("starts_at", selectedStart.toISOString())
      .lt("starts_at", selectedEnd.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("product_acquisitions")
      .select("student_id")
      .eq("studio_id", studio.id)
      .eq("status", "active")
      .is("refunded_at", null)
      .or(`starts_on.is.null,starts_on.lte.${todayKey}`)
      .or(`expires_on.is.null,expires_on.gte.${todayKey}`),
    supabase
      .from("payments")
      .select("amount_minor,kind")
      .eq("studio_id", studio.id)
      .eq("effective_on", selectedKey),
  ]);

  const activeProductStudentIds = new Set(
    (activeProductAcquisitions ?? []).flatMap((acquisition) =>
      acquisition.student_id ? [acquisition.student_id] : [],
    ),
  );
  const activeStudents = activeProductStudentIds.size;

  const sessionIds = (selectedSessions ?? []).map((session) => session.id);
  const templateIds = [...new Set((selectedSessions ?? []).map((session) => session.template_id))];
  const instructorIds = [
    ...new Set((selectedSessions ?? []).map((session) => session.instructor_id).filter(Boolean)),
  ] as string[];
  const spaceIds = [
    ...new Set((selectedSessions ?? []).map((session) => session.space_id).filter(Boolean)),
  ] as string[];

  const [{ data: reservations }, { data: templates }, { data: instructors }, { data: spaces }] =
    await Promise.all([
      sessionIds.length
        ? supabase
            .from("reservations")
            .select("id,session_id,student_id,guest_person_id,status,acquisition_id,booked_at,commercial_status")
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
              booked_at: string;
              commercial_status: string | null;
            }[],
          }),
      templateIds.length
        ? supabase
            .from("class_templates")
            .select("id,name,color_hex,drop_in_price_minor")
            .in("id", templateIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              name: string;
              color_hex: string | null;
              drop_in_price_minor: number | null;
            }[],
          }),
      instructorIds.length
        ? supabase.from("instructors").select("id,person_id").in("id", instructorIds)
        : Promise.resolve({ data: [] as { id: string; person_id: string }[] }),
      spaceIds.length
        ? supabase.from("spaces").select("id,name").in("id", spaceIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

  const guestPersonIds = [
    ...new Set(
      (reservations ?? []).map((reservation) => reservation.guest_person_id).filter(Boolean),
    ),
  ] as string[];
  const personIds = [
    ...new Set([
      ...(instructors ?? []).map((instructor) => instructor.person_id),
      ...guestPersonIds,
    ]),
  ];

  const reservationStudentIds = [
    ...new Set(
      (reservations ?? []).map((reservation) => reservation.student_id).filter(Boolean),
    ),
  ] as string[];
  const reservationIds = (reservations ?? []).map((reservation) => reservation.id);
  const acquisitionIds = [
    ...new Set(
      (reservations ?? []).map((reservation) => reservation.acquisition_id).filter(Boolean),
    ),
  ] as string[];

  const [
    { data: persons },
    { data: reservationStudents },
    { data: attendanceCheckins },
    { data: evaluationInvitations },
    { data: acquisitions },
  ] = await Promise.all([
    personIds.length
      ? supabase
          .from("persons")
          .select("id,first_name,last_name")
          .eq("studio_id", studio.id)
          .in("id", personIds)
      : Promise.resolve({
          data: [] as { id: string; first_name: string | null; last_name: string | null }[],
        }),
    reservationStudentIds.length
      ? supabase
          .from("students")
          .select("id,full_name")
          .eq("studio_id", studio.id)
          .in("id", reservationStudentIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    reservationIds.length
      ? supabase
          .from("attendance_checkins")
          .select("reservation_id,source,checked_in_at")
          .in("reservation_id", reservationIds)
      : Promise.resolve({
          data: [] as {
            reservation_id: string;
            source: string;
            checked_in_at: string;
          }[],
        }),
    reservationIds.length
      ? supabase
          .from("evaluation_invitations")
          .select("id,reservation_id,status")
          .in("reservation_id", reservationIds)
          .in("status", ["scheduled", "in_progress"])
      : Promise.resolve({
          data: [] as { id: string; reservation_id: string | null; status: string }[],
        }),
    acquisitionIds.length
      ? supabase
          .from("product_acquisitions")
          .select("id,product_template_id,expires_on,unlimited")
          .in("id", acquisitionIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            product_template_id: string;
            expires_on: string | null;
            unlimited: boolean;
          }[],
        }),
  ]);

  const checkinByReservation = new Map(
    (attendanceCheckins ?? []).map((item) => [item.reservation_id, item]),
  );
  const evaluationByReservation = new Map(
    (evaluationInvitations ?? [])
      .filter((item) => item.reservation_id)
      .map((item) => [item.reservation_id!, item]),
  );

  const productIds = [...new Set((acquisitions ?? []).map((item) => item.product_template_id))];
  const [{ data: products }, { data: balanceRows }] = await Promise.all([
    productIds.length
      ? supabase.from("product_templates").select("id,name").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    canReadProducts && acquisitionIds.length
      ? supabase
          .from("credit_ledger")
          .select("acquisition_id,quantity")
          .eq("studio_id", studio.id)
          .in("acquisition_id", acquisitionIds)
      : Promise.all(
          (acquisitions ?? []).map(async (acquisition) => {
            if (acquisition.unlimited) {
              return { acquisition_id: acquisition.id, quantity: 0 };
            }
            const { data } = await supabase.rpc("acquisition_credit_balance", {
              target_acquisition_id: acquisition.id,
            });
            return {
              acquisition_id: acquisition.id,
              quantity: typeof data === "number" ? data : 0,
            };
          }),
        ).then((data) => ({ data })),
  ]);

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
  const studentMap = new Map(
    (reservationStudents ?? []).map((student) => [student.id, student.full_name] as const),
  );
  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.id, item]));
  const productMap = new Map((products ?? []).map((item) => [item.id, item.name]));
  const balanceMap = new Map<string, number>();
  for (const row of balanceRows ?? []) {
    balanceMap.set(
      row.acquisition_id,
      (balanceMap.get(row.acquisition_id) ?? 0) + row.quantity,
    );
  }

  const reservationsBySession = new Map<string, typeof reservations>();
  for (const reservation of reservations ?? []) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

  const classes: TodayClassItem[] = [];

  for (const session of selectedSessions ?? []) {
    const sessionReservations = reservationsBySession.get(session.id) ?? [];
    const template = templateMap.get(session.template_id);
    const occupied = sessionReservations.filter((reservation) =>
      occupyingReservationStatuses.has(reservation.status),
    ).length;

    classes.push({
      id: session.id,
      time: formatTime(session.starts_at, timeZone, locale),
      startsAt: session.starts_at,
      endsAt: session.ends_at,
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
      evaluationCount: sessionReservations.filter((reservation) =>
        evaluationByReservation.has(reservation.id),
      ).length,
      returnTo: `/admin?date=${selectedKey}#session-${session.id}`,
      minimumReservationsEnabled: session.minimum_reservations_enabled ?? false,
      minimumReservations: session.minimum_reservations ?? 2,
      minimumReviewStatus: session.minimum_review_status ?? "not_required",
      roster: sessionReservations.map((reservation) => {
        const isGuest = Boolean(reservation.guest_person_id);
        const acquisition = reservation.acquisition_id
          ? acquisitionMap.get(reservation.acquisition_id)
          : null;
        const balance = reservation.acquisition_id
          ? balanceMap.get(reservation.acquisition_id)
          : null;

        const evaluationInvitation = evaluationByReservation.get(reservation.id);
        const attendanceCheckin = checkinByReservation.get(reservation.id);

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
          expiresLabel: isGuest
            ? "Misma clase"
            : formatExpiry(acquisition?.expires_on ?? null, locale),
          studentId: reservation.student_id,
          evaluationInvitationId: evaluationInvitation?.id ?? null,
          evaluationStatus: evaluationInvitation?.status ?? null,
          attendanceSource: attendanceCheckin?.source ?? null,
          checkedInAt: attendanceCheckin?.checked_in_at ?? null,
          attendanceProvenance:
            session.status === "completed" &&
            new Date(reservation.booked_at).getTime() >= new Date(session.ends_at).getTime()
              ? "Agregada manualmente después del cierre"
              : null,
          paymentDueOnAttendance: reservation.commercial_status === "payment_pending",
          individualPriceMinor: template?.drop_in_price_minor ?? null,
          currency: studio.currency ?? "MXN",
        };
      }),
    });
  }

  const totalDailyCapacity = classes.reduce((sum, item) => sum + item.capacity, 0);
  const totalDailyReservations = classes.reduce((sum, item) => sum + item.occupied, 0);
  const dailyReservationPercentage =
    totalDailyCapacity > 0 ? Math.round((totalDailyReservations / totalDailyCapacity) * 100) : 0;

  const salesTotalMinor = (selectedPayments ?? []).reduce(
    (sum, payment) =>
      sum +
      (payment.kind === "refund" ? -(payment.amount_minor ?? 0) : (payment.amount_minor ?? 0)),
    0,
  );
  const salesTotal = new Intl.NumberFormat(studio.locale, {
    style: "currency",
    currency: studio.currency,
    maximumFractionDigits: 0,
  }).format(salesTotalMinor / 100);

  return (
    <main className="dashboard-shell hoy-dashboard hoy-approved hoy-v2">
      <header className="hoy-product-header">
        <div className="hoy-product-wordmark" aria-label="Studio Flow">
          <span>
            STUDIO <b>FLOW</b>
          </span>
          <small>MOVIMIENTO QUE TRANSFORMA</small>
        </div>
        <div className="flex items-center gap-2">
          {canWriteAttendance ? (
            <Link href="/admin/kiosco" className="hoy-header-action">
              Check-in
            </Link>
          ) : null}
          {canWriteStudents || canWriteSales ? (
            <QuickActions
              canStudents={canWriteStudents}
              canSales={canWriteSales}
              locale={locale}
            />
          ) : null}
          <span className="hoy-product-avatar" aria-label={headerName}>
            {headerInitials}
          </span>
        </div>
      </header>

      <header className="hoy-title-block">
        <div>
          <span className="hoy-eyebrow">{selectedKey === todayKey ? "Hoy" : "Agenda"}</span>
          <h1>{selectedDayLabel(selectedDate, selectedKey === todayKey, locale)}</h1>
        </div>
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
            {weekStart.getUTCDate()} {shortMonth(weekStart, locale)} — {weekEnd.getUTCDate()}{" "}
            {shortMonth(weekEnd, locale)}
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
                <span>{shortWeekday(day, locale)}</span>
                <strong>{day.getUTCDate()}</strong>
              </Link>
            );
          })}
        </nav>
      </section>

      <section className="hoy-glance" aria-label="Resumen rápido">
        <Link href="/admin/alumnas">
          <strong>{activeStudents}</strong>
          <span>Alumnas activas</span>
        </Link>
        <Link href="/admin/ventas">
          <strong>{salesTotal}</strong>
          <span>Ventas hoy</span>
        </Link>
        <div>
          <strong>{dailyReservationPercentage}%</strong>
          <span>
            Ocupación · {totalDailyReservations}/{totalDailyCapacity}
          </span>
        </div>
      </section>

      <TodayClasses
        classes={classes}
        returnDate={selectedKey}
        serverNow={String(serverNow ?? now.toISOString())}
        canAttendance={canWriteAttendance}
        canBook={canWriteSchedule}
        canCreateStudent={canWriteStudents}
        locale={locale}
        timeZone={timeZone}
        canCorrectCompleted
      />
    </main>
  );
}
