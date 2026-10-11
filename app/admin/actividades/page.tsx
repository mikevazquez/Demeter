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

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const inactive = query.status === "inactive";
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.SCHEDULE_READ);
  const canEdit = can(CAPABILITIES.SCHEDULE_WRITE);

  const [{ data: activities }, { data: schedules }] = await Promise.all([
    supabase
      .from("class_templates")
      .select(
        "id,name,description,duration_minutes,capacity,active,drop_in_price_minor,requires_resource,color_hex,minimum_reservations_enabled,minimum_reservations",
      )
      .eq("studio_id", studio.id)
      .order("active", { ascending: false })
      .order("name"),
    supabase
      .from("recurring_schedules")
      .select("id,template_id,weekday,local_time,active,instructor_id")
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

  const { data: coaches } = await supabase
    .from("instructors")
    .select("id,person_id")
    .eq("studio_id", studio.id);
  const personIds = (coaches ?? []).map((c) => c.person_id);
  const { data: people } = personIds.length
    ? await supabase
        .from("persons")
        .select("id,first_name,last_name")
        .eq("studio_id", studio.id)
        .in("id", personIds)
    : { data: [] };
  const names = new Map(
    (people ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ")]),
  );
  const coachNames = new Map((coaches ?? []).map((c) => [c.id, names.get(c.person_id)]));
  const activeActivities = (activities ?? []).filter((item) => item.active);
  const inactiveActivities = (activities ?? []).filter((item) => !item.active);

  const renderActivity = (activity: (typeof activeActivities)[number]) => {
    const activitySchedules = schedulesByActivity.get(activity.id) ?? [];
    const firstSchedules = activitySchedules;

    return (
      <Link
        className={`activities-v2-card${activity.active ? "" : " is-inactive"}`}
        href={`/admin/actividades/${activity.id}`}
        key={activity.id}
      >
        <span
          className="portal-activity-dot"
          style={{ background: activity.color_hex ?? "var(--green)" }}
          aria-hidden="true"
        />

        <span className="activities-v2-card-main">
          <span className="activities-v2-card-title">
            <strong>{activity.name}</strong>
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
          </span>

          <span className="activities-v2-card-meta">
            <span>
              {activity.duration_minutes} min · {activity.capacity} lugares
            </span>
            {activitySchedules[0]?.instructor_id ? (
              <span>{coachNames.get(activitySchedules[0].instructor_id) ?? "Coach"}</span>
            ) : null}
            {activity.minimum_reservations_enabled ? (
              <span>Mínimo {activity.minimum_reservations}</span>
            ) : null}
            {activity.requires_resource ? <span>Usa recurso</span> : null}
            <span>
              {activity.drop_in_price_minor != null
                ? `${formatMoney(activity.drop_in_price_minor, studio.locale, studio.currency)}`
                : "Solo paquete"}
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
    <main className="portal-page activities-v2 activities-page">
      <header className="activities-v2-header">
        <div>
          <h1>Actividades</h1>
          <p>Qué clases ofrece el estudio y cuándo suceden.</p>
        </div>
        {canEdit ? (
          <Link className="activities-v2-primary" href="/admin/actividades/nueva">
            <span aria-hidden="true">＋</span> Nueva actividad
          </Link>
        ) : null}
      </header>

      <nav className="portal-segmented" aria-label="Estado de actividades">
        <Link href="/admin/actividades" aria-current={!inactive ? "page" : undefined}>
          Activas · {activeActivities.length}
        </Link>
        <Link
          href="/admin/actividades?status=inactive"
          aria-current={inactive ? "page" : undefined}
        >
          Inactivas · {inactiveActivities.length}
        </Link>
      </nav>
      <section className="portal-activity-list">
        {(inactive ? inactiveActivities : activeActivities).map(renderActivity)}
        {!(inactive ? inactiveActivities : activeActivities).length ? (
          <p className="portal-empty">No hay actividades {inactive ? "inactivas" : "activas"}.</p>
        ) : null}
      </section>
    </main>
  );
}
