import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function formatMoney(minor: number | null) {
  if (minor == null) return null;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.SCHEDULE_READ);
  const canEdit = can(CAPABILITIES.SCHEDULE_WRITE);

  const [{ data: activities }, { data: schedules }] = await Promise.all([
    supabase
      .from("class_templates")
      .select(
        "id,name,description,duration_minutes,capacity,active,drop_in_price_minor,requires_resource,color_hex",
      )
      .eq("studio_id", studio.id)
      .order("active", { ascending: false })
      .order("name"),
    supabase
      .from("recurring_schedules")
      .select("id,template_id,weekday,local_time,active")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("weekday")
      .order("local_time"),
  ]);

  const schedulesByActivity = new Map<string, typeof schedules>();
  for (const schedule of schedules ?? []) {
    const current = schedulesByActivity.get(schedule.template_id) ?? [];
    current.push(schedule);
    schedulesByActivity.set(schedule.template_id, current);
  }

  return (
    <main className="dashboard-shell activities-page">
      <header className="activities-header">
        <div>
          <p className="eyebrow">ACTIVIDADES · {studio.name}</p>
          <h1>Actividades</h1>
          <p>
            Define qué ofreces, cuándo sucede y cómo puede reservarse. Agenda solo administra las
            sesiones resultantes.
          </p>
        </div>
        {canEdit ? (
          <Link className="activities-primary-action" href="/admin/actividades/nueva">
            + Nueva actividad
          </Link>
        ) : null}
      </header>

      {params.saved === "1" ? (
        <div className="notice success">Actividad guardada correctamente.</div>
      ) : null}
      {params.error ? <div className="notice error">No pudimos guardar la actividad.</div> : null}

      <section className="activities-summary-grid">
        <article>
          <span>ACTIVAS</span>
          <strong>{(activities ?? []).filter((item) => item.active).length}</strong>
          <small>actividades disponibles</small>
        </article>
        <article>
          <span>CON RECURSO</span>
          <strong>
            {(activities ?? []).filter((item) => item.active && item.requires_resource).length}
          </strong>
          <small>usan selección física</small>
        </article>
        <article>
          <span>HORARIOS</span>
          <strong>{schedules?.length ?? 0}</strong>
          <small>horarios recurrentes activos</small>
        </article>
      </section>

      <section className="activities-list-section">
        <div className="activities-section-heading">
          <div>
            <span>CATÁLOGO</span>
            <h2>Actividades configuradas</h2>
          </div>
        </div>

        {activities?.length ? (
          <div className="activities-list">
            {activities.map((activity) => {
              const activitySchedules = schedulesByActivity.get(activity.id) ?? [];
              const firstSchedules = activitySchedules.slice(0, 3);
              return (
                <Link
                  className={`activities-row${activity.active ? "" : " is-inactive"}`}
                  href={`/admin/actividades/${activity.id}`}
                  key={activity.id}
                >
                  <span
                    className="activities-row-accent"
                    style={{ background: activity.color_hex ?? "#FB0397" }}
                  />
                  <div className="activities-row-main">
                    <div className="activities-row-title">
                      <strong>{activity.name}</strong>
                      <span>{activity.active ? "Activa" : "Inactiva"}</span>
                    </div>
                    <p>{activity.description || "Sin descripción"}</p>
                    <div className="activities-row-schedules">
                      {firstSchedules.length ? (
                        firstSchedules.map((schedule) => (
                          <span key={schedule.id}>
                            {DAYS[schedule.weekday]} · {String(schedule.local_time).slice(0, 5)}
                          </span>
                        ))
                      ) : (
                        <span>Sin horarios activos</span>
                      )}
                      {activitySchedules.length > 3 ? (
                        <span>+{activitySchedules.length - 3} más</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="activities-row-meta">
                    <span>{activity.duration_minutes} min</span>
                    <span>{activity.capacity} lugares</span>
                    {activity.requires_resource ? <b>Recurso</b> : null}
                    {activity.drop_in_price_minor != null ? (
                      <b>{formatMoney(activity.drop_in_price_minor)} individual</b>
                    ) : (
                      <b>Solo créditos</b>
                    )}
                  </div>
                  <span className="activities-row-chevron">›</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="activities-empty">
            <strong>Aún no hay actividades</strong>
            <p>Crea la primera para comenzar a generar sesiones en Agenda.</p>
          </div>
        )}
      </section>
    </main>
  );
}
