import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import "../integrations-v2.css";

export default async function MetaWhatsAppIntegrationPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.INTEGRATIONS_READ);

  const { data: provider } = await supabase
    .from("notification_studio_channel_providers")
    .select("provider_key,adapter_key,enabled,is_default,updated_at")
    .eq("studio_id", studio.id)
    .eq("channel_key", "whatsapp")
    .eq("provider_key", "meta_whatsapp")
    .maybeSingle();

  const active = Boolean(provider?.enabled);

  return (
    <main className="integration-detail-v2">
      <header className="integration-detail-v2-header">
        <div>
          <Link className="integration-detail-v2-back" href="/admin/integraciones">
            ← Integraciones
          </Link>
          <h1>Meta · WhatsApp</h1>
          <p>Canal de WhatsApp usado por Studio Flow para mensajes a alumnas.</p>
        </div>
      </header>

      <section className="integration-detail-v2-summary">
        <article>
          <span>Estado</span>
          <strong>{active ? "Activo" : "Disponible"}</strong>
        </article>
        <article>
          <span>Proveedor</span>
          <strong>Meta</strong>
        </article>
        <article>
          <span>Canal</span>
          <strong>WhatsApp</strong>
        </article>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Conexión</h2>
            <p>Esta integración entrega los mensajes que Comunicación decide enviar por WhatsApp.</p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Canal de WhatsApp</strong>
              <small>
                {active
                  ? "El proveedor de Meta está habilitado para este estudio."
                  : "El proveedor todavía no está habilitado para este estudio."}
              </small>
            </span>
            <span className={`integrations-v2-status ${active ? "is-active" : "is-available"}`}>
              {active ? "Activo" : "Configurar"}
            </span>
          </div>

          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Mensajes, plantillas y procesos</strong>
              <small>Se administran desde el módulo Comunicación.</small>
            </span>
            <Link className="integration-detail-v2-button" href="/admin/automatizaciones">
              Ir a Comunicación
            </Link>
          </div>
        </div>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Qué vive aquí</h2>
            <p>Integraciones administra la conexión con Meta; Comunicación administra cuándo y qué se envía.</p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Integraciones</strong>
              <small>Estado del proveedor y conexión externa.</small>
            </span>
          </div>
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Comunicación</strong>
              <small>Procesos, marketing, plantillas y horarios de envío.</small>
            </span>
          </div>
        </div>
      </section>

      <section className="integration-detail-v2-note">
        Las credenciales sensibles no se muestran en el panel.
      </section>
    </main>
  );
}
