import Link from "next/link";
import { headers } from "next/headers";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { saveMetaWhatsAppInbound } from "./actions";
import "../integrations-v2.css";

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default async function MetaWhatsAppIntegrationPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const [{ data: provider }, { data: inboundSummary }] = await Promise.all([
    supabase
      .from("notification_studio_channel_providers")
      .select("provider_key,adapter_key,enabled,is_default,updated_at")
      .eq("studio_id", studio.id)
      .eq("channel_key", "whatsapp")
      .eq("provider_key", "meta_whatsapp")
      .maybeSingle(),
    supabase.rpc("admin_get_meta_whatsapp_inbound_summary", {
      target_studio_id: studio.id,
    }),
  ]);

  const active = Boolean(provider?.enabled);
  const inbound = asObject(inboundSummary);
  const webhookConfigured = inbound?.webhook_configured === true;
  const verifyToken =
    typeof inbound?.verify_token === "string" ? inbound.verify_token : "";
  const serviceRoleConfigured = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  const openAIConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host")?.trim();
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "http" ? "http" : "https";
  const callbackUrl = host
    ? new URL(
        `/api/integrations/meta-whatsapp/webhook?studio=${studio.id}`,
        `${protocol}://${host}`,
      ).toString()
    : "";

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
          <span>Salida Meta</span>
          <strong>{active ? "Activa" : "Disponible"}</strong>
        </article>
        <article>
          <span>Entrada Meta</span>
          <strong>{webhookConfigured ? "Lista" : "Pendiente"}</strong>
        </article>
        <article>
          <span>Runtime Demi</span>
          <strong>
            {serviceRoleConfigured && openAIConfigured ? "Listo" : "Incompleto"}
          </strong>
        </article>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Conexión</h2>
            <p>
              Esta integración entrega los mensajes que Comunicación decide enviar por WhatsApp.
            </p>
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
            <h2>Demi · recepción en WhatsApp</h2>
            <p>
              Configura aquí el webhook entrante de Meta. El App Secret se guarda cifrado y
              nunca se muestra después de guardarlo.
            </p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Webhook entrante</strong>
              <small>
                {webhookConfigured
                  ? "La verificación y la firma de Meta ya pueden validarse."
                  : "Falta guardar el App Secret de Meta para habilitar la recepción."}
              </small>
            </span>
            <span
              className={`integrations-v2-status ${
                webhookConfigured ? "is-active" : "is-available"
              }`}
            >
              {webhookConfigured ? "Configurado" : "Pendiente"}
            </span>
          </div>

          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Acceso seguro a Sandbox</strong>
              <small>
                {serviceRoleConfigured
                  ? "La ruta entrante puede operar con el contexto de servicio del Sandbox."
                  : "Falta SUPABASE_SERVICE_ROLE_KEY en el entorno Preview de Vercel."}
              </small>
            </span>
            <span
              className={`integrations-v2-status ${
                serviceRoleConfigured ? "is-active" : "is-available"
              }`}
            >
              {serviceRoleConfigured ? "Listo" : "Pendiente"}
            </span>
          </div>

          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Motor de Demi</strong>
              <small>
                {openAIConfigured
                  ? "OpenAI está disponible en el entorno Preview."
                  : "Falta OPENAI_API_KEY en el entorno Preview."}
              </small>
            </span>
            <span
              className={`integrations-v2-status ${
                openAIConfigured ? "is-active" : "is-available"
              }`}
            >
              {openAIConfigured ? "Listo" : "Pendiente"}
            </span>
          </div>
        </div>

        <form className="integration-detail-v2-form" action={saveMetaWhatsAppInbound}>
          <label className="integration-detail-v2-field">
            <span>Meta App Secret</span>
            <input
              type="password"
              name="app_secret"
              required
              autoComplete="new-password"
              placeholder={webhookConfigured ? "••••••••••••••••" : "Pégalo aquí desde Meta"}
            />
            <small>
              Escríbelo directamente aquí. No lo pegues en el chat ni se almacenará en el
              historial de Demi.
            </small>
          </label>

          <label className="integration-detail-v2-field">
            <span>Verify token</span>
            <input
              type="text"
              name="verify_token"
              defaultValue={verifyToken}
              autoComplete="off"
              placeholder="Déjalo vacío para generar uno"
            />
            <small>
              Este token sí se puede copiar a Meta para validar el webhook.
            </small>
          </label>

          <button className="integration-detail-v2-button" type="submit">
            {webhookConfigured ? "Actualizar configuración entrante" : "Guardar configuración entrante"}
          </button>
        </form>

        {callbackUrl ? (
          <div className="integration-detail-v2-list">
            <label className="integration-detail-v2-field">
              <span>Callback URL de este Preview</span>
              <input type="text" readOnly value={callbackUrl} />
              <small>
                Usa esta URL en Meta únicamente para el UAT de Sandbox. No corresponde a
                Production.
              </small>
            </label>
            {verifyToken ? (
              <label className="integration-detail-v2-field">
                <span>Verify token para Meta</span>
                <input type="text" readOnly value={verifyToken} />
              </label>
            ) : null}
          </div>
        ) : null}

        {!serviceRoleConfigured ? (
          <div className="integration-detail-v2-notice is-error">
            Antes del UAT real, agrega SUPABASE_SERVICE_ROLE_KEY únicamente al entorno
            Preview de Vercel. Hazlo directamente en Vercel; no compartas la llave por chat.
          </div>
        ) : null}
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Qué vive aquí</h2>
            <p>
              Integraciones administra la conexión con Meta; Comunicación administra cuándo y qué se
              envía.
            </p>
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
