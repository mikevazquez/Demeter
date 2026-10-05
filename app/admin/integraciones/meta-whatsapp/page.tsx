import Link from "next/link";
import { headers } from "next/headers";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import {
  activateMetaWhatsAppPilot,
  disableMetaWhatsAppPilot,
  saveMetaWhatsAppConnection,
} from "./actions";
import "../integrations-v2.css";

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default async function MetaWhatsAppIntegrationPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const [
    { data: provider },
    { data: inboundSummary },
    { data: pilotSummary },
    { data: assistantConfig },
  ] = await Promise.all([
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
    supabase.rpc("admin_get_meta_whatsapp_pilot_summary", {
      target_studio_id: studio.id,
    }),
    supabase.from("assistant_configs").select("mode").eq("studio_id", studio.id).maybeSingle(),
  ]);

  const active = Boolean(provider?.enabled);
  const inbound = asObject(inboundSummary);
  const webhookConfigured = inbound?.webhook_configured === true;
  const connectionRepairRequired = inbound?.connection_repair_required === true;
  const verifyToken = typeof inbound?.verify_token === "string" ? inbound.verify_token : "";
  const pilot = asObject(pilotSummary);
  const pilotContactConfigured = pilot?.pilot_contact_configured === true;
  const pilotContactMasked =
    typeof pilot?.pilot_contact_masked === "string" ? pilot.pilot_contact_masked : null;
  const pilotActive = assistantConfig?.mode === "pilot";
  const serviceRoleConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
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
          <strong>{serviceRoleConfigured && openAIConfigured ? "Listo" : "Incompleto"}</strong>
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
              Guarda las credenciales del número y configura el webhook de Meta. Los secretos se guardan cifrados y nunca se vuelven a mostrar.
            </p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Webhook entrante</strong>
              <small>
                {webhookConfigured
                  ? "La conexión y las credenciales del webhook están configuradas."
                  : connectionRepairRequired
                    ? "La conexión anterior requiere reemplazarse con las credenciales completas de Meta."
                    : "Faltan las credenciales de conexión y del webhook de Meta."}
              </small>
            </span>
            <span
              className={`integrations-v2-status ${
                webhookConfigured ? "is-active" : "is-available"
              }`}
            >
              {webhookConfigured ? "Configurado" : connectionRepairRequired ? "Reparar conexión" : "Pendiente"}
            </span>
          </div>

          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Acceso seguro al entorno</strong>
              <small>
                {serviceRoleConfigured
                  ? "La ruta entrante puede operar con el contexto de servicio configurado para este entorno."
                  : "Falta SUPABASE_SERVICE_ROLE_KEY en este entorno de Vercel."}
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
                  ? "OpenAI está disponible en este entorno."
                  : "Falta OPENAI_API_KEY en este entorno."}
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

        <form className="integration-detail-v2-form" action={saveMetaWhatsAppConnection}>
          <label className="integration-detail-v2-field">
            <span>Token de acceso de WhatsApp</span>
            <input type="password" name="access_token" required autoComplete="new-password" />
            <small>Usa un token de acceso de sistema de Meta con permisos de WhatsApp Business. Se guarda cifrado y no vuelve a mostrarse.</small>
          </label>
          <label className="integration-detail-v2-field">
            <span>Phone Number ID</span>
            <input type="text" name="phone_number_id" required inputMode="numeric" autoComplete="off" />
          </label>
          <label className="integration-detail-v2-field">
            <span>WhatsApp Business Account ID</span>
            <input type="text" name="waba_id" required inputMode="numeric" autoComplete="off" />
          </label>
          <label className="integration-detail-v2-field">
            <span>Versión de Graph API</span>
            <input type="text" name="graph_api_version" required placeholder="vXX.X" autoComplete="off" />
          </label>
          <label className="integration-detail-v2-field">
            <span>Meta App Secret</span>
            <input type="password" name="app_secret" required autoComplete="new-password" />
            <small>Escríbelo directamente aquí. No lo compartas por chat.</small>
          </label>
          <label className="integration-detail-v2-field">
            <span>Verify token</span>
            <input type="text" name="verify_token" defaultValue={verifyToken} autoComplete="off" placeholder="Déjalo vacío para generar uno" />
            <small>Después copia el token generado a la configuración del webhook en Meta.</small>
          </label>
          <button className="integration-detail-v2-button" type="submit">
            Guardar conexión segura de Meta
          </button>
        </form>

        {callbackUrl ? (
          <div className="integration-detail-v2-list">
            <label className="integration-detail-v2-field">
              <span>Callback URL de este entorno</span>
              <input type="text" readOnly value={callbackUrl} />
              <small>
                Configura en Meta la URL correspondiente a este entorno. Antes de activarla,
                verifica que el estudio y las credenciales sean los correctos.
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
            Agrega SUPABASE_SERVICE_ROLE_KEY directamente en el entorno correcto de Vercel. No
            compartas la llave por chat.
          </div>
        ) : null}
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Piloto controlado de Demi</h2>
            <p>
              Solo el número de prueba configurado aquí puede activar a Demi mientras el modo piloto
              esté encendido. Los demás mensajes de WhatsApp se ignoran sin crear conversación ni
              respuesta.
            </p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Estado del piloto</strong>
              <small>
                {pilotActive
                  ? `Activo solo para ${pilotContactMasked ?? "el número autorizado"}.`
                  : pilotContactConfigured
                    ? `Número guardado: ${pilotContactMasked}. Demi sigue apagada para WhatsApp.`
                    : "Todavía no hay un número de prueba autorizado."}
              </small>
            </span>
            <span
              className={`integrations-v2-status ${pilotActive ? "is-active" : "is-available"}`}
            >
              {pilotActive ? "Piloto activo" : "Seguro"}
            </span>
          </div>
        </div>

        <form className="integration-detail-v2-form" action={activateMetaWhatsAppPilot}>
          <label className="integration-detail-v2-field">
            <span>Número de WhatsApp para el piloto</span>
            <input
              type="tel"
              name="pilot_phone"
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="Ej. 3312345678"
            />
            <small>
              Si es un número de México puedes escribir solo los 10 dígitos. Para otro país usa el
              código de país. Se usa únicamente como lista permitida del piloto.
            </small>
          </label>

          <button className="integration-detail-v2-button" type="submit">
            {pilotActive ? "Cambiar número autorizado" : "Guardar número y activar piloto"}
          </button>
        </form>

        {pilotActive ? (
          <form action={disableMetaWhatsAppPilot}>
            <button className="integration-detail-v2-button" type="submit">
              Desactivar piloto de WhatsApp
            </button>
          </form>
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
