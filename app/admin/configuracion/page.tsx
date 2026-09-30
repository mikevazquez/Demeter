import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { STUDIO_MODULES } from "@/lib/auth/modules";

import "./advanced-v2.css";

type PlanUsageRow = {
  plan_key: string;
  plan_name: string;
  limit_key: string;
  limit_name: string;
  unit: string;
  limit_value: number | null;
  usage: number;
  unlimited: boolean;
  over_limit: boolean;
  remaining: number | null;
  note: string | null;
};

function AdvancedIcon({
  kind,
}: {
  kind: "region" | "integration" | "resources" | "subscription";
}) {
  if (kind === "region") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3.2 4.3 6.2 4.3 9S15 17.8 12 21M12 3c-3 3.2-4.3 6.2-4.3 9S9 17.8 12 21" />
      </svg>
    );
  }

  if (kind === "integration") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 8h4V4M16 16h-4v4" />
        <path d="M12 8 7 13a3 3 0 0 0 4 4l5-5M12 16l5-5a3 3 0 0 0-4-4l-5 5" />
      </svg>
    );
  }

  if (kind === "resources") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16v14H4zM8 5v14M16 5v14M4 12h16" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M7 15h4" />
    </svg>
  );
}

export default async function AdvancedConfigurationPage() {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const { data: planUsage } = await ctx.supabase.rpc("current_studio_plan_usage", {
    p_studio_id: ctx.studio.id,
  });

  const usageRows = (planUsage ?? []) as PlanUsageRow[];
  const planName = usageRows[0]?.plan_name ?? ctx.subscription.plan_name ?? "Plan";
  const hasResources = ctx.hasModule(STUDIO_MODULES.RESOURCES);
  const canIntegrations = ctx.can(CAPABILITIES.INTEGRATIONS_READ);

  return (
    <main className="advanced-v2">
      <header className="advanced-v2-header">
        <div>
          <Link className="advanced-v2-back" href="/admin/mas">
            ← Más
          </Link>
          <h1>Avanzado</h1>
          <p>Configuraciones técnicas y poco frecuentes del estudio.</p>
        </div>
      </header>

      <section className="advanced-v2-plan">
        <div className="advanced-v2-plan-heading">
          <div>
            <span>PLAN Y USO</span>
            <h2>{planName}</h2>
            <p>Consulta el uso actual de las capacidades incluidas en tu plan.</p>
          </div>
          <Link href="/admin/suscripcion" className="advanced-v2-secondary-action">
            Ver suscripción
          </Link>
        </div>

        {usageRows.length ? (
          <div className="advanced-v2-usage-grid">
            {usageRows.map((row) => {
              const percent =
                row.limit_value && row.limit_value > 0
                  ? Math.min(100, Math.round((row.usage / row.limit_value) * 100))
                  : null;

              return (
                <article
                  key={row.limit_key}
                  className={`advanced-v2-usage-card ${row.over_limit ? "is-over" : ""}`}
                >
                  <span>{row.limit_name}</span>
                  <div>
                    <strong>{row.usage}</strong>
                    <small>{row.unlimited ? "Ilimitado" : `de ${row.limit_value}`}</small>
                  </div>
                  {percent !== null ? (
                    <div className="advanced-v2-progress" aria-hidden="true">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="advanced-v2-empty-inline">No hay datos de uso disponibles.</div>
        )}
      </section>

      <section className="advanced-v2-grid">
        <Link href="/admin/configuracion/region" className="advanced-v2-card">
          <span className="advanced-v2-icon">
            <AdvancedIcon kind="region" />
          </span>
          <span className="advanced-v2-card-copy">
            <strong>Región y formatos</strong>
            <small>
              Zona horaria, moneda, formato regional y prefijo telefónico.
            </small>
            <span>
              {ctx.studio.timezone} · {ctx.studio.currency} · {ctx.studio.locale}
            </span>
          </span>
          <span className="advanced-v2-chevron" aria-hidden="true">›</span>
        </Link>

        {canIntegrations ? (
          <Link href="/admin/integraciones" className="advanced-v2-card">
            <span className="advanced-v2-icon is-purple">
              <AdvancedIcon kind="integration" />
            </span>
            <span className="advanced-v2-card-copy">
              <strong>Integraciones</strong>
              <small>Conecta servicios externos y revisa sus configuraciones técnicas.</small>
              <span>Asistian</span>
            </span>
            <span className="advanced-v2-chevron" aria-hidden="true">›</span>
          </Link>
        ) : null}

        {hasResources ? (
          <Link href="/admin/configuracion/recursos" className="advanced-v2-card">
            <span className="advanced-v2-icon is-blue">
              <AdvancedIcon kind="resources" />
            </span>
            <span className="advanced-v2-card-copy">
              <strong>Recursos y espacios</strong>
              <small>Recursos físicos, mapas y distribución de los espacios.</small>
              <span>Configuración física del estudio</span>
            </span>
            <span className="advanced-v2-chevron" aria-hidden="true">›</span>
          </Link>
        ) : null}

        <Link href="/admin/suscripcion" className="advanced-v2-card">
          <span className="advanced-v2-icon is-amber">
            <AdvancedIcon kind="subscription" />
          </span>
          <span className="advanced-v2-card-copy">
            <strong>Plan y suscripción</strong>
            <small>Estado de acceso, periodo contratado, trial y facturación.</small>
            <span>{ctx.subscription.plan_name}</span>
          </span>
          <span className="advanced-v2-chevron" aria-hidden="true">›</span>
        </Link>
      </section>

      <section className="advanced-v2-note">
        Las reglas de cancelación y no-show están en <strong>Reservas</strong>; la identidad visual
        está en <strong>Apariencia</strong>. Aquí solo dejamos configuraciones técnicas o poco frecuentes.
      </section>
    </main>
  );
}
