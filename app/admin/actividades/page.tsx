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

function ProgramIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h6" />
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
      .is("program_id", null)
      .is("workshop_offer_id", null)
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

  const { data: workshopData } = can("sales.read")
    ? await supabase.rpc("admin_workshop_context", { p_studio_id: studio.id })
    : { data: null };
  const workshopOffers = (workshopData?.offers ?? []) as {
    id: string;
    title: string;
    fullPriceMinor: number;
    sessionCount: number;
  }[];

  const { data: programs } = await supabase
    .from("activity_programs")
    .select("id,name,kind,description,active")
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: false });
  const programIds = (programs ?? []).map((program) => program.id);
  const { data: programSessions } = programIds.length
    ? await supabase
        .from("activity_program_sessions")
        .select("program_id")
        .eq("studio_id", studio.id)
        .in("program_id", programIds)
    : { data: [] };
  const sessionCountByProgram = new Map<string, number>();
  for (const session of programSessions ?? []) {
    sessionCountByProgram.set(
      session.program_id,
      (sessionCountByProgram.get(session.program_id) ?? 0) + 1,
    );
  }
  const activeActivities = (activities ?? []).filter((item) => item.active);
  const inactiveActivities = (activities ?? []).filter((item) => !item.active);

  // Synthetic UAT offers remain available for QA, but do not mix with operational workshops.
  const isUatOffer = (title: string) => /^UAT(?:[\s_-]|$)/i.test(title.trim());
  const operationalWorkshopOffers = workshopOffers.filter((offer) => !isUatOffer(offer.title));
  const uatWorkshopOffers = workshopOffers.filter((offer) => isUatOffer(offer.title));

  const renderWorkshopOffer = (offer: (typeof workshopOffers)[number]) => (
    <Link
      className="activities-v2-card"
      href={`/admin/actividades/talleres/${offer.id}`}
      key={offer.id}
    >
      <span className="activities-v2-card-icon program-card-icon is-workshop">
        <ProgramIcon />
      </span>
      <span className="activities-v2-card-main">
        <span className="activities-v2-card-title">
          <strong>{offer.title}</strong>
          <small>Taller</small>
        </span>
        <span className="activities-v2-card-description">
          {offer.sessionCount} fechas ·{" "}
          {formatMoney(offer.fullPriceMinor, studio.locale, studio.currency)} completo
        </span>
      </span>
      <span className="activities-v2-chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  );

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
            <h2>Talleres y eventos</h2>
            <p>Gestiona talleres configurables y eventos especiales.</p>
          </div>
          <Link href="/admin/actividades/talleres">Ver talleres →</Link>
        </div>
        {can("products.write") && can("schedule.write") ? (
          <p>
            <Link href="/admin/actividades/talleres/nuevo">＋ Nuevo taller</Link>
          </p>
        ) : null}
        <div className="activities-v2-list">
          {operationalWorkshopOffers.map(renderWorkshopOffer)}
          {(programs ?? []).filter((program) => !isUatOffer(program.name)).map((program) => (
            <Link
              className={`activities-v2-card${program.active ? "" : " is-inactive"}`}
              href={`/admin/actividades/programas/${program.id}`}
              key={program.id}
            >
              <span
                className={`activities-v2-card-icon program-card-icon ${program.kind === "event" ? "is-event" : "is-workshop"}`}
              >
                <ProgramIcon />
              </span>
              <span className="activities-v2-card-main">
                <span className="activities-v2-card-title">
                  <strong>{program.name}</strong>
                  <small>{program.active ? "Activo" : "Inactivo"}</small>
                </span>
                <span className="activities-v2-card-description">
                  {program.description || "Programa con fechas especiales."}
                </span>
                <span className="activities-v2-schedule-row">
                  <span>{sessionCountByProgram.get(program.id) ?? 0} fechas programadas</span>
                </span>
                <span className="activities-v2-card-meta">
                  <span>{program.kind === "event" ? "Evento especial" : "Taller / curso"}</span>
                  <span>Ver fechas, cupos y precios</span>
                </span>
              </span>
              <span className="activities-v2-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </div>
        {uatWorkshopOffers.length > 0 ? (
          <details className="activities-v2-inactive">
            <summary>Datos de prueba UAT ({uatWorkshopOffers.length})</summary>
            <div className="activities-v2-list">
              {uatWorkshopOffers.map(renderWorkshopOffer)}
            </div>
          </details>
        ) : null}
      </section>
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
