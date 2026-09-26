import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { ActivityWizard } from "../ActivityWizard";

export default async function NewActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);

  const [
    { data: instructors },
    { data: persons },
    { data: spaces },
    { data: operatingPolicy },
  ] = await Promise.all([
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
    supabase
      .from("studio_operating_policies")
      .select(
        "default_minimum_reservations_enabled,default_minimum_reservations,default_minimum_review_minutes_before,default_minimum_override_allowed",
      )
      .eq("studio_id", studio.id)
      .maybeSingle(),
  ]);

  const personMap = new Map(
    (persons ?? []).map((item) => [
      item.id,
      [item.first_name, item.last_name].filter(Boolean).join(" "),
    ]),
  );

  return (
    <main className="dashboard-shell activities-editor-page">
      <header className="activities-editor-header">
        <div>
          <Link className="activities-back-link" href="/admin/actividades">
            ← Actividades
          </Link>
          <p className="eyebrow">NUEVA ACTIVIDAD · {studio.name}</p>
          <h1>Nueva actividad</h1>
          <p>Completa las cuatro etapas aprobadas antes de crearla.</p>
        </div>
      </header>

      <ActivityWizard
        mode="create"
        saveError={Boolean(params.error)}
        instructors={(instructors ?? []).map((item) => ({
          id: item.id,
          label: personMap.get(item.person_id) || "Coach",
        }))}
        spaces={(spaces ?? []).map((item) => ({
          id: item.id,
          label: item.capacity ? `${item.name} · máx. ${item.capacity}` : item.name,
        }))}
        operatingDefaults={{
          minimumReservationsEnabled:
            operatingPolicy?.default_minimum_reservations_enabled ?? false,
          minimumReservations: operatingPolicy?.default_minimum_reservations ?? 2,
          minimumReviewMinutesBefore:
            operatingPolicy?.default_minimum_review_minutes_before ?? 120,
          allowMinimumReservationOverride:
            operatingPolicy?.default_minimum_override_allowed ?? true,
        }}
      />
    </main>
  );
}
