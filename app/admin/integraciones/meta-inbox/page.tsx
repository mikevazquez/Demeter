import Link from "next/link";
import { headers } from "next/headers";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { saveMetaInboxConnection, saveMetaInboxPilotContacts } from "./actions";
import "../integrations-v2.css";

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MetaInboxIntegrationPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const [{ data: summaryData }, { data: assistantConfig }] = await Promise.all([
    supabase.rpc("admin_get_meta_inbox_connection_summary", {
      target_studio_id: studio.id,
    }),
    supabase.from("assistant_configs").select("mode").eq("studio_id", studio.id).maybeSingle(),
  ]);

  const summary = asObject(summaryData);
  const connected = summary?.connected === true;
  const verifyToken = typeof summary?.verify_token === "string" ? summary.verify_token : "";
  const pageId = typeof summary?.page_id === "string" ? summary.page_id : null;
  const instagramUserId =
    typeof summary?.instagram_user_id === "string" ? summary.instagram_user_id : null;
  const instagramPilot =
    typeof summary?.instagram_pilot_masked === "string" ? summary.instagram_pilot_masked : null;
  const messengerPilot =
    typeof summary?.messenger_pilot_masked === "string" ? summary.messenger_pilot_masked : null;
  const serviceRoleConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const openAIConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host")?.trim();
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "http" ? "http" : "https";
  const callbackUrl = host
    ? new URL(
        `/api/integrations/meta-inbox/webhook?studio=${studio.id}`,
        `${protocol}://${host}`,
      ).toString()
    : "";

  const connectionResult = queryValue(params.connection);
  const pilotResult = queryValue(params.pilot);
  const resultCode = queryValue(params.code);

  return (
    <main className="integration-detail-v2">
      <header className="integration-detail-v2-header">
        <div>
          <Link className="integration-detail-v2-back" href="/admin/integraciones">
            ← Integraciones
          </Link>
          <h1>Meta · Instagram + Facebook</h1>
          <p>
            Conecta los mensajes directos de Instagram y Messenger al mismo cerebro de Demi.
          </p>
        </div>
      </header>

      <section className="integration-detail-v2-summary">
        <article>
          <span>Conexión Meta</span>
          <strong>{connected ? "Lista" : "Pendiente"}</strong>
        </article>
        <article>
          <span>Demi</span>
          <strong>{assistantConfig?.mode ?? "Sin configurar"}</strong>
        </article>
        <article>
          <span>Runtime</span>
          <strong>{serviceRoleConfigured && openAIConfigured ? "Listo" : "Incompleto"}</strong>
        </article>
      </section>

      {connectionResult === "saved" ? (
        <div className="integration-detail-v2-notice">
          Conexión de Instagram y Messenger guardada de forma segura.
        </div>
      ) : connectionResult === "error" ? (
        <div className="integration-detail-v2-notice is-error">
          No se pudo guardar la conexión{resultCode ? `: ${resultCode}` : "."}
        </div>
      ) : null}

      {pilotResult === "saved" ? (
        <div className="integration-detail-v2-notice">
          Contactos de prueba actualizados.
        </div>
      ) : pilotResult === "error" ? (
        <div className="integration-detail-v2-notice is-error">
          No se pudo guardar el piloto{resultCode ? `: ${resultCode}` : "."}
        </div>
      ) : null}

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Conexión de canales</h2>
            <p>
              Puedes configurar Messenger primero e Instagram después. Deja los campos del otro canal vacíos. Las credenciales se guardan cifradas y no se vuelven a mostrar; Studio Flow no vuelve a mostrar los tokens ni
              el App Secret después de guardarlos.
            </p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Facebook Messenger</strong>
              <small>{pageId ? `Página configurada · ••••${pageId.slice(-4)}` : "Pendiente"}</small>
            </span>
            <span className={`integrations-v2-status ${pageId ? "is-active" : "is-available"}`}>
              {pageId ? "Configurado" : "Configurar"}
            </span>
          </div>

          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Instagram Direct</strong>
              <small>
                {instagramUserId
                  ? `Cuenta profesional · ••••${instagramUserId.slice(-4)}`
                  : "Pendiente"}
              </small>
            </span>
            <span
              className={`integrations-v2-status ${
                instagramUserId ? "is-active" : "is-available"
              }`}
            >
              {instagramUserId ? "Configurado" : "Configurar"}
            </span>
          </div>
        </div>

        <form className="integration-detail-v2-form" action={saveMetaInboxConnection}>
          <label className="integration-detail-v2-field">
            <span>Facebook Page access token</span>
            <input type="password" name="page_access_token" autoComplete="new-password" />
          </label>

          <label className="integration-detail-v2-field">
            <span>Facebook Page ID</span>
            <input type="text" name="page_id" inputMode="numeric" autoComplete="off" />
          </label>

          <label className="integration-detail-v2-field">
            <span>Instagram access token</span>
            <input
              type="password"
              name="instagram_access_token"
             
              autoComplete="new-password"
            />
          </label>

          <label className="integration-detail-v2-field">
            <span>Instagram User ID</span>
            <input
              type="text"
              name="instagram_user_id"
             
              inputMode="numeric"
              autoComplete="off"
            />
          </label>

          <label className="integration-detail-v2-field">
            <span>Versión de Graph API</span>
            <input
              type="text"
              name="graph_api_version"
              required
              defaultValue="v26.0"
              autoComplete="off"
            />
          </label>

          <label className="integration-detail-v2-field">
            <span>Meta App Secret</span>
            <input type="password" name="app_secret" autoComplete="new-password" />
            <small>Escríbelo directamente aquí. No lo compartas por chat.</small>
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
          </label>

          <button className="integration-detail-v2-button" type="submit">
            Guardar conexión segura
          </button>
        </form>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Webhook de Demi</h2>
            <p>
              Usa el mismo callback para Instagram y Messenger. Meta debe poder acceder
              públicamente a esta URL para verificar y entregar mensajes.
            </p>
          </div>
        </div>

        {callbackUrl ? (
          <div className="integration-detail-v2-list">
            <label className="integration-detail-v2-field">
              <span>Callback URL de este entorno</span>
              <input type="text" readOnly value={callbackUrl} />
            </label>
            {verifyToken ? (
              <label className="integration-detail-v2-field">
                <span>Verify token</span>
                <input type="text" readOnly value={verifyToken} />
              </label>
            ) : null}
          </div>
        ) : null}

        {!serviceRoleConfigured || !openAIConfigured ? (
          <div className="integration-detail-v2-notice is-error">
            Este entorno todavía no tiene todas las credenciales de runtime de Studio Flow.
          </div>
        ) : null}
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Piloto controlado</h2>
            <p>
              Si Demi está en modo piloto, solo responderá a los IDs de Meta autorizados aquí.
              Déjalos vacíos para no autorizar ningún contacto en ese canal.
            </p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Instagram</strong>
              <small>{instagramPilot ? `Autorizado: ${instagramPilot}` : "Sin contacto autorizado"}</small>
            </span>
          </div>
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Messenger</strong>
              <small>{messengerPilot ? `Autorizado: ${messengerPilot}` : "Sin contacto autorizado"}</small>
            </span>
          </div>
        </div>

        <form className="integration-detail-v2-form" action={saveMetaInboxPilotContacts}>
          <label className="integration-detail-v2-field">
            <span>Instagram sender ID de prueba</span>
            <input type="text" name="instagram_contact_id" inputMode="numeric" autoComplete="off" />
          </label>
          <label className="integration-detail-v2-field">
            <span>Messenger PSID de prueba</span>
            <input type="text" name="messenger_contact_id" inputMode="numeric" autoComplete="off" />
          </label>
          <button className="integration-detail-v2-button" type="submit">
            Guardar contactos del piloto
          </button>
        </form>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Alcance de esta UAT</h2>
            <p>
              Primero validamos que Demi reciba, entienda, registre en CRM y responda por ambos
              canales antes de habilitar acciones sensibles.
            </p>
          </div>
        </div>

        <div className="integration-detail-v2-list">
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Disponible</strong>
              <small>Mensajes de texto, contexto conversacional, CRM y atribución por canal.</small>
            </span>
          </div>
          <div className="integration-detail-v2-row">
            <span className="integration-detail-v2-row-copy">
              <strong>Protegido por ahora</strong>
              <small>
                Reservas, pagos, archivos y consulta de datos privados de una alumna existente
                siguen en WhatsApp o en la app hasta incorporar verificación de identidad.
              </small>
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
