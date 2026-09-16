import Link from "next/link";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { agendaLookbackIso } from "@/lib/time";
import { createDiscipline } from "./actions";
import { createActivity, createRecurringSchedules } from "./recurring-actions";
import { ScheduleBuilder } from "./schedule-builder";

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(minor: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(minor / 100);
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const params = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.SCHEDULE_READ);
  const canEdit = can(CAPABILITIES.SCHEDULE_WRITE);
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
      .select("id,name,duration_minutes,capacity,discipline_id,credit_cost,drop_in_price_minor")
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
      .eq("status", "active"),
    supabase.from("persons").select("id,first_name,last_name").eq("studio_id", studio.id),
    supabase
      .from("recurring_schedules")
      .select("id,template_id,weekday,local_time,instructor_id,space_id,capacity,active")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("weekday"),
  ]);
  if (canEdit)
    for (const schedule of schedules ?? [])
      await supabase.rpc("materialize_recurring_schedule", {
        p_schedule_id: schedule.id,
        p_through: null,
      });
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,capacity,status,template_id,space_id,instructor_id,recurring_schedule_id,is_schedule_exception",
    )
    .eq("studio_id", studio.id)
    .gte("starts_at", agendaLookbackIso())
    .order("starts_at", { ascending: true })
    .limit(80);
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
  const timeZone = studio.timezone ?? "America/Mexico_City";
  const errorCopy: Record<string, string> = {
    conflict: "Hay un conflicto de instructor o espacio en uno de los horarios.",
    space: "El espacio no admite ese cupo.",
    instructor: "Selecciona un instructor activo.",
    schedule: "No se pudo crear el horario recurrente.",
    activity: "No se pudo crear la actividad. Revisa también el precio de clase suelta.",
  };
  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin">
            ← Hoy
          </Link>
          <p className="eyebrow">AGENDA · {studio.name}</p>
          <h1 className="dashboard-title">Agenda</h1>
          <p>
            Define actividades una vez y programa horarios que continúan hasta que los desactives.
          </p>
        </div>
      </header>
      {params.created ? (
        <div className="notice success">
          {params.created === "schedule"
            ? "Horario recurrente creado. Las próximas sesiones ya están disponibles."
            : "Cambio guardado correctamente."}
        </div>
      ) : null}
      {params.error ? (
        <div className="notice error">
          {errorCopy[params.error] ?? "No se pudo guardar. Revisa los datos."}
        </div>
      ) : null}
      <section className="agenda-layout">
        <div className="agenda-main">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">PRÓXIMAS SESIONES</p>
                <h2>Clases programadas</h2>
              </div>
              <span className="count-badge">{sessions?.length ?? 0}</span>
            </div>
            {!sessions?.length ? (
              <div className="empty-state">Aún no hay sesiones programadas.</div>
            ) : (
              <div className="session-list">
                {sessions.map((session) => {
                  const template = templateMap.get(session.template_id);
                  return (
                    <Link
                      className="session-row"
                      href={`/admin/agenda/${session.id}`}
                      key={session.id}
                    >
                      <div className="session-time">
                        <strong>{formatDateTime(session.starts_at, timeZone)}</strong>
                        <span>
                          {formatDateTime(session.ends_at, timeZone).split(",").pop()?.trim()}
                        </span>
                      </div>
                      <div className="session-copy">
                        <strong>{template?.name ?? "Clase"}</strong>
                        <span>
                          {template ? disciplineMap.get(template.discipline_id) : "Sin disciplina"}{" "}
                          ·{" "}
                          {session.space_id
                            ? (spaceMap.get(session.space_id) ?? "Espacio")
                            : "Sin espacio"}{" "}
                          ·{" "}
                          {session.instructor_id
                            ? (instructorMap.get(session.instructor_id) ?? "Instructor")
                            : "Sin instructor"}
                        </span>
                        {template?.drop_in_price_minor != null ? (
                          <small>Clase suelta · {formatMoney(template.drop_in_price_minor)}</small>
                        ) : session.recurring_schedule_id ? (
                          <small>
                            {session.is_schedule_exception
                              ? "Excepción de horario"
                              : "Horario recurrente"}
                          </small>
                        ) : (
                          <small>Sesión individual</small>
                        )}
                      </div>
                      <div className="session-meta">
                        <span>{session.capacity} lugares</span>
                        <span className="status-pill">{session.status}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </article>
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">HORARIOS ACTIVOS</p>
                <h2>Programación semanal</h2>
              </div>
              <span className="count-badge">{schedules?.length ?? 0}</span>
            </div>
            {!schedules?.length ? (
              <div className="empty-state">No hay horarios recurrentes activos.</div>
            ) : (
              <div className="student-list">
                {schedules.map((schedule) => (
                  <div className="student-row" key={schedule.id}>
                    <div>
                      <strong>{templateMap.get(schedule.template_id)?.name ?? "Actividad"}</strong>
                      <span>
                        {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][schedule.weekday]} ·{" "}
                        {String(schedule.local_time).slice(0, 5)} ·{" "}
                        {schedule.instructor_id
                          ? instructorMap.get(schedule.instructor_id)
                          : "Sin instructor"}
                      </span>
                    </div>
                    <span>{schedule.capacity} lugares</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
        <aside className="agenda-sidebar">
          {!canEdit ? (
            <article className="panel">
              <p>Puedes consultar la agenda, pero no modificarla.</p>
            </article>
          ) : (
            <>
              <article className="panel compact-panel">
                <p className="eyebrow">1 · DISCIPLINA</p>
                <h2>Nueva disciplina</h2>
                <form action={createDiscipline} className="compact-form">
                  <input name="name" required placeholder="Ej. Pole Fitness" />
                  <button className="primary-button" type="submit">
                    Agregar
                  </button>
                </form>
              </article>
              <article className="panel compact-panel">
                <p className="eyebrow">2 · ACTIVIDAD</p>
                <h2>Crear actividad</h2>
                <p>
                  La actividad define qué clase es; después podrás reutilizarla en todos sus
                  horarios.
                </p>
                <form action={createActivity} className="compact-form">
                  <input name="name" required placeholder="Ej. Exotic" />
                  <select name="discipline_id" required defaultValue="">
                    <option value="" disabled>
                      Disciplina
                    </option>
                    {disciplines
                      ?.filter((item) => item.active)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                  <div className="form-split">
                    <label>
                      Duración (min)
                      <input
                        name="duration_minutes"
                        type="number"
                        min="15"
                        max="360"
                        defaultValue="60"
                        required
                      />
                    </label>
                    <label>
                      Créditos
                      <input name="credit_cost" type="number" min="1" defaultValue="1" required />
                    </label>
                  </div>
                  <div className="form-split">
                    <label>
                      Cupo predeterminado
                      <input name="capacity" type="number" min="1" defaultValue="8" required />
                    </label>
                    <label>
                      Precio clase suelta (MXN)
                      <input
                        name="drop_in_price"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="Opcional"
                      />
                    </label>
                  </div>
                  <button className="primary-button" type="submit" disabled={!disciplines?.length}>
                    Crear actividad
                  </button>
                </form>
              </article>
              <article className="panel compact-panel">
                <p className="eyebrow">3 · HORARIO RECURRENTE</p>
                <h2>Programar actividad</h2>
                <p>
                  Agrega todos los días y horas que necesites. No tiene fecha final: continuará
                  hasta que lo desactives.
                </p>
                <form action={createRecurringSchedules} className="compact-form">
                  <select name="template_id" required defaultValue="">
                    <option value="" disabled>
                      Actividad
                    </option>
                    {templates?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.duration_minutes} min · {item.credit_cost} crédito
                        {item.credit_cost === 1 ? "" : "s"}
                        {item.drop_in_price_minor != null
                          ? ` · Suelta ${formatMoney(item.drop_in_price_minor)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <label>
                    Comenzar desde
                    <input name="starts_on" type="date" required />
                  </label>
                  <ScheduleBuilder
                    defaultCapacity={templates?.[0]?.capacity ?? 8}
                    instructors={(instructors ?? []).map((item) => ({
                      id: item.id,
                      label: personMap.get(item.person_id) ?? "Instructor",
                    }))}
                    spaces={(spaces ?? []).map((item) => ({
                      id: item.id,
                      label: item.name,
                      capacity: item.capacity,
                    }))}
                  />
                  <textarea name="notes" rows={2} placeholder="Notas opcionales" />
                  <button className="primary-button" type="submit" disabled={!templates?.length}>
                    Guardar horario
                  </button>
                </form>
              </article>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
