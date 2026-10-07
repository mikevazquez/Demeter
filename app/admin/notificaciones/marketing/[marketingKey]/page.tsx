import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getMetaWhatsAppAdminDiagnostics } from "@/lib/assistant/meta-whatsapp-admin";
import { getAutomationTemplate, type AutomationCatalogCode } from "@/lib/automations/catalog";
import {
  getMarketingCommunication,
  NOTIFICATION_EMOJI_BY_KEY,
} from "@/lib/notifications/admin-catalog";
import { getChannelReadiness } from "@/lib/notifications/channel-readiness";
import {
  isMetaWhatsAppTemplateKey,
  META_WHATSAPP_TEMPLATE_PARAMETERS,
} from "@/lib/notifications/meta-template-catalog";
import { createServiceClient } from "@/lib/supabase/service";
import {
  saveMarketingAutomationConfigurationAction,
  saveMarketingCommunicationAction,
  transitionMarketingAutomationAction,
} from "../../actions";

type MarketingConfig = {
  marketing_key: string;
  status: string;
  audience_key: string;
  send_window: string | null;
  push_enabled: boolean;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  title_template: string | null;
  body_template: string | null;
  cta_label: string | null;
  cta_href: string | null;
};

const audienceLabels: Record<string, string> = {
  all_eligible: "Todas las alumnas elegibles",
  active_students: "Alumnas activas",
  inactive_students: "Alumnas inactivas",
  package_expiring: "Paquete por vencer",
  package_expired: "Paquete vencido",
  trial_no_purchase: "Clase de prueba sin compra",
};

const configurationLabels: Record<string, string> = {
  lead_time: "Anticipación",
  message_template: "Mensaje",
  send_window: "Ventana de envío",
  wait_duration: "Tiempo de espera",
  days_before_expiration: "Días antes del vencimiento",
  optional_filters: "Filtros opcionales",
  allowed_frequency: "Frecuencia permitida",
  inactivity_days: "Días sin asistir",
  elapsed_since_expiration: "Días desde el vencimiento",
};

function fieldType(key: string) {
  return ["days_before_expiration", "inactivity_days", "elapsed_since_expiration"].includes(key)
    ? "number"
    : "text";
}

