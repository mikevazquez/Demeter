import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import "../integrations-v2.css";

function checkoutStatusLabel(status: string) {
  const labels: Record<string, string> = {
    created: "Creado",
    order_created: "Checkout generado",
    preference_created: "Checkout generado",
    pending: "Pendiente",
    approved: "Aprobado",
    rejected: "Rechazado",
    cancelled: "Cancelado",
    expired: "Vencido",
    error: "Error",
  };
  return labels[status] ?? status;
}

export default async function MercadoPagoIntegrationPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.INTEGRATIONS_READ);

  const [
    { count: onlineProducts },
    { count: attemptCount },
    { count: approvedCount },
    { data: recentAttempts },
  ] = await Promise.all([
    supabase
      .from("product_templates")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("online_purchasable", true),
    supabase
      .from("online_checkout_attempts")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("provider", "mercado_pago"),
    supabase
      .from("online_checkout_attempts")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("provider", "mercado_pago")
      .eq("status", "approved"),
    supabase
      .from("online_checkout_attempts")
      .select("id,status,amount_minor,currency,created_at,product_name_snapshot")
      .eq("studio_id", studio.id)
      .eq("provider", "mercado_pago")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat(studio.locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(minor / 100);

  return (
    <main className="integration-detail-v2">
      <header className="integration-detail-v2-header">
        <div>
          <Link className="integration-detail-v2-back" href="/admin/integraciones">
            ← Integraciones
          </Link>
          <h1>Mercado Pago</h1>
          <p>Cobros en línea para compras realizadas por alumnas.</p>
        </div>
      </header>

      <section className="integration-detail-v2-summary">
        <article>
          <span>Productos online</span>
          <strong>{onlineProducts ?? 0}</strong>
        </article>
        <article>
          <span>Intentos de pago</span>
          <strong>{attemptCount ?? 0}</strong>
        </article>
        <article>
          <span>Pagos aprobados</span>
          <strong>{approvedCount ?? 0}</strong>
        </article>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Cómo se usa</h2>
            <p>Mercado Pago aparece cuando una alumna compra un producto habilitado para pago en línea.</p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Productos disponibles</strong>
              <small>Se decide individualmente desde la configuración de cada paquete.</small>
            </span>
            <Link className="integration-detail-v2-button" href="/admin/productos">
              Ir a Paquetes
            </Link>
          </div>

          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Procesamiento</strong>
              <small>Studio Flow genera el checkout y registra el resultado del pago.</small>
            </span>
            <span className="integrations-v2-status is-active">Activo</span>
          </div>
        </div>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Actividad reciente</h2>
            <p>Últimos intentos de compra procesados mediante Mercado Pago.</p>
          </div>
        </div>

        {!recentAttempts?.length ? (
          <div className="integration-detail-v2-empty">Todavía no hay intentos de pago.</div>
        ) : (
          <div className="integration-detail-v2-list">
            {recentAttempts.map((attempt) => (
              <div className="integration-detail-v2-row" key={attempt.id}>
                <span className="integration-detail-v2-row-copy">
                  <strong>{attempt.product_name_snapshot || "Compra online"}</strong>
                  <small>
                    {new Intl.DateTimeFormat(studio.locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: studio.timezone,
                    }).format(new Date(attempt.created_at))}
                  </small>
                </span>
                <span>{checkoutStatusLabel(String(attempt.status))}</span>
                <strong>{money(attempt.amount_minor, attempt.currency)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="integration-detail-v2-note">
        La conexión técnica con Mercado Pago se administra por Studio Flow. Esta pantalla muestra el
        uso de la integración dentro del estudio; no expone llaves ni credenciales.
      </section>
    </main>
  );
}
