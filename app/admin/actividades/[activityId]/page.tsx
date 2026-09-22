import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { ActivityWizard, type ActivityDraft } from "../ActivityWizard";

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

export default async function ActivityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ activityId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { activityId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);

  const [
    { data: activity },
    { data: schedules },
    { data: instructors },
    { data: persons },
    { data: spaces },
  ] = await Promise.all([
    supabase
      .from("class_templates")
      .select(
        "id,name,description,duration_minutes,capacity,drop_in_price_minor,individual_purchase_notes,requires_resource,color_hex,active",
      )
      .eq("id", activityId)
      .eq("studio_id", studio.id)
      .maybeSingle(),
    supabase
      .from("recurring_schedules")
      .select(
        "id,weekday,local_time,duration_minutes,instructor_id,space_id,starts_on,ends_on,active",
      )
      .eq("studio_id", studio.id)
      .eq("template_id", activityId)
      .eq("active", true)
      .order("weekday")
      .order("local_time"),
    supabase
      .from("instructors")
      .select("id,person_id,status")
      .eq("studio_id", studio.id)
      .eq("status", "active"),
    supabase.from("persons").select("id,first_name,last_name").eq("studio_id", studio.id),
    supabase
      .from("spaces")
      .select("id,name,capacity")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("name"),
  ]);

  if (!activity) notFound();

  const personMap = new Map(
    (persons ?? []).map((item) => [
      item.id,
      [item.first_name, item.last_name].filter(Boolean).join(" "),
    ]),
  );

  const initial: ActivityDraft = {
    activityId: activity.id,
    name: activity.name,
    description: activity.description ?? "",
    durationMinutes: activity.duration_minutes,
    capacity: activity.capacity,
    colorHex: activity.color_hex ?? "#FF0A8A",
    requiresResource: activity.requires_resource,
    schedules: (schedules ?? []).map((schedule) => {
      const startTime = String(schedule.local_time).slice(0, 5);
      const duration = schedule.duration_minutes ?? activity.duration_minutes;
      return {
        id: schedule.id,
        weekday: schedule.weekday,
        startTime,
        endTime: addMinutes(startTime, duration),
        instructorId: schedule.instructor_id ?? "",
        spaceId: schedule.space_id ?? "",
        startsOn: schedule.starts_on,
        endsOn: schedule.ends_on ?? "",
      };
    }),
    allowIndividualPurchase: activity.drop_in_price_minor != null,
    individualPrice:
      activity.drop_in_price_minor != null
        ? String(activity.drop_in_price_minor / 100).replace(/\.0+$/, "")
        : "",
    individualPurchaseNotes: activity.individual_purchase_notes ?? "",
  };

  return (
    <main className="dashboard-shell activities-editor-page">
      <header className="activities-editor-header">
        <div>
          <Link className="activities-back-link" href="/admin/actividades">
            ← Actividades
          </Link>
          <p className="eyebrow">EDITAR ACTIVIDAD · {studio.name}</p>
          <h1>{activity.name}</h1>
          <p>
            Puedes entrar directamente a cualquiera de las cuatro etapas sin reconstruir la
            actividad desde cero.
          </p>
        </div>
        <span className={`activities-status-pill${activity.active ? "" : " is-inactive"}`}>
          {activity.active ? "Activa" : "Inactiva"}
        </span>
      </header>

      {query.saved === "1" ? (
        <div className="notice success">Cambios guardados correctamente.</div>
      ) : null}
      {query.error ? (
        <div className="notice error">
          No pudimos guardar los cambios. Revisa horarios, espacios y datos de venta.
        </div>
      ) : null}

      <ActivityWizard
        mode="edit"
        initial={initial}
        instructors={(instructors ?? []).map((item) => ({
          id: item.id,
          label: personMap.get(item.person_id) || "Coach",
        }))}
        spaces={(spaces ?? []).map((item) => ({
          id: item.id,
          label: item.capacity ? `${item.name} · máx. ${item.capacity}` : item.name,
        }))}
      />
    </main>
  );
}
