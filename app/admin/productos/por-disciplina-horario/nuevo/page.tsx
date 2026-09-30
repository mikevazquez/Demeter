import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CreateRestrictedPackageForm } from "../CreateRestrictedPackageForm";

type ScopeKey = "disciplina" | "horario";

function isScopeKey(value: string | undefined): value is ScopeKey {
  return value === "disciplina" || value === "horario";
}

export default async function NewRestrictedPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const ctx = await getAdminContext("products.write");
  const { scope: rawScope } = await searchParams;
  const scope: ScopeKey = isScopeKey(rawScope) ? rawScope : "disciplina";

  const [{ data: disciplines }, { data: schedules }, { data: templates }] = await Promise.all([
    ctx.supabase
      .from("disciplines")
      .select("id,name")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("recurring_schedules")
      .select("id,weekday,local_time,template_id")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("weekday")
      .order("local_time"),
    ctx.supabase
      .from("class_templates")
      .select("id,name,discipline_id")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true),
  ]);

  const disciplineNameById = new Map((disciplines ?? []).map((item) => [item.id, item.name]));
  const templateById = new Map((templates ?? []).map((item) => [item.id, item]));

  const scheduleChoices = (schedules ?? []).map((schedule) => {
    const template = templateById.get(schedule.template_id);
    return {
      id: schedule.id,
      weekday: schedule.weekday,
      localTime: schedule.local_time,
      activity: template?.name ?? "Clase",
      discipline:
        disciplineNameById.get(template?.discipline_id ?? "") ?? "Sin disciplina",
    };
  });

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link
          href={`/admin/productos/por-disciplina-horario/${scope}`}
          className="packages-v2-back"
        >
          <span aria-hidden="true">←</span>{" "}
          {scope === "disciplina" ? "Por disciplina" : "Por horarios específicos"}
        </Link>
        <h1>Crear paquete</h1>
        <p>
          {scope === "disciplina"
            ? "Define qué disciplinas podrán usar este paquete."
            : "Define exactamente en qué horarios podrá usarse este paquete."}
        </p>
      </header>

      {scope === "disciplina" && (disciplines?.length ?? 0) < 2 ? (
        <section className="packages-v2-info" role="alert">
          <span className="packages-v2-info-icon" aria-hidden="true">
            !
          </span>
          <p>
            Necesitas al menos dos disciplinas activas para crear un paquete restringido por
            disciplina. Con una sola disciplina, ese paquete pertenece a “Por clases”.
          </p>
        </section>
      ) : scope === "horario" && !scheduleChoices.length ? (
        <section className="packages-v2-info" role="alert">
          <span className="packages-v2-info-icon" aria-hidden="true">
            !
          </span>
          <p>Necesitas al menos un horario recurrente activo para crear este tipo de paquete.</p>
        </section>
      ) : (
        <CreateRestrictedPackageForm
          scope={scope}
          currency={ctx.studio.currency}
          locale={ctx.studio.locale}
          disciplines={disciplines ?? []}
          schedules={scheduleChoices}
        />
      )}
    </main>
  );
}
