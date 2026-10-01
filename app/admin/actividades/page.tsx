import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function formatMoney(minor: number | null, locale: string, currency: string) {
  if (minor == null) return null;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function ActivityIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h4l2.5-5 4 10 2.5-5H21" />
    </svg>
  );
}

export default async function ActivitiesPage() {
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

  const activeActivities = (activities ?? []).filter((item) => item.active);
  const inactiveActivities = (activities ?? []).filter((item) => !item.active);

  const renderActivity = (activity: (typeof activeActivities)[number]) => {
    const activitySchedules = schedulesByActivity.get(activity.id) ?? [];
    const firstSchedules = activitySchedules.slice(0, 3);

    return (
      <Link
        className={`activities-v2-card${activity.active ? "" : " is-inactive"}`}
        href={`/admin/actividades/${activity.id}`}
        key={activity.id}
      >
        <span
          className="activities-v2-card-icon"
          style={{
            background: `${activity.color_hex ?? "#17A878"}18`,
            color: activity.color_hex ?? "#17A878",
          }}
        >
          <ActivityIcon />
        </span>

        <span className="activities-v2-card-main">
          <span className="activities-v2-card-title">
            <strong>{activity.name}</strong>
            <small>{activity.active ? "Activa" : "Inactiva"}</small>
          </span>

          <span className="activities-v2-card-description">
            {activity.description || "Sin descripción."}
          </span>

          <span className="activities-v2-schedule-row">
            {firstSchedules.length ? (
              firstSchedules.map((schedule) => (
                <span key={schedule.id}>
                  {DAYS[schedule.weekday]} · {String(schedule.local_time).slice(0, 5)}
                </span>
              ))
            ) : (
              <span>Sin horarios activos</span>
            )}
            {activitySchedules.length > 3 ? <span>+{activitySchedules.length - 3}</span> : null}
          </span>

          <span className="activities-v2-card-meta">
            <span>{activity.duration_minutes} min</span>
            <span>{activity.capacity} lugares</span>
            {activity.requires_resource ? <span>Usa recurso</span> : null}
            <span>
              {activity.drop_in_price_minor != null
                ? `${formatMoney(activity.drop_in_price_minor, studio.locale, studio.currency)} individual`
                : "Solo paquete/créditos"}
            </span>
          </span>
        </span>

        <span className="activities-v2-chevron" aria-hidden="true">
          ›
        </span>
      </Link>
    );
  };

  return (
    <main className="activities-v2 activities-page">
      <header className="activities-v2-header">
        <div>
          <h1>Actividades</h1>
          <p>Define qué clases, cursos o sesiones ofrece el estudio y cuándo suceden.</p>
        </div>
        {canEdit ? (
          <Link className="activities-v2-primary" href="/admin/actividades/nueva">
            <span aria-hidden="true">＋</span> Nueva actividad
          </Link>
        ) : null}
      </header>

      <section className="activities-v2-section">
        <div className="activities-v2-section-heading">
          <div>
            <h2>Activas</h2>
            <p>Las que actualmente pueden generar sesiones y reservas.</p>
          </div>
          <span>{activeActivities.length}</span>
        </div>

        {activeActivities.length ? (
          <div className="activities-v2-list">{activeActivities.map(renderActivity)}</div>
        ) : (
          <div className="activities-v2-empty">
            <strong>Aún no hay actividades activas</strong>
            <p>Crea una para comenzar a generar sesiones en la Agenda.</p>
          </div>
        )}
      </section>

      {inactiveActivities.length ? (
        <details className="activities-v2-inactive">
          <summary>
            <span>Inactivas</span>
            <span>{inactiveActivities.length}</span>
          </summary>
          <div className="activities-v2-list">{inactiveActivities.map(renderActivity)}</div>
        </details>
      ) : null}
    </main>
  );
}