export default async function MarketingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ marketingKey: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [{ marketingKey }, query] = await Promise.all([params, searchParams]);
  const item = getMarketingCommunication(marketingKey);
  if (!item) notFound();

  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_READ);
  const canManage = ctx.can(CAPABILITIES.AUTOMATIONS_MANAGE);

  const [
    { data: rawMarketing },
    { data: instances },
    { data: rawSnapshot },
    metaDiagnostics,
    pushConfig,
  ] = await Promise.all([
    ctx.supabase.rpc("admin_notification_marketing_snapshot", {
      p_studio_id: ctx.studio.id,
    }),
    item.automationCodes?.length
      ? ctx.supabase
          .from("automation_instances")
          .select("id,catalog_code,status,current_version_number,created_at,updated_at")
          .eq("studio_id", ctx.studio.id)
          .in("catalog_code", [...item.automationCodes])
          .neq("status", "archived")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    ctx.supabase.rpc("admin_notification_rules_snapshot", {
      p_studio_id: ctx.studio.id,
    }),
    getMetaWhatsAppAdminDiagnostics(ctx.studio.id),
    createServiceClient().rpc("service_get_push_vapid_config"),
  ]);

  const configs = Array.isArray(rawMarketing) ? (rawMarketing as MarketingConfig[]) : [];
  const savedConfig = configs.find((config) => config.marketing_key === item.key) ?? null;
  const snapshot =
    rawSnapshot && typeof rawSnapshot === "object" && !Array.isArray(rawSnapshot)
      ? (rawSnapshot as { settings?: Record<string, unknown> })
      : {};
  const settings = snapshot.settings ?? {};
  const whatsappTemplateKey = item.whatsappTemplateKey;
  const whatsappTemplateName = whatsappTemplateKey
    ? metaDiagnostics.templateMappings[whatsappTemplateKey]
    : null;
  const whatsappTemplate = whatsappTemplateName
    ? metaDiagnostics.templates.find(
        (template) =>
          template.name === whatsappTemplateName &&
          template.language === metaDiagnostics.templateLanguage,
      )
    : null;
  const readiness = getChannelReadiness({
    globalEnabled: {
      push: settings.push_enabled !== false,
      whatsapp: settings.whatsapp_enabled === true,
      email: settings.email_enabled === true,
    },
    pushProviderConfigured: !pushConfig.error,
    whatsappConnected: metaDiagnostics.connected,
    whatsappTemplateName,
    whatsappTemplateLanguage: whatsappTemplate?.language ?? metaDiagnostics.templateLanguage,
    whatsappTemplateStatus: whatsappTemplate?.status ?? null,
    whatsappTemplateVariables: whatsappTemplate?.variableCount ?? null,
    expectedWhatsappVariables:
      whatsappTemplateKey && isMetaWhatsAppTemplateKey(whatsappTemplateKey)
      ? META_WHATSAPP_TEMPLATE_PARAMETERS[whatsappTemplateKey].length
      : null,
    emailProviderConfigured: false,
  });
  const instanceRows = instances ?? [];
  const instanceIds = instanceRows.map((instance) => instance.id);

  const { data: versions } = instanceIds.length
    ? await ctx.supabase
        .from("automation_instance_versions")
        .select("instance_id,version_number,configuration")
        .in("instance_id", instanceIds)
        .order("version_number", { ascending: false })
    : { data: [] };

  const configurationByInstance = new Map<string, Record<string, unknown>>();
  for (const instance of instanceRows) {
    const version = (versions ?? []).find(
      (row) =>
        row.instance_id === instance.id && row.version_number === instance.current_version_number,
    );
    const configuration =
      version?.configuration &&
      typeof version.configuration === "object" &&
      !Array.isArray(version.configuration)
        ? (version.configuration as Record<string, unknown>)
        : {};
    configurationByInstance.set(instance.id, configuration);
  }

  const anyActive = instanceRows.some((instance) => instance.status === "active");
  const runtimeLabel = item.automationCodes?.length
    ? anyActive
      ? "Automatización activa"
      : instanceRows.length
        ? "Automatización pausada"
        : "Sin automatización activa"
    : "Borrador";

  const readinessErrorCopy: Record<string, string> = {
    channel_not_ready_push: "No se puede seleccionar Push: falta habilitarlo o configurar VAPID.",
    channel_not_ready_whatsapp:
      "No se puede seleccionar WhatsApp: conecta Meta y asigna una plantilla aprobada compatible.",
    channel_not_ready_email: "No se puede seleccionar Email: falta configurar un proveedor.",
  };
  const feedback = query.error
    ? readinessErrorCopy[query.error] ??
      "No se pudo guardar el cambio. Revisa los datos e inténtalo de nuevo."
    : query.saved
      ? "Cambios guardados correctamente."
      : null;

  return (
    <main className="dashboard-shell notification-detail-page marketing-editor-page admin-ux04-secondary-detail">
      <header className="notification-detail-header">
        <Link href="/admin/notificaciones?tab=marketing">← Marketing</Link>
        <div className="notification-detail-title-row">
          <span className="notification-detail-icon" aria-hidden="true">
            {NOTIFICATION_EMOJI_BY_KEY[item.key] ?? "✨"}
          </span>
          <div>
            <div className="notification-title-with-status">
              <h1>{item.name}</h1>
              <span className={anyActive ? "is-on" : undefined}>{runtimeLabel}</span>
            </div>
            <p>{item.description}</p>
          </div>
        </div>
      </header>

      {feedback ? (
        <div
          className={
            query.error ? "notification-feedback is-error" : "notification-feedback is-success"
          }
        >
          {feedback}
        </div>
      ) : null}

      <form action={saveMarketingCommunicationAction} className="notification-preferences">
        <input type="hidden" name="marketing_key" value={item.key} />

        <section className="notification-detail-card">
          <div className="notification-detail-card-heading">
            <div>
              <h2>Audiencia</h2>
              <p>Define a quién está dirigido este mensaje.</p>
            </div>
          </div>

          <label className="notification-field">
            <span>Segmento</span>
            <select
              name="audience_key"
              defaultValue={savedConfig?.audience_key ?? item.defaultAudience}
              disabled={!canManage}
            >
              {Object.entries(audienceLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="notification-detail-card">
          <div className="notification-detail-card-heading">
            <div>
              <h2>Canales</h2>
                <p>Selecciona canales con proveedor y configuración disponibles.</p>
            </div>
          </div>

          <div className="notification-channel-settings-grid">
            <label>
              <span className="notification-channel-symbol">⌁</span>
              <span>
                <strong>Push</strong>
                <small>Notificación dentro de Studio Flow</small>
              </span>
              <small className="notification-channel-readiness">
                {readiness.push.label}. {readiness.push.detail}
              </small>
              <input
                type="checkbox"
                name="push_enabled"
                defaultChecked={savedConfig?.push_enabled ?? true}
                disabled={!canManage || !readiness.push.ready}
              />
            </label>

            <label>
              <span className="notification-channel-symbol">◉</span>
              <span>
                <strong>WhatsApp</strong>
                <small>Sujeto a consentimiento y plantilla disponible</small>
              </span>
              <small className="notification-channel-readiness">
                {readiness.whatsapp.label}. {readiness.whatsapp.detail}
              </small>
              <input
                type="checkbox"
                name="whatsapp_enabled"
                defaultChecked={savedConfig?.whatsapp_enabled ?? false}
                disabled={!canManage || !readiness.whatsapp.ready}
              />
            </label>

            <label>
              <span className="notification-channel-symbol">✉</span>
              <span>
                <strong>Email</strong>
                <small>Proveedor todavía no configurado</small>
              </span>
              <small className="notification-channel-readiness">
                {readiness.email.label}. {readiness.email.detail}
              </small>
              <input
                type="checkbox"
                name="email_enabled"
                defaultChecked={savedConfig?.email_enabled ?? false}
                disabled={!canManage || !readiness.email.ready}
              />
            </label>
          </div>
        </section>

        <section className="notification-detail-card" id="mensaje">
          <div className="notification-detail-card-heading">
            <div>
              <h2>Mensaje</h2>
              <p>
                Este contenido queda guardado como borrador hasta que el flujo esté listo para
                enviar.
              </p>
            </div>
          </div>

          {item.whatsappTemplateKey ? (
            <div className="notification-info-box">
              WhatsApp utilizará la plantilla de Meta <strong>{item.whatsappTemplateName}</strong>
              {" · "}es_MX. El contenido aprobado se administra en Meta; Studio Flow completa sus
              variables al ocurrir el evento.
            </div>
          ) : null}

          <div className="notification-message-form marketing-message-editor">
            <label>
              <span>Título</span>
              <input
                name="title_template"
                defaultValue={savedConfig?.title_template ?? item.defaultTitle}
                maxLength={120}
                disabled={!canManage}
              />
            </label>

            <label>
              <span>Mensaje</span>
              <textarea
                name="body_template"
                defaultValue={savedConfig?.body_template ?? item.defaultBody}
                rows={4}
                maxLength={700}
                disabled={!canManage}
              />
            </label>

            <div className="marketing-cta-grid">
              <label>
                <span>Texto del botón · opcional</span>
                <input
                  name="cta_label"
                  defaultValue={savedConfig?.cta_label ?? ""}
                  placeholder="Reservar ahora"
                  maxLength={50}
                  disabled={!canManage}
                />
              </label>
              <label>
                <span>Enlace · opcional</span>
                <input
                  name="cta_href"
                  defaultValue={savedConfig?.cta_href ?? ""}
                  placeholder="/alumna/reservar"
                  maxLength={300}
                  disabled={!canManage}
                />
              </label>
            </div>
          </div>
        </section>

        <section className="notification-detail-card">
          <div className="notification-detail-card-heading">
            <div>
              <h2>Horario</h2>
              <p>Respeta además el límite global configurado en Preferencias.</p>
            </div>
          </div>

          <label className="notification-field">
            <span>Ventana de envío · opcional</span>
            <input
              name="send_window"
              defaultValue={savedConfig?.send_window ?? ""}
              placeholder="08:00-21:00"
              disabled={!canManage}
            />
            <small>Si la dejas vacía, se usa la ventana global de Marketing.</small>
          </label>
        </section>

        {canManage ? (
          <div className="notification-form-actions marketing-save-bar">
            <button type="submit">Guardar cambios</button>
          </div>
        ) : null}
      </form>

      {item.automationCodes?.length ? (
        <section className="notification-detail-card">
          <div className="notification-detail-card-heading">
            <div>
              <h2>Automatización conectada</h2>
              <p>Estos parámetros sí controlan el flujo automático que ya existe.</p>
            </div>
          </div>

          {!instanceRows.length ? (
            <div className="notification-info-box">
              Este mensaje ya tiene un disparador definido en Studio Flow, pero todavía no existe
              una configuración activa para el estudio.
            </div>
          ) : (
            <div className="marketing-runtime-grid">
              {instanceRows.map((instance) => {
                const template = getAutomationTemplate(
                  instance.catalog_code as AutomationCatalogCode,
                );
                const configuration = configurationByInstance.get(instance.id) ?? {};
                const editableKeys = template.configurableParameters;
                return (
                  <article key={instance.id} className="marketing-runtime-card">
                    <div className="notification-message-card-head">
                      <div>
                        <strong>{template.name}</strong>
                        <p>{template.trigger.description}</p>
                      </div>
                      <span className={instance.status === "active" ? "is-live" : undefined}>
                        {instance.status === "active" ? "Activa" : "Pausada"}
                      </span>
                    </div>

                    {editableKeys.length ? (
                      <form
                        action={saveMarketingAutomationConfigurationAction}
                        className="notification-message-form"
                      >
                        <input type="hidden" name="marketing_key" value={item.key} />
                        <input type="hidden" name="catalog_code" value={template.code} />
                        <input type="hidden" name="instance_id" value={instance.id} />

                        {editableKeys.map((key) => (
                          <label key={key}>
                            <span>{configurationLabels[key] ?? key}</span>
                            <input
                              type={fieldType(key)}
                              min={fieldType(key) === "number" ? 0 : undefined}
                              name={`config_${key}`}
                              defaultValue={
                                configuration[key] == null
                                  ? ""
                                  : typeof configuration[key] === "object"
                                    ? JSON.stringify(configuration[key])
                                    : String(configuration[key])
                              }
                              disabled={!canManage}
                            />
                          </label>
                        ))}

                        {canManage ? <button type="submit">Guardar automatización</button> : null}
                      </form>
                    ) : (
                      <p className="marketing-runtime-note">
                        Este flujo no tiene parámetros manuales. Studio Flow evalúa automáticamente
                        su elegibilidad.
                      </p>
                    )}

                    {canManage ? (
                      <form
                        action={transitionMarketingAutomationAction}
                        className="marketing-runtime-actions"
                      >
                        <input type="hidden" name="marketing_key" value={item.key} />
                        <input type="hidden" name="catalog_code" value={template.code} />
                        <input type="hidden" name="instance_id" value={instance.id} />
                        <input
                          type="hidden"
                          name="next_state"
                          value={instance.status === "active" ? "paused" : "active"}
                        />
                        <button
                          type="submit"
                          className={instance.status === "active" ? "is-pause" : "is-activate"}
                        >
                          {instance.status === "active"
                            ? "Pausar automatización"
                            : "Activar automatización"}
                        </button>
                      </form>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <div className="notification-info-box">
          Puedes editar y guardar esta comunicación desde ahora. Como su disparador todavía no está
          conectado al motor, permanece en <strong>Borrador</strong> y no enviará mensajes
          accidentalmente.
        </div>
      )}
    </main>
  );
}
