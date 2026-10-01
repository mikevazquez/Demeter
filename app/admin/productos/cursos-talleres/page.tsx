import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

function ActivityIcon() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 9 9-5 9 5-9 5-9-5Z" />
      <path d="M7 12.5V17c2.7 2 7.3 2 10 0v-4.5M21 9v6" />
    </svg>
  );
}

export default async function CoursesWorkshopsPage() {
  const ctx = await getAdminContext("products.read");

  const [{ data: activities }, { data: schedules }, { data: activityLinks }] = await Promise.all([
    ctx.supabase
      .from("class_templates")
      .select("id,name,description")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("recurring_schedules")
      .select("id,template_id")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true),
    ctx.supabase
      .from("product_template_activities")
      .select("product_template_id,class_template_id")
      .eq("studio_id", ctx.studio.id),
  ]);

  const scheduleCountByActivity = new Map<string, number>();
  for (const schedule of schedules ?? []) {
    scheduleCountByActivity.set(
      schedule.template_id,
      (scheduleCountByActivity.get(schedule.template_id) ?? 0) + 1,
    );
  }

  const linkedProductIds = [
    ...new Set((activityLinks ?? []).map((link) => link.product_template_id)),
  ];
  const { data: products } = linkedProductIds.length
    ? await ctx.supabase
        .from("product_templates")
        .select("id,active")
        .eq("studio_id", ctx.studio.id)
        .in("id", linkedProductIds)
    : { data: [] as { id: string; active: boolean }[] };

  const activeProductIds = new Set((products ?? []).filter((p) => p.active).map((p) => p.id));
  const packageCountByActivity = new Map<string, number>();
  for (const link of activityLinks ?? []) {
    if (!activeProductIds.has(link.product_template_id)) continue;
    packageCountByActivity.set(
      link.class_template_id,
      (packageCountByActivity.get(link.class_template_id) ?? 0) + 1,
    );
  }

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos" className="packages-v2-back">
          <span aria-hidden="true">←</span> Paquetes
        </Link>
        <h1>Cursos y talleres</h1>
        <p>Elige la actividad a la que quieres vincular el paquete.</p>
      </header>

      <section className="packages-v2-info" aria-label="Paquetes por actividad">
        <span className="packages-v2-info-icon" aria-hidden="true">
          i
        </span>
        <p>
          El paquete solo podrá usarse en la actividad elegida, aunque después cambien sus días u
          horarios.
        </p>
      </section>

      {activities?.length ? (
        <section className="package-category-grid" aria-label="Actividades">
          {activities.map((activity) => {
            const scheduleCount = scheduleCountByActivity.get(activity.id) ?? 0;
            const packageCount = packageCountByActivity.get(activity.id) ?? 0;

            return (
              <Link
                key={activity.id}
                href={`/admin/productos/cursos-talleres/${activity.id}`}
                className="package-category-card is-purple"
              >
                <span className="package-category-icon">
                  <ActivityIcon />
                </span>
                <span className="package-category-copy">
                  <strong>{activity.name}</strong>
                  <span>{activity.description || "Actividad sin descripción."}</span>
                  <small className="package-period-count">
                    {packageCount} {packageCount === 1 ? "paquete activo" : "paquetes activos"} ·{" "}
                    {scheduleCount} {scheduleCount === 1 ? "horario" : "horarios"}
                  </small>
                </span>
                <span className="package-category-action">
                  Ver <span aria-hidden="true">›</span>
                </span>
              </Link>
            );
          })}
        </section>
      ) : (
        <section className="packages-v2-empty">
          Aún no hay actividades activas. Crea primero el curso o taller desde Actividades.
        </section>
      )}
    </main>
  );
}
