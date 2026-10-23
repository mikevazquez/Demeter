import { formatMinorMxn, loadPlatformStudios } from "@/lib/platform/console";
import { STARTER_TEMPLATES } from "@/lib/platform/starter-templates";
import { createClient } from "@/lib/supabase/server";

import { applyStarterTemplateAction } from "../actions";

const WEEKDAY = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// NEB-01-15 · Plantillas de arranque por tipo de estudio. Precios de ejemplo: Mike los valida.
export default async function PlataformaPlantillasPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; d?: string; a?: string; p?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient("admin");
  const studios = await loadPlatformStudios(supabase);

  return (
    <>
      <section className="neb-hero">
        <p className="neb-eyebrow">Plantillas de arranque</p>
        <h1>Un estudio listo en minutos</h1>
        <p className="neb-muted">
          Aplicar crea disciplinas, actividades y paquetes que no existan con el mismo nombre. Los
          paquetes quedan inactivos para que la dueña revise los precios antes de vender. El horario
          es una sugerencia: no se crean clases.
        </p>
      </section>
      {query.estado === "aplicada" ? (
        <p className="neb-notice is-ok" role="status">
          Plantilla aplicada: {query.d ?? 0} disciplinas, {query.a ?? 0} actividades y{" "}
          {query.p ?? 0} paquetes nuevos (inactivos). Quedó en la bitácora.
        </p>
      ) : query.estado ? (
        <p className="neb-notice is-error" role="status">
          No se pudo aplicar la plantilla. Revisa el estudio e intenta de nuevo.
        </p>
      ) : null}
      <ul className="neb-module-list">
        {STARTER_TEMPLATES.map((template) => (
          <li key={template.key}>
            <article className="neb-card">
              <p className="neb-eyebrow">{template.disciplines.join(" · ")}</p>
              <h2>{template.name}</h2>
              <p className="neb-muted">{template.description}</p>
              <h3 className="neb-subtitle">Actividades</h3>
              <ul>
                {template.activities.map((item) => (
                  <li key={item.name}>
                    {item.name} · {item.durationMinutes} min · cupo {item.capacity} · suelta{" "}
                    {formatMinorMxn(item.dropInPriceMinor)}
                  </li>
                ))}
              </ul>
              <h3 className="neb-subtitle">Paquetes (precios de ejemplo)</h3>
              <ul>
                {template.products.map((item) => (
                  <li key={item.name}>
                    {item.name} · {formatMinorMxn(item.priceMinor)}
                  </li>
                ))}
              </ul>
              <h3 className="neb-subtitle">Horario sugerido</h3>
              <p className="neb-muted">
                {template.schedule
                  .map((slot) => `${WEEKDAY[slot.weekday]} ${slot.time} ${slot.activity}`)
                  .join(" · ")}
              </p>
              {studios?.length ? (
                <form action={applyStarterTemplateAction} className="neb-form">
                  <input type="hidden" name="template" value={template.key} />
                  <label>
                    Aplicar a
                    <select name="studio" required defaultValue="">
                      <option value="" disabled>
                        Elige un estudio
                      </option>
                      {studios.map((studio) => (
                        <option key={studio.id} value={studio.id}>
                          {studio.brandName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input type="checkbox" name="confirm" required /> Revisé los precios de ejemplo
                  </label>
                  <button type="submit" className="neb-button">
                    Aplicar plantilla
                  </button>
                </form>
              ) : null}
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
