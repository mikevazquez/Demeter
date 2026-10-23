import type { SupabaseClient } from "@supabase/supabase-js";

import { parseStudioSupportAccess } from "@/lib/platform/support";

/** NEB-01-17 · La dueña ve cuándo entró soporte de Nébora, por qué y cuántos cambios hizo. */
export default async function SupportAccessHistory({
  supabase,
  studioId,
  timeZone,
}: {
  supabase: SupabaseClient;
  studioId: string;
  timeZone: string;
}) {
  const { data, error } = await supabase.rpc("studio_support_access", { p_studio: studioId });
  if (error) return null;
  const access = parseStudioSupportAccess(data);
  if (!access) return null;
  const when = (value: string) =>
    new Intl.DateTimeFormat("es-MX", {
      timeZone,
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  return (
    <section className="subscription-v2-grid">
      <article className="subscription-v2-card">
        <h2>Accesos de soporte de Nébora</h2>
        {access.recent.length ? (
          <ul>
            {access.recent.map((entry) => (
              <li key={entry.startedAt}>
                <strong>{when(entry.startedAt)}</strong> · {entry.reason} ·{" "}
                {entry.changes === 0
                  ? "solo consulta"
                  : `${entry.changes} cambio${entry.changes === 1 ? "" : "s"}`}
              </li>
            ))}
          </ul>
        ) : (
          <p>Soporte de Nébora no ha entrado a tu estudio.</p>
        )}
        <div className="subscription-v2-connected">
          Cada consulta y cambio de soporte queda en una bitácora que no se puede borrar.
        </div>
      </article>
    </section>
  );
}
