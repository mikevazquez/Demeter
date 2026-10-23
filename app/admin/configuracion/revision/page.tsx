import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { loadStudioFeatureFlags } from "@/lib/platform/features";
import { SEVERITY_LABEL, parseConfigIssues } from "@/lib/platform/config-issues";

import "../reservas/reservas-v2.css";
import "./revision.css";

// NEB-01-18 · La dueña ve qué le falta configurar y a dónde ir a corregirlo.
export default async function ConfigReviewPage() {
  const ctx = await getAdminContext();
  if (!ctx.can(CAPABILITIES.SETTINGS_WRITE)) redirect("/admin?error=access");
  // NEB-01-20 · solo donde la función ya está lanzada.
  if (!(await loadStudioFeatureFlags(ctx.supabase, ctx.studio.id)).has("config_review")) redirect("/admin/mas");
  const { data, error } = await ctx.supabase.rpc("studio_config_issues", {
    p_studio: ctx.studio.id,
  });
  const issues = error ? [] : parseConfigIssues(data);

  return (
    <main className="reservations-v2">
      <header className="reservations-v2-header">
        <Link href="/admin/mas" className="reservations-v2-back">
          ← Más
        </Link>
        <h1>Revisión de configuración</h1>
        <p>Revisamos tu estudio y te decimos qué conviene corregir para vender y reservar sin trabas.</p>
      </header>

      {error ? (
        <div className="reservations-v2-notice is-error">
          No pudimos revisar tu estudio en este momento. Intenta de nuevo más tarde.
        </div>
      ) : issues.length === 0 ? (
        <div className="reservations-v2-notice is-success">Todo en orden. No encontramos pendientes.</div>
      ) : (
        <section className="reservations-v2-card">
          <ul className="config-review-list">
            {issues.map((issue) => (
              <li key={issue.code} className={`config-review-item is-${issue.severity}`}>
                <div>
                  <span className="config-review-badge">{SEVERITY_LABEL[issue.severity]}</span>
                  <strong>
                    {issue.title}
                    {issue.count > 1 ? ` (${issue.count})` : ""}
                  </strong>
                  <p>{issue.detail}</p>
                </div>
                {issue.href ? (
                  <Link href={issue.href} className="config-review-fix">
                    Corregir
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
