import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { createDiscipline } from "../actions";
import { createActivity, createRecurringSchedules, updateActivityColor } from "../recurring-actions";
import { ScheduleBuilder } from "../schedule-builder";

function formatMoney(minor: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(minor / 100);
}

export default async function AgendaConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const params = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.SCHEDULE_READ);
  const canEdit = can(CAPABILITIES.SCHEDULE_WRITE);

  const [{ data: disciplines }, { data: templates }, { data: spaces }, { data: instructors }, { data: persons }] =
    await Promise.all([
      supabase.from("disciplines").select("id,name,active").eq("studio_id", studio.id).order("name"),
      supabase
        .from("class_templates")
        .select(
          "id,name,duration_minutes,capacity,discipline_id,credit_cost,drop_in_price_minor,color_hex",
        )
        .eq("studio_id", studio.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("spaces")
        .select("id,name,capacity,site_id")
        .eq("studio_id", studio.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("instructors")
        .select("id,person_id,status")
        .eq("studio_id", studio.id)
        .eq("status", "active"),
      supabase.from("persons").select("id,first_name,last_name").eq("studio_id", studio.id),
    ]);

  const personMap = new Map(
    (persons ?? []).map((item) => [
      item.id,
      [item.first_name, item.last_name].filter(Boolean).join(" "),
    ]),
  );

  const errorCopy: Record<string, string> = {
    conflict: "Hay un conflicto de instructor o espacio en uno de los horarios.",
    space: "El espacio no admite ese cupo.",
    instructor: "Selecciona un instructor activo.",
    schedule: "No se pudo crear el horario recurrente.",
    activity: "No se pudo crear la actividad. Revisa también el precio de clase suelta.",
    color: "No se pudo guardar el color de la actividad.",
  };

  return (
    <main className="dashboard-shell agenda-config-page">
      <header className="agenda-calendar-header">
        <div>
          <Link className="back-link compact" href="/admin/agenda">
            ← Agenda
          </Link>
          <p className="eyebrow">CONFIGURACIÓN · {studio.name}</p>
          <h1>Configurar agenda</h1>
          <p>Administra disciplinas, actividades y horarios recurrentes.</p>
        </div>
      </header>

      {params.created ? <div className="notice success">Cambio guardado correctamente.</div> : null}
      {params.error ? (
        <div className="notice error">
          {errorCopy[params.error] ?? "No se pudo guardar. Revisa los datos."}
        </div>
      ) : null}

      {!canEdit ? (
        <section className="agenda-config-card">
          <p>Puedes consultar la agenda, pero no modificar su configuración.</p>
        </section>
      ) : (
        <div className="agenda-config-grid">
          <section className="agenda-config-card">
            <p className="eyebrow">1 · DISCIPLINA</p>
            <h2>Nueva disciplina</h2>
            <form action={createDiscipline} className="compact-form">
              <input name="name" required placeholder="Ej. Pole Fitness" />
              <button className="primary-button" type="submit">
                Agregar
              </button>
            </form>
          </section>

          <section className="agenda-config-card">
            <p className="eyebrow">2 · ACTIVIDAD</p>
            <h2>Crear actividad</h2>
            <form action={createActivity} className="compact-form">
              <input name="name" required placeholder="Ej. Exotic" />
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
                <label>
                  Duración (min)
                  <input name="duration_minutes" type="number" min="15" max="360" defaultValue="60" required />
                </label>
                <label>
                  Créditos
                  <input name="credit_cost" type="number" min="1" defaultValue="1" required />
                </label>
              </div>
              <div className="form-split">
                <label>
                  Cupo predeterminado
                  <input name="capacity" type="number" min="1" defaultValue="8" required />
                </label>
                <label>
                  Precio clase suelta (MXN)
                  <input name="drop_in_price" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Opcional" />
                </label>
              </div>
              <label>
                Color en el horario
                <input name="color_hex" type="color" defaultValue="#FF0A8A" />
              </label>
              <button className="primary-button" type="submit" disabled={!disciplines?.length}>
                Crear actividad
              </button>
            </form>
          </section>

          <section className="agenda-config-card">
            <p className="eyebrow">COLOR POR ACTIVIDAD</p>
            <h2>Identificación en horario</h2>
            <div className="compact-form">
              {templates?.map((item) => (
                <form action={updateActivityColor} className="form-split" key={item.id}>
                  <input type="hidden" name="activity_id" value={item.id} />
                  <label>
                    {item.name}
                    <input
                      name="color_hex"
                      type="color"
                      defaultValue={item.color_hex ?? "#FF0A8A"}
                      aria-label={`Color de ${item.name}`}
                    />
                  </label>
                  <button className="ghost-button" type="submit">
                    Guardar
                  </button>
                </form>
              ))}
            </div>
          </section>

          <section id="programar-clase" className="agenda-config-card">
            <p className="eyebrow">3 · HORARIO RECURRENTE</p>
            <h2>Programar actividad</h2>
            <form action={createRecurringSchedules} className="compact-form">
              <select name="template_id" required defaultValue="">
                <option value="" disabled>
                  Actividad
                </option>
                {templates?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.duration_minutes} min · {item.credit_cost} crédito
                    {item.credit_cost === 1 ? "" : "s"}
                    {item.drop_in_price_minor != null
                      ? ` · Suelta ${formatMoney(item.drop_in_price_minor)}`
                      : ""}
                  </option>
                ))}
              </select>
              <label>
                Comenzar desde
                <input name="starts_on" type="date" required />
              </label>
              <ScheduleBuilder
                defaultCapacity={templates?.[0]?.capacity ?? 8}
                instructors={(instructors ?? []).map((item) => ({
                  id: item.id,
                  label: personMap.get(item.person_id) ?? "Instructor",
                }))}
                spaces={(spaces ?? []).map((item) => ({
                  id: item.id,
                  label: item.name,
                  capacity: item.capacity,
                }))}
              />
              <textarea name="notes" rows={2} placeholder="Notas opcionales" />
              <button className="primary-button" type="submit" disabled={!templates?.length}>
                Guardar horario
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
