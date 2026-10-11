import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { isSeatOccupyingReservation } from "@/lib/reservations/capacity";
import CoachFilter from "./CoachFilter";
import { cancelSession, updateSession, reopenSession } from "./[sessionId]/actions";

function formatMoney(minor: number, locale: string, currency: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
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

function fullDateLabel(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(value);
}

function zonedDateTimeToUtc(localDateTime: string, timeZone: string) {
  const [datePart, timePart] = localDateTime.split("T");
  if (!datePart || !timePart) throw new Error("Invalid datetime");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess - (asIfUtc - guess));
}

function localClockParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function formatTime(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatHour(hour: number, locale: string) {
  const normalized = ((hour % 24) + 24) % 24;
  const date = new Date(Date.UTC(2026, 0, 1, normalized, 0, 0));
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(status: string) {
  if (status === "cancelled") return "Cancelada";
  if (status === "completed") return "Finalizada";
  return "Programada";
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    date?: string;
    session?: string;
    coach?: string;
  }>;
}) {
  const [params, { supabase, studio, membership, can, user, profile }] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.SCHEDULE_READ),
  ]);
  const canEdit = can(CAPABILITIES.SCHEDULE_WRITE);
  const timeZone = studio.timezone;
  const locale = studio.locale;
  const currency = studio.currency;
  const now = new Date();
  const todayKey = localDateKey(now, timeZone);
  const selectedDate = parseDateKey(params.date) ?? parseDateKey(todayKey)!;
  const selectedKey = utcDateKey(selectedDate);
  const weekStart = weekStartMonday(selectedDate);
  const weekEnd = shiftUtcDays(weekStart, 6);
  const previousWeekKey = utcDateKey(shiftUtcDays(weekStart, -7));
  const nextWeekKey = utcDateKey(shiftUtcDays(weekStart, 7));
  const weekDays = Array.from({ length: 7 }, (_, index) => shiftUtcDays(weekStart, index));
  const weekStartKey = utcDateKey(weekStart);
  const weekAfterKey = utcDateKey(shiftUtcDays(weekStart, 7));
  const weekStartUtc = zonedDateTimeToUtc(`${weekStartKey}T00:00`, timeZone);
  const weekAfterUtc = zonedDateTimeToUtc(`${weekAfterKey}T00:00`, timeZone);

  const headerName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Usuario";
  const headerInitials =
    headerName
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part.slice(0, 1).toUpperCase())
      .join("") || "U";

  const [
    { data: disciplines },
    { data: templates },
    { data: spaces },
    { data: instructors },
    { data: persons },
    { data: schedules },
  ] = await Promise.all([
    supabase.from("disciplines").select("id,name,active").eq("studio_id", studio.id).order("name"),
    supabase
      .from("class_templates")
      .select(
        "id,name,duration_minutes,capacity,discipline_id,credit_cost,drop_in_price_minor,color_hex",
      )
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("spaces")
      .select("id,name,capacity,site_id")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("instructors")
      .select("id,person_id,status")
      .eq("studio_id", studio.id)
      .eq("status", "active")
      .eq("teaches", true),
    supabase.from("persons").select("id,first_name,last_name").eq("studio_id", studio.id),
    supabase
      .from("recurring_schedules")
      .select("id,template_id,weekday,local_time,instructor_id,space_id,capacity,active")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("weekday"),
  ]);

  if (canEdit && schedules?.length && weekAfterKey >= todayKey) {
    await Promise.all(
      schedules.map((schedule) =>
        supabase.rpc("materialize_recurring_schedule", {
          p_schedule_id: schedule.id,
          p_through: weekAfterKey,
        }),
      ),
    );
  }

  const instructorOnly = can(CAPABILITIES.INSTRUCTOR_PORTAL) && !can(CAPABILITIES.ADMIN_PORTAL);
  const currentInstructor = instructorOnly
    ? (instructors ?? []).find((item) => item.person_id === membership.person_id)
    : null;
  let sessionsQuery = supabase
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,capacity,status,notes,template_id,space_id,instructor_id,recurring_schedule_id,is_schedule_exception,cancellation_reason,cancelled_at,cancelled_by_label,credit_cost,drop_in_price_minor,drop_in_price_overridden",
    )
    .eq("studio_id", studio.id)
    .gte("starts_at", weekStartUtc.toISOString())
    .lt("starts_at", weekAfterUtc.toISOString())
    .order("starts_at", { ascending: true });
  if (instructorOnly)
    sessionsQuery = sessionsQuery.eq(
      "instructor_id",
      currentInstructor?.id ?? "00000000-0000-0000-0000-000000000000",
    );
  const selectedCoach =
    !instructorOnly && (instructors ?? []).some((item) => item.id === params.coach)
      ? params.coach!
      : "";
  if (selectedCoach) sessionsQuery = sessionsQuery.eq("instructor_id", selectedCoach);
  const { data: sessions } = await sessionsQuery;

  const sessionIds = (sessions ?? []).map((session) => session.id);
  const { data: reservations } = sessionIds.length
    ? await supabase
        .from("reservations")
        .select("id,session_id,status")
        .in("session_id", sessionIds)
        .in("status", ["reserved", "attended", "no_show"])
    : { data: [] as { id: string; session_id: string; status: string }[] };

  const disciplineMap = new Map((disciplines ?? []).map((item) => [item.id, item.name]));
  const templateMap = new Map((templates ?? []).map((item) => [item.id, item]));
  const spaceMap = new Map((spaces ?? []).map((item) => [item.id, item.name]));
  const personMap = new Map(
    (persons ?? []).map((item) => [
      item.id,
      [item.first_name, item.last_name].filter(Boolean).join(" "),
    ]),
  );
  const instructorMap = new Map(
    (instructors ?? []).map((item) => [item.id, personMap.get(item.person_id) ?? "Instructor"]),
  );

  const occupiedBySession = new Map<string, number>();
  for (const reservation of reservations ?? []) {
    if (!isSeatOccupyingReservation(reservation.status)) continue;
    occupiedBySession.set(
      reservation.session_id,
      (occupiedBySession.get(reservation.session_id) ?? 0) + 1,
    );
  }

  const calendarSessions = (sessions ?? []).map((session) => {
    const startParts = localClockParts(session.starts_at, timeZone);
    const durationMinutes = Math.max(
      Math.round(
        (new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60_000,
      ),
      30,
    );
    const startMinute = startParts.hour * 60 + startParts.minute;
    const template = templateMap.get(session.template_id);
    return {
      ...session,
      dateKey: startParts.dateKey,
      startMinute,
      durationMinutes,
      name: template?.name ?? "Clase",
      color: template?.color_hex ?? "#FF0A8A",
      instructor: session.instructor_id
        ? (instructorMap.get(session.instructor_id) ?? "Instructor")
        : "Sin instructor",
      space: session.space_id ? (spaceMap.get(session.space_id) ?? "Espacio") : "Sin espacio",
      occupied: occupiedBySession.get(session.id) ?? 0,
    };
  });

  const earliestMinute = calendarSessions.length
    ? Math.min(...calendarSessions.map((session) => session.startMinute))
    : 7 * 60;
  const latestMinute = calendarSessions.length
    ? Math.max(...calendarSessions.map((session) => session.startMinute + session.durationMinutes))
    : 22 * 60;
  const calendarStartHour = Math.max(0, Math.min(7, Math.floor(earliestMinute / 60)));
  const calendarEndHour = Math.min(24, Math.max(22, Math.ceil(latestMinute / 60)));
  const calendarHeight = (calendarEndHour - calendarStartHour) * 60;
  const hourLabels = Array.from(
    { length: calendarEndHour - calendarStartHour + 1 },
    (_, index) => calendarStartHour + index,
  );

  const selectedSession = params.session
    ? (calendarSessions.find((session) => session.id === params.session) ?? null)
    : null;
  const selectedTemplate = selectedSession
    ? (templateMap.get(selectedSession.template_id) ?? null)
    : null;
  const selectedSessionPrice = selectedSession?.drop_in_price_overridden
    ? selectedSession.drop_in_price_minor
    : (selectedSession?.drop_in_price_minor ?? selectedTemplate?.drop_in_price_minor ?? null);
  const selectedLocalInput = selectedSession
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .format(new Date(selectedSession.starts_at))
        .replace(" ", "T")
    : "";

  const returnTo = selectedSession
    ? `/admin/agenda?date=${selectedKey}&session=${selectedSession.id}`
    : `/admin/agenda?date=${selectedKey}`;

  const errorCopy: Record<string, string> = {
    conflict: "El instructor o espacio ya está ocupado en ese horario.",
    space: "El espacio no admite ese cupo.",
    instructor: "Selecciona un instructor activo.",
    schedule: "No se pudo crear el horario recurrente.",
    activity: "No se pudo crear la actividad. Revisa también el precio de clase suelta.",
    color: "No se pudo guardar el color de la actividad.",
    edit: "No se pudieron guardar los cambios de la sesión.",
  };

  return (
    <main className="portal-page dashboard-shell agenda-calendar-page">
      <header className="agenda-product-header">
        <div className="agenda-product-wordmark" aria-label="Studio Flow">
          <span>
            STUDIO <b>FLOW</b>
          </span>
          <small>MOVIMIENTO QUE TRANSFORMA</small>
        </div>
        <span className="agenda-product-avatar" aria-label={headerName}>
          {headerInitials}
        </span>
      </header>

      <header className="agenda-calendar-header">
        <div>
          <p className="eyebrow">AGENDA · {studio.name}</p>
          <h1>Agenda</h1>
          <p>Sesiones generadas desde Actividades. Toca una para editarla.</p>
        </div>
        <div className="agenda-header-actions">
          <Link
            className="agenda-icon-button"
            href={`/admin/agenda?date=${previousWeekKey}${selectedCoach ? `&coach=${selectedCoach}` : ""}`}
            aria-label="Semana anterior"
          >
            ‹
          </Link>
          <strong className="agenda-week-range">
            {weekStart.getUTCDate()} {shortMonth(weekStart, locale)} — {weekEnd.getUTCDate()}{" "}
            {shortMonth(weekEnd, locale)}
          </strong>
          <Link
            className="agenda-icon-button"
            href={`/admin/agenda?date=${nextWeekKey}${selectedCoach ? `&coach=${selectedCoach}` : ""}`}
            aria-label="Semana siguiente"
          >
            ›
          </Link>
          <Link className="agenda-today-button" href={`/admin/agenda?date=${todayKey}`}>
            Hoy
          </Link>
          {canEdit ? (
            <Link className="agenda-config-button" href="/admin/configuracion/festivos">
              Festivos
            </Link>
          ) : null}
          {canEdit ? (
            <Link className="agenda-config-button" href="/admin/actividades">
              Actividades
            </Link>
          ) : null}
        </div>
      </header>

      <div className="portal-agenda-controls">
        <p>
          {calendarSessions.filter((item) => item.status !== "cancelled").length} clases ·{" "}
          {calendarSessions.filter((item) => item.is_schedule_exception).length} editadas a mano ·{" "}
          {calendarSessions.filter((item) => item.status === "cancelled").length} canceladas
        </p>
        {instructorOnly ? (
          <span>
            Tus clases · {currentInstructor ? instructorMap.get(currentInstructor.id) : "Coach"}
          </span>
        ) : (
          <CoachFilter
            value={selectedCoach}
            coaches={(instructors ?? []).map((coach) => ({
              id: coach.id,
              name: instructorMap.get(coach.id) ?? "Coach",
            }))}
          />
        )}
      </div>
      {params.created ? (
        <div className="notice success">
          {params.created === "schedule"
            ? "Horario recurrente creado. Las próximas sesiones ya están disponibles."
            : params.created === "cancel-session"
              ? "Clase cancelada correctamente."
              : "Cambio guardado correctamente."}
        </div>
      ) : null}
      {params.error ? (
        <div className="notice error">
          {errorCopy[decodeURIComponent(params.error)] ?? "No se pudo guardar. Revisa los datos."}
        </div>
      ) : null}

      <div className={`agenda-workspace${selectedSession ? " has-editor" : ""}`}>
        <section
          id="clases-programadas"
          className="agenda-calendar-shell"
          aria-label="Calendario semanal"
        >
          <nav className="agenda-week-strip" aria-label="Semana seleccionada">
            <span aria-hidden="true" />
            {weekDays.map((day) => {
              const key = utcDateKey(day);
              const isSelected = key === selectedKey;
              return (
                <Link
                  href={`/admin/agenda?date=${key}`}
                  key={key}
                  className={`agenda-week-day${isSelected ? " is-selected" : ""}${key === todayKey ? " is-today" : ""}`}
                  aria-current={isSelected ? "date" : undefined}
                >
                  <span>{shortWeekday(day, locale)}</span>
                  <strong>{day.getUTCDate()}</strong>
                </Link>
              );
            })}
          </nav>

          <div className="agenda-mobile-day-summary">
            <strong>{fullDateLabel(selectedDate, locale)}</strong>
            <span>
              {calendarSessions.filter((session) => session.dateKey === selectedKey).length} clases
            </span>
          </div>

          <div
            className="agenda-week-calendar"
            style={{ "--agenda-calendar-height": `${calendarHeight}px` } as React.CSSProperties}
          >
            <div className="agenda-time-axis" style={{ height: calendarHeight }}>
              {hourLabels.map((hour) => (
                <span
                  key={hour}
                  style={{ top: (hour - calendarStartHour) * 60 }}
                  className="agenda-time-label"
                >
                  {formatHour(hour, locale)}
                </span>
              ))}
            </div>

            <div className="agenda-day-columns">
              {weekDays.map((day) => {
                const key = utcDateKey(day);
                const daySessions = calendarSessions.filter((session) => session.dateKey === key);
                return (
                  <div
                    className={`agenda-day-column${key === selectedKey ? " is-selected-day" : ""}`}
                    key={key}
                    style={{ height: calendarHeight }}
                  >
                    <div className="agenda-hour-lines" aria-hidden="true">
                      {hourLabels.slice(0, -1).map((hour) => (
                        <i key={hour} style={{ top: (hour - calendarStartHour) * 60 }} />
                      ))}
                    </div>
                    {daySessions.map((session) => {
                      const top = session.startMinute - calendarStartHour * 60;
                      const height = Math.max(session.durationMinutes, 44);
                      const isSelected = selectedSession?.id === session.id;
                      const isPast = new Date(session.ends_at) <= now;
                      return (
                        <Link
                          key={session.id}
                          href={`/admin/agenda?date=${key}&session=${session.id}`}
                          aria-label={`${session.name}, ${formatTime(session.starts_at, timeZone, locale)}, ${session.occupied} de ${session.capacity}${session.status === "cancelled" ? `, cancelada: ${session.cancellation_reason ?? "Cancelada por el estudio"}` : ""}${session.is_schedule_exception ? ", editada a mano" : ""}`}
                          className={`agenda-session-block${isPast ? " is-past" : ""}${isSelected ? " is-selected" : ""}${session.status === "cancelled" ? " is-cancelled" : ""}`}
                          style={
                            {
                              top,
                              height,
                              "--agenda-session-color": session.color,
                            } as React.CSSProperties
                          }
                        >
                          <strong>{session.name}</strong>
                          <span className="agenda-session-time">
                            {formatTime(session.starts_at, timeZone, locale)} ·{" "}
                            {session.status === "cancelled"
                              ? (session.cancellation_reason ?? "Cancelada")
                              : `${session.occupied}/${session.capacity}`}
                          </span>
                          {session.is_schedule_exception ? (
                            <span className="portal-edited-dot" title="Editada a mano" />
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {!calendarSessions.length ? (
            <div className="agenda-calendar-empty">No hay clases programadas para esta semana.</div>
          ) : null}
        </section>

        {selectedSession ? (
          <aside className="agenda-session-editor">
            <div className="agenda-editor-heading">
              <div>
                <small>EDITAR SESIÓN</small>
                <h2>{selectedSession.name}</h2>
                <p>
                  {selectedSession.instructor} · {selectedSession.space}
                </p>
              </div>
              <div className="agenda-editor-capacity">
                <strong>
                  {selectedSession.occupied}/{selectedSession.capacity}
                </strong>
                <small>cupos</small>
              </div>
              <Link
                className="agenda-editor-close"
                href={`/admin/agenda?date=${selectedKey}`}
                aria-label="Cerrar edición"
              >
                ×
              </Link>
            </div>

            <div className="agenda-editor-status">
              <span
                style={{ "--agenda-session-color": selectedSession.color } as React.CSSProperties}
              />
              <strong>{statusLabel(selectedSession.status)}</strong>
              {selectedSession.is_schedule_exception ? <em>Excepción</em> : null}
            </div>

            {selectedSession.status === "cancelled" ? (
              <div className="notice error">
                <b>
                  Motivo: {selectedSession.cancellation_reason ?? "Clase cancelada por el estudio"}
                </b>
                <p>
                  Canceló {selectedSession.cancelled_by_label ?? "Automático"}
                  {selectedSession.cancelled_at
                    ? ` · ${new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(selectedSession.cancelled_at))}`
                    : ""}
                </p>
                {canEdit && new Date(selectedSession.starts_at) > now ? (
                  <form action={reopenSession}>
                    <input type="hidden" name="session_id" value={selectedSession.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <button className="primary-button">Reabrir clase</button>
                    <p>Las reservas canceladas no se restauran.</p>
                  </form>
                ) : null}
              </div>
            ) : null}
            {selectedSession.status !== "cancelled" && new Date(selectedSession.ends_at) <= now ? (
              <p>Ya no se puede reprogramar. Puedes revisar o corregir la asistencia.</p>
            ) : null}
            {canEdit &&
            selectedSession.status === "scheduled" &&
            new Date(selectedSession.starts_at) > now ? (
              <>
                <form action={updateSession} className="agenda-editor-form">
                  <input type="hidden" name="session_id" value={selectedSession.id} />
                  <input type="hidden" name="return_to" value={returnTo} />

                  <div className="portal-session-fields">
                    <label>
                      Duración (min)
                      <input
                        type="number"
                        name="duration_minutes"
                        min="15"
                        max="360"
                        step="15"
                        defaultValue={selectedSession.durationMinutes}
                        required
                      />
                    </label>
                    <label>
                      Créditos por reserva
                      <select
                        name="credit_cost"
                        defaultValue={
                          selectedSession.credit_cost ?? selectedTemplate?.credit_cost ?? 1
                        }
                      >
                        {[1, 2, 3, 4].map((n) => (
                          <option value={n} key={n}>
                            {n} crédito{n > 1 ? "s" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="agenda-editor-field">
                    Precio de clase suelta
                    <input
                      name="drop_in_price"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        selectedSessionPrice == null ? "" : (selectedSessionPrice ?? 0) / 100
                      }
                      placeholder="Sin venta suelta"
                    />
                  </label>
                  {selectedSession.occupied ? (
                    <p className="helper">
                      Las {selectedSession.occupied} reservas que ya existen conservan lo que
                      descontaron; un cambio de créditos aplica a reservas nuevas.
                    </p>
                  ) : null}
                  <label className="agenda-editor-field">
                    <span>Horario</span>
                    <input
                      name="starts_at"
                      type="datetime-local"
                      defaultValue={selectedLocalInput}
                      required
                    />
                  </label>

                  <label className="agenda-editor-field">
                    <span>Coach</span>
                    <select name="instructor_id" defaultValue={selectedSession.instructor_id ?? ""}>
                      <option value="">Sin instructor</option>
                      {instructors?.map((instructor) => (
                        <option key={instructor.id} value={instructor.id}>
                          {instructorMap.get(instructor.id)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="agenda-editor-field">
                    <span>Espacio</span>
                    <select name="space_id" defaultValue={selectedSession.space_id ?? ""}>
                      <option value="">Sin espacio</option>
                      {spaces?.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.name}
                          {space.capacity ? ` · máx. ${space.capacity}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="agenda-editor-field">
                    <span>Cupo</span>
                    <input
                      name="capacity"
                      type="number"
                      min="1"
                      defaultValue={selectedSession.capacity}
                      required
                    />
                  </label>

                  <label className="agenda-editor-notes">
                    <span>Notas</span>
                    <textarea name="notes" rows={3} defaultValue={selectedSession.notes ?? ""} />
                  </label>

                  {selectedSession.recurring_schedule_id ? (
                    <fieldset className="agenda-editor-scope">
                      <legend>Aplicar a</legend>
                      <label>
                        <input type="radio" name="scope" value="single" defaultChecked />
                        <span>Solo esta sesión</span>
                      </label>
                      <label>
                        <input type="radio" name="scope" value="future" />
                        <span>Esta y siguientes</span>
                      </label>
                    </fieldset>
                  ) : (
                    <input type="hidden" name="scope" value="single" />
                  )}

                  <div className="agenda-editor-shortcuts" aria-label="Campos editables">
                    <span>Cambiar horario</span>
                    <span>Cambiar coach</span>
                    <span>Cambiar espacio</span>
                  </div>

                  <button className="agenda-save-button" type="submit">
                    Guardar cambios
                  </button>

                  <label className="grid gap-2">
                    <span>Motivo para cancelar la clase</span>
                    <textarea
                      name="reason"
                      maxLength={500}
                      placeholder="Necesario solo para cancelar"
                    />
                  </label>
                  <button
                    className="agenda-cancel-button"
                    type="submit"
                    formAction={cancelSession}
                    formNoValidate
                  >
                    Cancelar clase
                  </button>
                </form>

                <Link
                  className="agenda-open-detail"
                  href={`/admin/agenda/${selectedSession.id}?from=${selectedKey}`}
                >
                  Abrir operación completa
                </Link>
              </>
            ) : (
              <div className="agenda-editor-readonly">
                Esta sesión ya no admite cambios de programación.
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </main>
  );
}
