import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CreateActivityPackageForm } from "../CreateActivityPackageForm";

export default async function NewActivityPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string }>;
}) {
  const ctx = await getAdminContext("products.write");
  const { activity: activityId } = await searchParams;

  if (!activityId) notFound();

  const { data: activity } = await ctx.supabase
    .from("class_templates")
    .select("id,name,active")
    .eq("studio_id", ctx.studio.id)
    .eq("id", activityId)
    .maybeSingle();

  if (!activity || !activity.active) notFound();

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link
          href={`/admin/productos/cursos-talleres/${activity.id}`}
          className="packages-v2-back"
        >
          <span aria-hidden="true">←</span> {activity.name}
        </Link>
        <h1>Crear paquete</h1>
        <p>Configura un paquete exclusivo para esta actividad.</p>
      </header>

      <CreateActivityPackageForm
        activityId={activity.id}
        activityName={activity.name}
        currency={ctx.studio.currency}
        locale={ctx.studio.locale}
      />
    </main>
  );
}
