import Link from "next/link";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { agendaLookbackIso } from "@/lib/time";
import { createDiscipline, createSession, createTemplate } from "./actions";

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
    { data: locations },
    { data: sessions },
  ] = await Promise.all([
    supabase
      .from("disciplines")
      .select("id, name, active")
      .eq("studio_id", studio.id)
      .order("name"),
    supabase
      .from("class_templates")
      .select("id, name, duration_minutes, capacity, discipline_id")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("studio_locations")
      .select("id, name, address")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("class_sessions")
      .select("id, starts_at, ends_at, capacity, status, notes, template_id, location_id")
      .eq("studio_id", studio.id)
      .gte("starts_at", agendaLookbackIso())
      .order("starts_at", { ascending: true })
      .limit(30),
  ]);

  const disciplineMap = new Map((disciplines ?? []).map((item) => [item.id, item.name]));
  const templateMap = new Map((templates ?? []).map((item) => [item.id, item]));
  const locationMap = new Map((locations ?? []).map((item) => [item.id, item.name]));
  const timeZone = studio.timezone ?? "America/Mexico_City";

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin">
            ← Hoy
          </Link>
          <p className="eyebrow">AGENDA · {studio.name}</p>
          <h1 className="dashboard-title">Calendario</h1>
          <p>Configura disciplinas y tipos de clase, y programa sesiones reales.</p>
        </div>
      </header>

      {params.created ? <div className="notice success">Cambio guardado correctamente.</div> : null}
      {params.error ? (
        <div className="notice error">
          No se pudo guardar. Revisa los datos e inténtalo de nuevo.
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

            {(sessions?.length ?? 0) === 0 ? (
              <div className="empty-state">
                Aún no hay sesiones programadas. Crea una disciplina, un tipo de clase y después
                agenda la primera sesión.
              </div>
            ) : (
              <div className="session-list">
                {sessions?.map((session) => {
                  const template = templateMap.get(session.template_id);
                  return (
                    <div className="session-row" key={session.id}>
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
                          {session.location_id
                            ? (locationMap.get(session.location_id) ?? "Ubicación")
                            : "Sin ubicación"}
                        </span>
                      </div>
                      <div className="session-meta">
                        <span>{session.capacity} lugares</span>
                        <span className="status-pill">{session.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </div>

        <aside className="agenda-sidebar">
          {!canEdit ? (
            <article className="panel">
              <p>Puedes consultar la agenda, pero no tienes permiso para modificarla.</p>
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
                <p className="eyebrow">2 · TIPO DE CLASE</p>
                <h2>Nueva plantilla</h2>
                <form action={createTemplate} className="compact-form">
                  <input name="name" required placeholder="Ej. Pole Fitness Básico" />
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
                    <input
                      name="duration_minutes"
                      type="number"
                      min="15"
                      max="360"
                      defaultValue="60"
                      required
                      aria-label="Duración en minutos"
                    />
                    <input
                      name="capacity"
                      type="number"
                      min="1"
                      defaultValue="8"
                      required
                      aria-label="Capacidad"
                    />
                  </div>
                  <button className="primary-button" type="submit" disabled={!disciplines?.length}>
                    Crear tipo
                  </button>
                </form>
              </article>

              <article className="panel compact-panel">
                <p className="eyebrow">3 · PROGRAMAR</p>
                <h2>Nueva sesión</h2>
                <form action={createSession} className="compact-form">
                  <select name="template_id" required defaultValue="">
                    <option value="" disabled>
                      Tipo de clase
                    </option>
                    {templates?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.duration_minutes} min
                      </option>
                    ))}
                  </select>
                  <select name="location_id" defaultValue={locations?.[0]?.id ?? ""}>
                    <option value="">Sin ubicación</option>
                    {locations?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <input
                    name="starts_at"
                    type="datetime-local"
                    required
                    aria-label="Fecha y hora"
                  />
                  <textarea name="notes" rows={3} placeholder="Notas opcionales" />
                  <button className="primary-button" type="submit" disabled={!templates?.length}>
                    Programar clase
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
