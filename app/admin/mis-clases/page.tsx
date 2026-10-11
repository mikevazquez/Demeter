import Link from "next/link";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  addDays,
  formatLongDate,
  formatTime,
  isDateKey,
  localDateKey,
  type CoachSession,
  type CoachRosterItem,
} from "@/lib/coach/portal";
import { TodayClasses, type TodayClassItem } from "../hoy/TodayClasses";
import StudioClock from "../hoy/StudioClock";

export default async function MyClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const [query, ctx] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.SCHEDULE_READ),
  ]);
  if (ctx.can(CAPABILITIES.ADMIN_PORTAL)) redirect("/admin");
  const today = localDateKey(new Date(), ctx.studio.timezone);
  const selected = isDateKey(query.date) ? query.date! : today;
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  const { data, error } = await ctx.supabase.rpc("coach_my_sessions", {
    target_studio_id: ctx.studio.id,
    target_start: days[0],
    target_end: selected > days[6] ? selected : days[6],
  });
  const sessions = (data ?? []) as CoachSession[];
  const selectedSessions = sessions.filter(
    (item) =>
      localDateKey(new Date(item.starts_at), ctx.studio.timezone) === selected &&
      item.session_status !== "cancelled",
  );
  const rosters = await Promise.all(
    selectedSessions.map(async (session) => {
      const { data, error } = await ctx.supabase.rpc("coach_session_roster", {
        target_studio_id: ctx.studio.id,
        target_session_id: session.session_id,
      });
      if (error) throw new Error("coach_roster_unavailable");
      return (data ?? []) as CoachRosterItem[];
    }),
  );
  const extras = await Promise.all(
    selectedSessions.map(async (session) => {
      const { data, error } = await ctx.supabase.rpc("admin_coach_roster_extras", {
        target_session_id: session.session_id,
      });
      if (error) throw new Error("coach_extras_unavailable");
      return (data ?? []) as {
        id: string;
        payment_pending: boolean;
        evaluation_id: string | null;
        evaluation_status: string | null;
      }[];
    }),
  );
  const classes: TodayClassItem[] = selectedSessions.map((session, index) => ({
    id: session.session_id,
    time: formatTime(session.starts_at, ctx.studio.timezone),
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    name: session.template_name,
    instructor: ctx.profile?.full_name ?? "Coach",
    space: session.space_name ?? "Sin espacio",
    occupied: Number(session.reserved_count),
    bookedReservations: Number(session.reserved_count),
    capacity: session.capacity,
    color: "#0B7A55",
    sessionStatus: session.session_status,
    available: Math.max(0, session.capacity - Number(session.reserved_count)),
    evaluationCount: extras[index].filter((item) => item.evaluation_id).length,
    returnTo: `/admin/mis-clases?date=${selected}#session-${session.session_id}`,
    minimumReservationsEnabled: false,
    minimumReservations: 0,
    minimumReviewStatus: "not_required",
    roster: rosters[index].map((person) => ({
      id: person.reservation_id,
      studentId: person.student_id,
      studentName: person.student_name,
      status: person.attendance_status,
      packageLabel: person.package_name ?? "Clase individual",
      creditsLabel: "",
      expiresLabel: "",
      paymentDueOnAttendance:
        extras[index].find((item) => item.id === person.reservation_id)?.payment_pending ??
        person.commercial_pending,
      evaluationInvitationId: extras[index].find((item) => item.id === person.reservation_id)
        ?.evaluation_id,
      evaluationStatus: extras[index].find((item) => item.id === person.reservation_id)
        ?.evaluation_status,
      currency: ctx.studio.currency,
    })),
  }));
  return (
    <main className="dashboard-shell hoy-dashboard">
      <header className="hoy-product-header">
        <div className="hoy-product-wordmark">
          <span>
            STUDIO <b>FLOW</b>
          </span>
          <small>{ctx.profile?.full_name ?? "Tu cuenta"} · COACH</small>
        </div>
        <Link href="/admin/kiosco" className="hoy-header-action">
          Check-in
        </Link>
      </header>
      <header className="hoy-title-block">
        <div>
          <h1>Mis clases</h1>
          <p>{formatLongDate(selected)}</p>
        </div>
        <StudioClock
          serverNow={new Date().toISOString()}
          timeZone={ctx.studio.timezone}
          locale={ctx.studio.locale}
        />
      </header>
      <nav className="mock-week-calendar" aria-label="Tus clases de la semana">
        {days.map((day) => (
          <Link
            className={`mock-week-day${day === selected ? " is-selected" : ""}`}
            key={day}
            href={`/admin/mis-clases?date=${day}`}
            aria-current={day === selected ? "date" : undefined}
          >
            <span>
              {day === today
                ? "Hoy"
                : new Intl.DateTimeFormat(ctx.studio.locale, {
                    timeZone: "UTC",
                    weekday: "short",
                  }).format(new Date(`${day}T12:00Z`))}
            </span>
            <strong>{Number(day.slice(-2))}</strong>
            <small>
              {
                sessions.filter(
                  (item) =>
                    localDateKey(new Date(item.starts_at), ctx.studio.timezone) === day &&
                    item.session_status !== "cancelled",
                ).length
              }
            </small>
          </Link>
        ))}
      </nav>
      {error ? (
        <p role="alert">No pudimos cargar tus clases. Intenta de nuevo.</p>
      ) : classes.length ? (
        <TodayClasses
          classes={classes}
          returnDate={selected}
          serverNow={new Date().toISOString()}
          canAttendance
          canCollectPayment={false}
          canBook={false}
          canCreateStudent={false}
          canCorrectCompleted
          locale={ctx.studio.locale}
          timeZone={ctx.studio.timezone}
        />
      ) : (
        <section className="flow-card">No tienes clases este día.</section>
      )}
      <p className="flow-operation-note">
        Como coach ves tus clases, pasas lista, abres el check-in e inicias evaluaciones. Los
        cambios de horario y ventas los hace administración.
      </p>
    </main>
  );
}
