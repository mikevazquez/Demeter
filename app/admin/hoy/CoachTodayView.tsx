import Link from "next/link";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  addDays,
  formatTime,
  isDateKey,
  localDateKey,
  type CoachRosterItem,
  type CoachSession,
} from "@/lib/coach/portal";

import { TodayClasses, type TodayClassItem } from "./TodayClasses";

function parseDateKey(value: string) {
  return new Date(`${value}T12:00:00Z`);
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

export async function CoachTodayView({
  searchParams,
}: {
  searchParams: { error?: string; created?: string; date?: string };
}) {
  const { supabase, studio, membership, user } = await getAdminContext(
    CAPABILITIES.SCHEDULE_READ,
  );

  if (membership.role !== "instructor") redirect("/admin");

  const todayKey = localDateKey(new Date(), studio.timezone);
  const selectedKey = isDateKey(searchParams.date) ? searchParams.date! : todayKey;
  const selectedDate = parseDateKey(selectedKey);
  const weekStart = weekStartMonday(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => shiftUtcDays(weekStart, index));
  const previousWeekKey = utcDateKey(shiftUtcDays(weekStart, -7));
  const nextWeekKey = utcDateKey(shiftUtcDays(weekStart, 7));
  const weekEnd = shiftUtcDays(weekStart, 6);

  const [{ data: profile }, { data: sessionsData }, { data: serverNow }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.rpc("coach_my_sessions", {
      target_studio_id: studio.id,
      target_start: selectedKey,
      target_end: selectedKey,
    }),
    supabase.rpc("current_server_time"),
  ]);

  const sessions = (sessionsData ?? []) as CoachSession[];
  const rosterEntries = await Promise.all(
    sessions.map(async (session) => {
      const { data } = await supabase.rpc("coach_session_roster", {
        target_studio_id: studio.id,
        target_session_id: session.session_id,
      });
      return [session.session_id, (data ?? []) as CoachRosterItem[]] as const;
    }),
  );
  const rosterBySession = new Map(rosterEntries);

  const reservationIds = rosterEntries.flatMap(([, roster]) =>
    roster.map((item) => item.reservation_id),
  );
  const { data: checkins } = reservationIds.length
    ? await supabase
        .from("attendance_checkins")
        .select("reservation_id,source,checked_in_at")
        .in("reservation_id", reservationIds)
    : {
        data: [] as {
          reservation_id: string;
          source: string;
          checked_in_at: string;
        }[],
      };
  const checkinByReservation = new Map(
    (checkins ?? []).map((item) => [item.reservation_id, item]),
  );

  const templateNames = [...new Set(sessions.map((session) => session.template_name))];
  const { data: styles } = templateNames.length
    ? await supabase
        .from("class_templates")
        .select("name,color_hex")
        .eq("studio_id", studio.id)
        .in("name", templateNames)
    : { data: [] as { name: string; color_hex: string | null }[] };
  const colorByTemplate = new Map(
    (styles ?? []).map((item) => [item.name, item.color_hex ?? "#FF0A8A"]),
  );

  const classes: TodayClassItem[] = sessions.map((session) => {
    const roster = rosterBySession.get(session.session_id) ?? [];

    return {
      id: session.session_id,
      time: formatTime(session.starts_at, studio.timezone),
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      name: session.template_name,
      instructor: profile?.full_name?.trim() || "Coach",
      space: session.space_name ?? "Espacio por confirmar",
      occupied: Number(session.reserved_count),
      capacity: session.capacity,
      color: colorByTemplate.get(session.template_name) ?? "#FF0A8A",
      sessionStatus: session.session_status,
      roster: roster.map((item) => {
        const checkin = checkinByReservation.get(item.reservation_id);
        return {
          id: item.reservation_id,
          studentId: item.student_id,
          studentName: item.student_name,
          status: item.attendance_status,
          packageLabel: item.package_name ?? (item.commercial_pending ? "Pendiente comercial" : "Reserva"),
          creditsLabel: item.commercial_pending ? "Venta pendiente" : "Studio Flow",
          expiresLabel: "—",
          evaluationStatus: null,
          attendanceSource: checkin?.source ?? null,
          checkedInAt: checkin?.checked_in_at ?? null,
        };
      }),
      candidates: [],
      available: Math.max(session.capacity - Number(session.reserved_count), 0),
      evaluationCount: 0,
      returnTo: `/admin?date=${selectedKey}#session-${session.session_id}`,
    };
  });

  const headerName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Coach";
  const headerInitials =
    headerName
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part.slice(0, 1).toUpperCase())
      .join("") || "C";

  return (
    <main className="dashboard-shell hoy-dashboard hoy-approved hoy-coach">
      <header className="hoy-product-header">
        <div className="hoy-product-wordmark" aria-label="Studio Flow">
          <span>
            STUDIO <b>FLOW</b>
          </span>
          <small>MOVIMIENTO QUE TRANSFORMA</small>
        </div>
        <span className="hoy-product-avatar" aria-label={headerName}>
          {headerInitials}
        </span>
      </header>

      {searchParams.error ? (
        <div className="notice error">
          No se pudo completar la operación: {decodeURIComponent(searchParams.error)}
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

      <TodayClasses
        classes={classes}
        returnDate={selectedKey}
        serverNow={String(serverNow ?? new Date().toISOString())}
        canAttendance
        canBook={false}
        canCreateStudent
        canCorrectCompleted={false}
      />
    </main>
  );
}
