import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import "./integrations-v2.css";

export default async function IntegrationsPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.INTEGRATIONS_READ);

  const [{ count: eventCount }, { count: mappingCount }] = await Promise.all([
    supabase
      .from("asistian_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id),
    supabase
      .from("asistian_service_mappings")
      .select("asistian_service_id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("active", true),
  ]);

  return (
    <main className="integrations-v2">
      <header className="integrations-v2-header">
        <div>
          <Link className="integrations-v2-back" href="/admin/configuracion">
            ← Avanzado
          </Link>
          <h1>Integraciones</h1>
          <p>Conecta Studio Flow con servicios externos y revisa su estado.</p>
        </div>
      </header>

      <section className="integrations-v2-grid">
        <Link href="/admin/integraciones/asistian" className="integrations-v2-card">
          <span className="integrations-v2-mark">A</span>
          <span className="integrations-v2-copy">
            <strong>Asistian</strong>
            <small>Reservas, mapeo de actividades y webhooks en ambas direcciones.</small>
            <span>
              {mappingCount ?? 0} actividades mapeadas · {eventCount ?? 0} eventos recibidos
            </span>
          </span>
          <span className="integrations-v2-status">Configurar</span>
          <span className="integrations-v2-chevron" aria-hidden="true">›</span>
        </Link>
      </section>

      <section className="integrations-v2-note">
        Las integraciones son opcionales. Studio Flow sigue funcionando aunque no conectes servicios externos.
      </section>
    </main>
  );
}
