import {
  FEATURE_STAGE_LABEL,
  nextStage,
  parsePlatformFeatures,
  previousStage,
} from "@/lib/platform/features";
import { formatDateMx, loadPlatformStudios } from "@/lib/platform/console";
import { createClient } from "@/lib/supabase/server";

import { setFeatureBetaStudioAction, setFeatureStageAction } from "../actions";

const NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  etapa_guardada: { tone: "ok", text: "Etapa guardada. Quedó en la bitácora." },
  beta_guardada: { tone: "ok", text: "Estudios beta guardados." },
  feature_confirm_required: {
    tone: "error",
    text: "Para liberar a todos los estudios marca la casilla de confirmación.",
  },
  feature_not_found: { tone: "error", text: "Esa función no existe." },
  error: { tone: "error", text: "No se pudo guardar. Intenta de nuevo." },
};

// NEB-01-20 · Lanzamientos: Sandbox → Beta → Todos, con el botón de Mike para liberar a todos.
export default async function PlataformaLanzamientosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient("admin");
  const [{ data, error }, studios] = await Promise.all([
    supabase.rpc("platform_features_list"),
    loadPlatformStudios(supabase),
  ]);
  const catalog = error ? null : parsePlatformFeatures(data);
  const notice = query.estado ? (NOTICES[query.estado] ?? NOTICES.error) : null;

  return (
    <>
      <section className="neb-hero">
        <p className="neb-eyebrow">
          Lanzamientos · esta base es {catalog?.environment === "sandbox" ? "Sandbox" : "producción"}
        </p>
        <h1>Funciones por estudio</h1>
        <p className="neb-muted">
          Sandbox: solo en la base de pruebas. Beta: solo los estudios que elijas. Todos: cada
          estudio la ve y su admin recibe el aviso de novedad.
        </p>
      </section>
      {notice ? (
        <p className={`neb-notice is-${notice.tone}`} role="status">
          {notice.text}
        </p>
      ) : null}
      {!catalog ? (
        <p className="neb-notice is-error">
          No se pudieron leer los lanzamientos. ¿Ya está aplicada la migración de NEB-01-20?
        </p>
      ) : catalog.features.length === 0 ? (
        <p className="neb-muted">Todavía no hay funciones registradas.</p>
      ) : (
        <ul className="neb-module-list">
          {catalog.features.map((feature) => {
            const next = nextStage(feature.stage);
            const previous = previousStage(feature.stage);
            return (
              <li key={feature.key}>
                <article className="neb-card">
                  <p className="neb-eyebrow">
                    {FEATURE_STAGE_LABEL[feature.stage]} desde {formatDateMx(feature.stageChangedAt)}
                  </p>
                  <h2>{feature.name}</h2>
                  {feature.description ? <p className="neb-muted">{feature.description}</p> : null}
                  <div className="neb-studio-meta">
                    {previous ? (
                      <form action={setFeatureStageAction}>
                        <input type="hidden" name="feature" value={feature.key} />
                        <input type="hidden" name="stage" value={previous} />
                        <button type="submit" className="neb-button is-ghost">
                          Regresar a {FEATURE_STAGE_LABEL[previous]}
                        </button>
                      </form>
                    ) : null}
                    {next ? (
                      <form action={setFeatureStageAction} className="neb-form">
                        <input type="hidden" name="feature" value={feature.key} />
                        <input type="hidden" name="stage" value={next} />
                        {next === "all" ? (
                          <label>
                            <input type="checkbox" name="confirm_all" /> Confirmo liberar a todos los
                            estudios
                          </label>
                        ) : null}
                        <button type="submit" className="neb-button">
                          Avanzar a {FEATURE_STAGE_LABEL[next]}
                        </button>
                      </form>
                    ) : null}
                  </div>
                  {feature.stage === "beta" && studios ? (
                    <form action={setFeatureBetaStudioAction} className="neb-form">
                      <input type="hidden" name="feature" value={feature.key} />
                      <p className="neb-muted">Estudios beta</p>
                      {studios.map((studio) => (
                        <label key={studio.id}>
                          <input
                            type="checkbox"
                            name="studios"
                            value={studio.id}
                            defaultChecked={feature.betaStudios.includes(studio.id)}
                          />{" "}
                          {studio.brandName}
                        </label>
                      ))}
                      <button type="submit" className="neb-button is-ghost">
                        Guardar estudios beta
                      </button>
                    </form>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
