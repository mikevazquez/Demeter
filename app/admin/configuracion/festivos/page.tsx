import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { CALENDAR_KIND_LABELS, shiftDate, type CalendarEvent } from "@/lib/holidays/calendar";
import CalendarCreationSheet from "./CalendarCreationSheet";
import CalendarEventEditor from "./CalendarEventEditor";
import { createCalendarEventAction } from "./actions";

function dateLabel(date: string, short = false) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: short ? "short" : "long",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
function eventState(
  event: CalendarEvent,
  decisions: { holiday_date: string; operation_mode: string }[],
  today: string,
) {
  const states = event.days
    .filter((day) => day.date >= today)
    .map((day) => decisions.find((d) => d.holiday_date === day.date)?.operation_mode);
  if (states.some((s) => !s)) return { label: "Por decidir", tone: "amber" };
  if (states.every((s) => s === "closed")) return { label: "Estudio cerrado", tone: "red" };
  if (states.every((s) => s === "normal")) return { label: "Abierto", tone: "green" };
  return { label: "Horario especial", tone: "blue" };
}
export default async function HolidaysConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    filter?: string;
    event?: string;
    new?: string;
    saved?: string;
    error?: string;
    source?: string;
  }>;
}) {
  const [query, ctx] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.SETTINGS_WRITE),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.studio.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const requested = Number(query.year);
  const year =
    Number.isInteger(requested) && requested >= 2026 && requested <= 2042
      ? requested
      : Number(today.slice(0, 4));
  const [eventsResult, decisionsResult, officialResult] = await Promise.all([
    ctx.supabase
      .from("calendar_events")
      .select("*")
      .or(`studio_id.is.null,studio_id.eq.${ctx.studio.id}`)
      .lte("starts_on", `${year}-12-31`)
      .gte("ends_on", `${year}-01-01`)
      .order("starts_on"),
    ctx.supabase
      .from("studio_holiday_overrides")
      .select("holiday_date,operation_mode,student_message,special_recurring_schedule_ids")
      .eq("studio_id", ctx.studio.id)
      .gte("holiday_date", `${year - 1}-12-01`)
      .lte("holiday_date", `${year + 1}-01-31`),
    ctx.supabase
      .from("official_holidays")
      .select("id,name,holiday_date,source_label,source_url,legal_basis,source_checked_at")
      .eq("country_code", "MX")
      .eq("is_official", true)
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`)
      .order("holiday_date"),
  ]);
  if (eventsResult.error || decisionsResult.error || officialResult.error)
    throw new Error("calendar_unavailable");
  const events = (eventsResult.data ?? []) as CalendarEvent[];
  const decisions = decisionsResult.data ?? [];
  const upcoming = events.filter((e) => e.ends_on >= today);
  const pending = upcoming.filter(
    (e) => eventState(e, decisions, today).label === "Por decidir",
  ).length;
  const filter = ["pending", "official", "periods", "studio"].includes(query.filter ?? "")
    ? query.filter
    : "all";
  const visible = upcoming.filter((e) =>
    filter === "pending"
      ? eventState(e, decisions, today).label === "Por decidir"
      : filter === "official"
        ? e.days.some((d) => d.official)
        : filter === "periods"
          ? e.days.length > 1
          : filter === "studio"
            ? e.kind === "propia"
            : true,
  );
  const selected = events.find((e) => e.id === query.event);
  const sessions = selected
    ? await ctx.supabase
        .from("class_sessions")
        .select("id,starts_at,status,template_id,instructor_id,recurring_schedule_id")
        .eq("studio_id", ctx.studio.id)
        .gte("starts_at", selected.starts_on + "T00:00:00Z")
        .lt("starts_at", shiftDate(selected.ends_on, 2) + "T00:00:00Z")
        .order("starts_at")
    : { data: [], error: null };
  if (sessions.error) throw new Error("calendar_sessions_unavailable");
  const ids = (sessions.data ?? []).map((s) => s.id);
  const [templatesResult, reservationsResult] = await Promise.all([
    selected
      ? ctx.supabase.from("class_templates").select("id,name").eq("studio_id", ctx.studio.id)
      : Promise.resolve({ data: [] }),
    ids.length
      ? ctx.supabase
          .from("reservations")
          .select("session_id")
          .eq("studio_id", ctx.studio.id)
          .in("session_id", ids)
          .in("status", ["reserved", "attended", "no_show"])
      : Promise.resolve({ data: [] }),
  ]);
  const templates = new Map((templatesResult.data ?? []).map((t) => [t.id, t.name]));
  const href = (extra: Record<string, string> = {}) =>
    `/admin/configuracion/festivos?${new URLSearchParams({ year: String(year), ...extra })}`;
  const errors: Record<string, string> = {
    calendar_event_overlap: "Se cruza con una fecha existente.",
    date_outside_horizon: "Elige una fecha dentro de los próximos 270 días.",
    name_required: "Escribe el nombre.",
    past_day: "No puedes cambiar la operación de un día pasado.",
    event_not_found: "No encontramos esa fecha.",
  };
  return (
    <main className="portal-page portal-holidays">
      <header className="portal-module-heading">
        <div>
          <Link className="flow-back" href="/admin/configuracion">
            ‹ Configuración
          </Link>
          <h1>{query.source ? "Calendario oficial" : "Días festivos"}</h1>
          <p>
            StudioFlow carga las fechas que se conmemoran en México. Tú decides si abres, cierras o
            das horario especial.
          </p>
        </div>
        <Link className="primary-button" href={href({ new: "1" })}>
          + Fecha propia
        </Link>
      </header>
      <nav className="portal-year-navigation" aria-label="Año">
        <Link className="ghost-button" href={href({ year: String(year - 1) })}>
          ‹
        </Link>
        <strong>{year}</strong>
        <Link className="ghost-button" href={href({ year: String(year + 1) })}>
          ›
        </Link>
      </nav>
      {query.error ? (
        <div className="notice error">
          {errors[query.error] ?? "No pudimos guardar. Revisa los datos."}
        </div>
      ) : null}
      {query.saved ? <div className="notice success">Decisión guardada.</div> : null}
      <Link
        className="portal-calendar-source"
        href={href(query.source ? {} : { source: "official" })}
      >
        <span aria-hidden="true">⚖</span>
        <span>
          <b>
            {query.source ? "Ver todas las fechas" : "Calendario oficial"} {year}–{year + 1}
          </b>
          <small>
            Gobierno de México · PROFEDET · Art. 74 LFT. Las que se recorren ya vienen en su lunes.
          </small>
        </span>
        <span aria-hidden="true">›</span>
      </Link>
      {query.source ? (
        <section className="portal-official-list">
          {(officialResult.data ?? []).map((h) => (
            <article className="card" key={h.id}>
              <h2>{h.name}</h2>
              <p>Descanso: {dateLabel(h.holiday_date)}</p>
              <p className="portal-muted">{h.legal_basis}</p>
              <a href={h.source_url} target="_blank" rel="noreferrer">
                Revisar fuente oficial
              </a>
            </article>
          ))}
        </section>
      ) : (
        <>
          <nav className="portal-segmented" aria-label="Filtrar fechas">
            {[
              ["all", "Todas"],
              ["pending", `Por decidir · ${pending}`],
              ["official", "Oficiales"],
              ["periods", "Periodos"],
              ["studio", "Del estudio"],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={href({ filter: key })}
                aria-current={filter === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          {!visible.length ? <p className="portal-empty">No hay fechas en este filtro.</p> : null}
          {Array.from(new Set(visible.map((e) => e.starts_on.slice(0, 7)))).map((month) => (
            <section className="portal-calendar-month" key={month}>
              <h2>
                {new Intl.DateTimeFormat("es-MX", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(month + "-15T12:00:00Z"))}
              </h2>
              {visible
                .filter((e) => e.starts_on.startsWith(month))
                .map((e) => {
                  const state = eventState(e, decisions, today);
                  return (
                    <Link
                      key={e.id}
                      href={href({ event: e.id, filter: filter ?? "all" })}
                      className="portal-calendar-event"
                      style={{ "--ha": e.accent } as React.CSSProperties}
                    >
                      <span className="portal-calendar-icon" aria-hidden="true">
                        {e.icon}
                      </span>
                      <span className="portal-calendar-copy">
                        <b>{e.name}</b>
                        <small>
                          {e.days.length > 1
                            ? `${dateLabel(e.starts_on, true)} – ${dateLabel(e.ends_on, true)} · ${e.days.length} días`
                            : dateLabel(e.starts_on)}
                        </small>
                        <span className="portal-calendar-tags">
                          <i>{CALENDAR_KIND_LABELS[e.kind]}</i>
                          {e.days.length > 1 ? <i>Periodo</i> : null}
                          {e.commemorated_on ? (
                            <i>Se conmemora el {dateLabel(e.commemorated_on, true)}</i>
                          ) : null}
                        </span>
                      </span>
                      <span className={`portal-badge is-${state.tone}`}>{state.label}</span>
                    </Link>
                  );
                })}
            </section>
          ))}
          <p className="portal-muted">
            Las fechas oficiales son descanso obligatorio. Las demás son cívicas, religiosas o
            tradiciones; el estudio puede abrir normal o dar clase temática.
          </p>
        </>
      )}
      {query.new ? (
        <CalendarCreationSheet year={year}>
          <p>Para un aniversario del estudio, evento, vacaciones del equipo o mantenimiento.</p>
          <form action={createCalendarEventAction} className="portal-calendar-form">
            <label>
              Nombre
              <input name="name" maxLength={160} placeholder="Ej. Aniversario Demeter" required />
            </label>
            <label>
              Empieza
              <input
                name="starts_on"
                type="date"
                min={today}
                max={shiftDate(today, 270)}
                required
              />
            </label>
            <label>
              Duración
              <select name="duration">
                {[1, 2, 3, 4, 5, 6, 7, 10, 14].map((n) => (
                  <option value={n} key={n}>
                    {n} día{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ícono
              <select name="icon">
                {["🎉", "🎂", "💃", "🌸", "✨", "🏆", "🎶", "🌙"].map((icon) => (
                  <option key={icon}>{icon}</option>
                ))}
              </select>
            </label>
            <button className="primary-button">Crear y configurar</button>
            <Link href={href()}>Cancelar</Link>
          </form>
        </CalendarCreationSheet>
      ) : null}
      {selected ? (
        <CalendarEventEditor
          event={selected}
          decisions={decisions}
          year={year}
          today={today}
          sessions={(sessions.data ?? [])
            .map((s) => ({
              id: s.id,
              date: new Intl.DateTimeFormat("en-CA", {
                timeZone: ctx.studio.timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(s.starts_at)),
              name: templates.get(s.template_id) ?? "Clase",
              time: new Intl.DateTimeFormat(ctx.studio.locale, {
                timeZone: ctx.studio.timezone,
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(s.starts_at)),
              reservations: (reservationsResult.data ?? []).filter((r) => r.session_id === s.id)
                .length,
              status: s.status,
            }))
            .filter((s) => selected.days.some((d) => d.date === s.date))}
        />
      ) : null}
    </main>
  );
}
