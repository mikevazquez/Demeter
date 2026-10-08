import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getMetaWhatsAppAdminDiagnostics } from "@/lib/assistant/meta-whatsapp-admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isMetaWhatsAppTemplateKey,
  metaWhatsAppStatusLabel,
  metaTemplateKeyForNotification,
  META_WHATSAPP_TEMPLATE_PARAMETERS,
} from "@/lib/notifications/meta-template-catalog";
import {
  getNotificationProcess,
  NOTIFICATION_EMOJI_BY_KEY,
  NOTIFICATION_PROCESS_CATEGORIES,
  type NotificationChannelKey,
} from "@/lib/notifications/admin-catalog";
import {
  saveNotificationLeadTimeAction,
  saveNotificationMessageAction,
  submitNotificationWhatsAppTemplateAction,
  mapApprovedNotificationWhatsAppTemplateAction,
  toggleNotificationChannelAction,
  toggleNotificationProcessAction,
} from "../actions";

type ChannelSnapshot = {
  channel_key: string;
  is_required: boolean;
  ordinal: number;
  channel_policy: Record<string, unknown>;
};

type RuleSnapshot = {
  id: string;
  rule_key: string;
  enabled: boolean;
  version_number: number;
  notification_type: string;
  timing_strategy_key: string;
  timing_config: Record<string, unknown>;
  template_key: string;
  channels: ChannelSnapshot[];
};

type SettingsSnapshot = {
  push_enabled: boolean;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
};

type ControlSnapshot = {
  rules: RuleSnapshot[];
  settings: SettingsSnapshot;
};

const channelLabels: Record<NotificationChannelKey, string> = {
  inbox: "Inbox",
  push: "Push",
  whatsapp: "WhatsApp",
  email: "Email",
};

function safeSnapshot(value: unknown): ControlSnapshot {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const settings =
    raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)
      ? (raw.settings as Record<string, unknown>)
      : {};

  return {
    rules: Array.isArray(raw.rules) ? (raw.rules as RuleSnapshot[]) : [],
    settings: {
      push_enabled: settings.push_enabled !== false,
      whatsapp_enabled: settings.whatsapp_enabled !== false,
      email_enabled: settings.email_enabled === true,
    },
  };
}

function channelCoverage(rules: RuleSnapshot[], channel: NotificationChannelKey) {
  const withChannel = rules.filter((rule) =>
    rule.channels.some((item) => item.channel_key === channel),
  ).length;
  if (withChannel === 0) return "none" as const;
  if (withChannel === rules.length) return "all" as const;
  return "some" as const;
}

function firstChannelPolicy(rules: RuleSnapshot[], channel: NotificationChannelKey) {
  for (const rule of rules) {
    const current = rule.channels.find((item) => item.channel_key === channel);
    if (current) return current.channel_policy ?? {};
  }
  return {};
}

function policyText(policy: Record<string, unknown>, key: string) {
  const value = policy[key];
  return typeof value === "string" ? value : "";
}

const fallbackMessages: Record<string, { title: string; body: string }> = {
  "reservation-confirmed": {
    title: "✅ Reserva confirmada",
    body: "Tu lugar quedó reservado. Consulta los detalles en Studio Flow.",
  },
  "reservation-cancelled": {
    title: "❌ Reserva cancelada",
    body: "Tu reserva fue cancelada. Consulta los detalles en Studio Flow.",
  },
  "reservation-rescheduled": {
    title: "🗓️ Cambio de horario",
    body: "El horario de una de tus clases cambió. Revisa la nueva hora en Studio Flow.",
  },
  "class-reminder": {
    title: "⏰ Tu clase es pronto",
    body: "Tienes una clase próxima. Revisa el horario y los detalles en Studio Flow.",
  },
  "rescheduled-class-reminder": {
    title: "⏰ Tu clase reprogramada es pronto",
    body: "Revisa el horario actualizado de tu próxima clase en Studio Flow.",
  },
  "minimum-cancelled-students": {
    title: "📢 Clase cancelada",
    body: "La sesión fue cancelada por no alcanzar el mínimo de reservas.",
  },
  "minimum-cancelled-coach": {
    title: "📢 Clase cancelada",
    body: "La sesión asignada fue cancelada por no alcanzar el mínimo de reservas.",
  },
  "waitlist-promoted": {
    title: "🎉 ¡Ya tienes lugar!",
    body: "Se liberó un lugar y tu reserva quedó confirmada.",
  },
  "evaluation-invitation": {
    title: "✨ Tienes una evaluación disponible",
    body: "Ya puedes agendar tu evaluación desde Studio Flow.",
  },
  "evaluation-scheduled": {
    title: "📅 Evaluación programada",
    body: "Tu evaluación quedó programada.",
  },
  "evaluation-completed": {
    title: "🏅 Resultados disponibles",
    body: "Ya puedes consultar los resultados de tu evaluación.",
  },
};

function Feedback({ error, saved }: { error?: string; saved?: string }) {
  if (!error && !saved) return null;

  const errorCopy: Record<string, string> = {
    notification_whatsapp_provider_managed:
      "WhatsApp usa una plantilla administrada en Meta; el texto se edita y aprueba allí.",
    notification_inbox_required: "Inbox es obligatorio y no se puede desactivar.",
    notification_message_title_body_required: "El título y el mensaje son obligatorios.",
    notification_timing_out_of_range: "La anticipación debe estar entre 0 minutos y 7 días.",
    notification_process_essential: "Este proceso esencial debe permanecer activo.",
    notification_email_provider_not_configured:
      "Email no se puede activar: falta configurar un proveedor de envío.",
    notification_push_provider_not_configured:
      "Push no se puede activar: falta la configuración técnica de VAPID.",
    notification_whatsapp_template_not_approved:
      "WhatsApp no se puede activar: asigna una plantilla aprobada de Meta a todas las variantes del evento.",
    notification_whatsapp_template_unsupported:
      "Este evento aún no tiene variables de WhatsApp compatibles con el motor de envío.",
    notification_whatsapp_template_mapping_failed:
      "No se pudo guardar la asignación de la plantilla aprobada.",
    meta_template_variables_invalid:
      "Usa todas las variables requeridas y en orden, por ejemplo {{1}}, {{2}}.",
    meta_template_submission_failed:
      "Meta no aceptó la solicitud de plantilla. Revisa el contenido e inténtalo de nuevo.",
    meta_template_name_invalid: "El nombre debe usar minúsculas, números y guion bajo.",
    meta_template_language_invalid: "Usa un idioma con formato es_MX.",
    meta_template_category_invalid: "Selecciona una categoría válida de Meta.",
    meta_template_body_invalid: "El mensaje debe tener entre 1 y 1024 caracteres.",
  };

  return (
    <div className={error ? "notification-feedback is-error" : "notification-feedback is-success"}>
      {error
        ? (errorCopy[error] ??
          "No se pudo guardar el cambio. La configuración anterior se conserva.")
        : "Cambios guardados correctamente."}
    </div>
  );
}

export default async function NotificationProcessPage({
  params,
  searchParams,
}: {
  params: Promise<{ processKey: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [{ processKey }, query] = await Promise.all([params, searchParams]);
  const process = getNotificationProcess(processKey);
  if (!process || process.planned || process.ruleKeys.length === 0) notFound();
  const processCategoryLabel =
    NOTIFICATION_PROCESS_CATEGORIES.find((category) => category.key === process.category)?.label ??
    "Proceso";

  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_READ);
  const canManage = ctx.can(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { data } = await ctx.supabase.rpc("admin_notification_rules_snapshot", {
    p_studio_id: ctx.studio.id,
  });
  const snapshot = safeSnapshot(data);
  const ruleMap = new Map(snapshot.rules.map((rule) => [rule.rule_key, rule]));
  const rules = process.ruleKeys
    .map((key) => ruleMap.get(key))
    .filter((rule): rule is RuleSnapshot => Boolean(rule));

  if (rules.length !== process.ruleKeys.length) notFound();

  const [metaDiagnostics, pushConfig] = await Promise.all([
    getMetaWhatsAppAdminDiagnostics(ctx.studio.id),
    createServiceClient().rpc("service_get_push_vapid_config"),
  ]);

  const enabled = rules.every((rule) => rule.enabled);
  const uniqueTemplates = new Set(rules.map((rule) => rule.template_key));
  const canEditSharedMessage = uniqueTemplates.size === 1;
  const fallback = fallbackMessages[process.key] ?? {
    title: process.name,
    body: process.description,
  };

  const globalChannels: Record<NotificationChannelKey, boolean> = {
    inbox: true,
    push: snapshot.settings.push_enabled,
    whatsapp: snapshot.settings.whatsapp_enabled,
    email: snapshot.settings.email_enabled,
  };

  const uniqueTemplateKeys = [
    ...new Set(rules.map((rule) => metaTemplateKeyForNotification(rule.template_key))),
  ];
  const hasUnsupportedWhatsAppTemplate = uniqueTemplateKeys.includes(null);
  const supportedTemplateKeys = uniqueTemplateKeys.filter(
    (templateKey): templateKey is NonNullable<typeof templateKey> => templateKey !== null,
  );
  const whatsappReady =
    metaDiagnostics.connected &&
    supportedTemplateKeys.length > 0 &&
    !hasUnsupportedWhatsAppTemplate &&
    supportedTemplateKeys.every((templateKey) => {
      const name = metaDiagnostics.templateMappings[templateKey];
      return Boolean(
        name &&
        metaDiagnostics.templates.some(
          (template) =>
            template.name === name &&
            template.language === metaDiagnostics.templateLanguage &&
            template.status === "APPROVED" &&
            template.variableCount === META_WHATSAPP_TEMPLATE_PARAMETERS[templateKey].length,
        ),
      );
    });
  const pushReady = !pushConfig.error;
  const readiness: Record<"push" | "whatsapp" | "email", { ready: boolean; label: string }> = {
    push: {
      ready: pushReady,
      label: pushReady
        ? "Configuración técnica lista · cada destinatario requiere una suscripción"
        : "Falta configurar VAPID",
    },
    whatsapp: {
      ready: whatsappReady,
      label: whatsappReady
        ? "Conexión y plantillas aprobadas"
        : "Falta una plantilla aprobada y asignada",
    },
    email: { ready: false, label: "Proveedor no configurado · falta integración de email" },
  };

  const leadTimeRule = rules.find((rule) => rule.timing_strategy_key === "before_session_start");
  const leadTimeRaw = leadTimeRule?.timing_config?.minutes_before;
  const leadTime =
    typeof leadTimeRaw === "number"
      ? leadTimeRaw
      : typeof leadTimeRaw === "string"
        ? Number(leadTimeRaw)
        : null;

  return (
    <main className="dashboard-shell notification-detail-page admin-ux04-secondary-detail">
      <header className="notification-detail-header">
        <Link href="/admin/notificaciones?tab=procesos">← Procesos</Link>
        <div className="notification-detail-title-row">
          <span className="notification-detail-icon" aria-hidden="true">
            {NOTIFICATION_EMOJI_BY_KEY[process.key] ?? "💬"}
          </span>
          <div>
            <span className="notification-category-tag">{processCategoryLabel}</span>
            <div className="notification-title-with-status">
              <h1>{process.name}</h1>
              <span className={enabled ? "is-on" : undefined}>
                {enabled ? "Activo" : "Pausado"}
              </span>
            </div>
            <p>{process.description}</p>
          </div>
        </div>
      </header>

      <Feedback error={query.error} saved={query.saved} />

      <section className="notification-detail-card">
        <div className="notification-detail-card-heading">
          <div>
            <div className="notification-section-title">
              <span className="notification-step-index" aria-hidden="true">
                01
              </span>
              <h2>Información general</h2>
            </div>
            <p>Qué ocurre y a quién se comunica.</p>
          </div>

          {process.essential && enabled ? (
            <span className="notification-essential-badge">🔒 Esencial · activo</span>
          ) : canManage ? (
            <div className="notification-essential-control">
              {process.essential ? (
                <span className="notification-essential-badge">
                  Esencial · pendiente de activar
                </span>
              ) : null}
              <form action={toggleNotificationProcessAction}>
                <input type="hidden" name="process_key" value={process.key} />
                <input type="hidden" name="next_enabled" value={String(!enabled)} />
                <button
                  type="submit"
                  className={enabled ? "notification-switch is-on" : "notification-switch"}
                  aria-label={enabled ? "Pausar proceso" : "Activar proceso"}
                >
                  <span />
                </button>
              </form>
            </div>
          ) : (
            <span className="notification-readonly-badge">Solo lectura</span>
          )}
        </div>

        <div className="notification-general-grid">
          <article>
            <span>Cuándo se envía</span>
            <strong>
              {leadTime !== null
                ? `${leadTime >= 60 && leadTime % 60 === 0 ? leadTime / 60 + " h" : leadTime + " min"} antes`
                : process.timingLabel}
            </strong>
          </article>
          <article>
            <span>A quién se envía</span>
            <strong>{process.recipientLabel}</strong>
          </article>
          <article>
            <span>Aplica para</span>
            <strong>Todas las sesiones elegibles</strong>
          </article>
        </div>
      </section>

      <section className="notification-detail-card">
        <div className="notification-detail-card-heading">
          <div>
            <div className="notification-section-title">
              <span className="notification-step-index" aria-hidden="true">
                02
              </span>
              <h2>Canales de envío</h2>
            </div>
            <p>Activa únicamente los canales que aporten valor a este aviso.</p>
          </div>
        </div>

        <div className="notification-detail-channel-grid">
          {(["inbox", "push", "whatsapp", "email"] as const).map((channel) => {
            const coverage = channelCoverage(rules, channel);
            const active = coverage !== "none";
            const globalEnabled = globalChannels[channel];

            return (
              <article
                key={channel}
                className={!globalEnabled ? "is-globally-disabled" : undefined}
              >
                <div className="notification-detail-channel-head">
                  <span className="notification-channel-symbol" aria-hidden="true">
                    {channel === "inbox"
                      ? "▣"
                      : channel === "push"
                        ? "⌁"
                        : channel === "whatsapp"
                          ? "◉"
                          : "✉"}
                  </span>
                  <div>
                    <strong>{channelLabels[channel]}</strong>
                    <small>
                      {channel === "inbox"
                        ? active
                          ? "Activo · canal fijo"
                          : "No configurado en esta regla"
                        : !globalEnabled
                          ? "Desactivado en Preferencias"
                          : coverage === "some"
                            ? "Activo para parte de los destinatarios"
                            : channel === "email"
                              ? readiness.email.label
                              : channel === "whatsapp"
                                ? readiness.whatsapp.label
                                : readiness.push.label}
                    </small>
                  </div>
                  {canManage && globalEnabled && channel !== "inbox" ? (
                    <form action={toggleNotificationChannelAction}>
                      <input type="hidden" name="process_key" value={process.key} />
                      <input type="hidden" name="channel" value={channel} />
                      <input type="hidden" name="next_enabled" value={String(!active)} />
                      <button
                        type="submit"
                        className={active ? "notification-switch is-on" : "notification-switch"}
                        disabled={!active && !readiness[channel].ready}
                        aria-label={
                          active
                            ? `Desactivar ${channelLabels[channel]}`
                            : `Activar ${channelLabels[channel]}`
                        }
                      >
                        <span />
                      </button>
                    </form>
                  ) : channel === "inbox" ? (
                    <span
                      className={
                        active ? "notification-required-channel" : "notification-readonly-badge"
                      }
                    >
                      {active ? "Fijo" : "Revisar"}
                    </span>
                  ) : (
                    <span className={active ? "channel-dot is-on" : "channel-dot"} />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="notification-detail-card">
        <div className="notification-detail-card-heading">
          <div>
            <div className="notification-section-title">
              <span className="notification-step-index" aria-hidden="true">
                03
              </span>
              <h2>Plantillas de WhatsApp</h2>
            </div>
            <p>
              Plantilla administrada en Meta. Las plantillas de WhatsApp se administran en Meta;
              envía una a revisión y asígnala al evento después de su aprobación.
            </p>
          </div>
          <span
            className={
              metaDiagnostics.connected
                ? "notification-required-channel"
                : "notification-readonly-badge"
            }
          >
            {metaDiagnostics.connected ? "Meta conectada" : "Meta no disponible"}
          </span>
        </div>

        {!metaDiagnostics.connected ? (
          <div className="notification-info-box">
            No se pudo validar Meta. Revisa la conexión de WhatsApp en Integraciones.
          </div>
        ) : (
          <div className="notification-message-grid">
            {supportedTemplateKeys.map((templateKey) => {
              const supported = isMetaWhatsAppTemplateKey(templateKey);
              const mappedName = metaDiagnostics.templateMappings[templateKey];
              const mappedTemplate = mappedName
                ? metaDiagnostics.templates.find(
                    (template) =>
                      template.name === mappedName &&
                      template.language === metaDiagnostics.templateLanguage,
                  )
                : null;
              const candidateTemplates = metaDiagnostics.templates.filter((template) =>
                template.name.startsWith(`demeter_${templateKey}_`),
              );
              const variables = supported ? META_WHATSAPP_TEMPLATE_PARAMETERS[templateKey] : [];
              const suggestedName = templateKey === "coach_roster_reminder"
                ? "demeter_coach_lista_alumnas_v1"
                : templateKey === "class_cancelled_coach"
                  ? "demeter_coach_cancelacion_minimo_v1"
                  : `demeter_${templateKey}_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
              const compatibleApproved = metaDiagnostics.templates.filter(
                (template) =>
                  template.status === "APPROVED" &&
                  template.language === metaDiagnostics.templateLanguage &&
                  template.variableCount === variables.length,
              );

              return (
                <article key={templateKey} className="notification-message-card">
                  <div className="notification-message-card-head">
                    <strong>{templateKey}</strong>
                    <span>
                      {mappedTemplate
                        ? metaWhatsAppStatusLabel(mappedTemplate.status)
                        : "Sin asignar"}
                    </span>
                  </div>
                  {candidateTemplates
                    .filter((template) => template.name !== mappedName)
                    .map((template) => (
                      <p key={`${template.name}:${template.language}`}>
                        {template.name} · {template.language} · {template.category} ·{" "}
                        {metaWhatsAppStatusLabel(template.status)}
                      </p>
                    ))}
                  {mappedName ? (
                    <p>
                      Plantilla asignada: <code>{mappedName}</code> ·{" "}
                      {mappedTemplate
                        ? `${metaWhatsAppStatusLabel(mappedTemplate.status)} · ${mappedTemplate.category} · ${mappedTemplate.language}`
                        : "No encontrada en Meta"}
                    </p>
                  ) : null}
                  {supported ? (
                    <>
                      <p>Variables requeridas, en orden: {variables.join(", ") || "ninguna"}</p>
                      <form
                        action={submitNotificationWhatsAppTemplateAction}
                        className="notification-message-form"
                      >
                        <input type="hidden" name="process_key" value={process.key} />
                        <input type="hidden" name="template_key" value={templateKey} />
                        <label>
                          <span>Nombre para Meta</span>
                          <input
                            name="meta_template_name"
                            defaultValue={suggestedName}
                            maxLength={512}
                            required
                            pattern="[a-z0-9_]+"
                          />
                        </label>
                        <label>
                          <span>Idioma</span>
                          <input
                            name="language_code"
                            defaultValue={metaDiagnostics.templateLanguage}
                            required
                            pattern="[a-z]{2}_[A-Z]{2}"
                          />
                        </label>
                        <label>
                          <span>Categoría Meta</span>
                          <select
                            name="meta_category"
                            defaultValue={
                              templateKey.startsWith("package_recovery_") ||
                              templateKey === "challenge_invitation" ||
                              templateKey === "workshop_event" ||
                              templateKey === "referral_invitation"
                                ? "MARKETING"
                                : "UTILITY"
                            }
                          >
                            <option value="UTILITY">Servicio / utilidad</option>
                            <option value="MARKETING">Marketing</option>
                          </select>
                        </label>
                        <label>
                          <span>
                            Texto de la plantilla · incluye todas las variables en orden; puedes
                            reutilizarlas
                          </span>
                          <textarea
                            name="meta_body"
                            defaultValue={templateKey === "coach_roster_reminder"
                              ? "Hola {{1}} 👋 Tu clase {{2}} del {{3}} a las {{4}} tiene {{5}} alumnas reservadas. Lista: {{6}}. Consulta tu agenda en Studio Flow si hay cambios."
                              : templateKey === "class_cancelled_coach"
                                ? "Hola {{1}}, tu clase {{2}} del {{3}} a las {{4}} fue cancelada por no alcanzar el mínimo de reservas. Mínimo: {{5}}. Reservas al revisar: {{6}}. No necesitas asistir."
                                : undefined}
                            rows={4}
                            required
                            maxLength={1024}
                            placeholder={variables.map((_, index) => `{{${index + 1}}}`).join(" ")}
                          />
                        </label>
                        <button type="submit">Enviar a revisión de Meta</button>
                      </form>
                      {compatibleApproved.length ? (
                        <form
                          action={mapApprovedNotificationWhatsAppTemplateAction}
                          className="notification-message-form"
                        >
                          <input type="hidden" name="process_key" value={process.key} />
                          <input type="hidden" name="template_key" value={templateKey} />
                          <label>
                            <span>Plantilla aprobada para usar</span>
                            <select
                              name="meta_template_name"
                              defaultValue={
                                mappedName &&
                                compatibleApproved.some((item) => item.name === mappedName)
                                  ? mappedName
                                  : ""
                              }
                              required
                            >
                              <option value="" disabled>
                                Selecciona una plantilla aprobada
                              </option>
                              {compatibleApproved.map((template) => (
                                <option
                                  key={`${template.name}:${template.language}`}
                                  value={template.name}
                                >
                                  {template.name} · {template.language}
                                </option>
                              ))}
                            </select>
                          </label>
                          <input
                            type="hidden"
                            name="language_code"
                            value={metaDiagnostics.templateLanguage}
                          />
                          <button type="submit">Asignar al evento</button>
                        </form>
                      ) : (
                        <div className="notification-info-box">
                          Todavía no hay una plantilla aprobada con las variables requeridas.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="notification-info-box">
                      Este tipo de notificación aún no tiene variables de WhatsApp habilitadas en el
                      motor de envío.
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {hasUnsupportedWhatsAppTemplate ? (
          <div className="notification-info-box">
            Algunas variantes de este evento todavía no tienen integración WhatsApp disponible en el
            motor de envío; el canal seguirá bloqueado.
          </div>
        ) : null}
      </section>

      <section id="mensajes" className="notification-detail-card">
        <div className="notification-detail-card-heading">
          <div>
            <div className="notification-section-title">
              <span className="notification-step-index" aria-hidden="true">
                04
              </span>
              <h2>Mensaje por canal</h2>
            </div>
            <p>Edita lo visible sin exponer la lógica interna del motor.</p>
          </div>
        </div>

        {!canEditSharedMessage ? (
          <div className="notification-info-box">
            Este proceso tiene mensajes distintos para cada destinatario. Studio Flow conserva esas
            plantillas separadas para no enviar el texto de una alumna al coach o viceversa.
          </div>
        ) : (
          <div className="notification-message-grid">
            {(["inbox", "push", "whatsapp", "email"] as const).map((channel) => {
              const coverage = channelCoverage(rules, channel);
              const policy = firstChannelPolicy(rules, channel);
              const title = policyText(policy, "title_template") || fallback.title;
              const body = policyText(policy, "body_template") || fallback.body;
              const custom =
                Boolean(policyText(policy, "title_template")) &&
                Boolean(policyText(policy, "body_template"));

              if (channel === "whatsapp") {
                return (
                  <article key={channel} className="notification-message-card">
                    <div className="notification-message-card-head">
                      <strong>WhatsApp</strong>
                      <span>{coverage === "none" ? "Inactivo" : "Proveedor conectado"}</span>
                    </div>
                    <div className="notification-message-preview">
                      <strong>Plantilla administrada en Meta</strong>
                      <p>
                        Clave enviada por Demeter:{" "}
                        <code>
                          {policyText(policy, "provider_template_key") || rules[0]?.template_key}
                        </code>
                        . El nombre y el texto aprobados se administran en Meta.
                      </p>
                    </div>
                  </article>
                );
              }

              return (
                <article key={channel} className="notification-message-card">
                  <div className="notification-message-card-head">
                    <strong>{channelLabels[channel]}</strong>
                    <span>
                      {channel === "email"
                        ? "Proveedor pendiente"
                        : custom
                          ? "Personalizada"
                          : "Predeterminada"}
                    </span>
                  </div>

                  <div className="notification-message-preview">
                    <strong>{title}</strong>
                    <p>{body}</p>
                  </div>

                  {canManage && coverage !== "none" ? (
                    <form
                      action={saveNotificationMessageAction}
                      className="notification-message-form"
                    >
                      <input type="hidden" name="process_key" value={process.key} />
                      <input type="hidden" name="channel" value={channel} />
                      <label>
                        <span>Título</span>
                        <input name="title_template" defaultValue={title} maxLength={120} />
                      </label>
                      <label>
                        <span>Mensaje</span>
                        <textarea
                          name="body_template"
                          defaultValue={body}
                          rows={3}
                          maxLength={500}
                        />
                      </label>
                      <div>
                        <button type="submit">Guardar mensaje</button>
                        {custom ? (
                          <button type="submit" name="reset" value="true" className="is-secondary">
                            Restablecer
                          </button>
                        ) : null}
                      </div>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {leadTime !== null ? (
        <section className="notification-detail-card">
          <div className="notification-detail-card-heading">
            <div>
              <div className="notification-section-title">
                <span className="notification-step-index" aria-hidden="true">
                  05
                </span>
                <h2>Horario de envío</h2>
              </div>
              <p>Ajusta con cuánta anticipación se envía este recordatorio.</p>
            </div>
          </div>

          <form action={saveNotificationLeadTimeAction} className="notification-advanced-form">
            <input type="hidden" name="process_key" value={process.key} />
            <label className="notification-field">
              <span>Enviar con cuántos minutos de anticipación</span>
              <input
                type="number"
                name="minutes_before"
                min={0}
                max={10080}
                step={15}
                defaultValue={leadTime}
                disabled={!canManage}
              />
              <small>300 minutos = 5 horas. El cambio se aplicará a futuras notificaciones.</small>
            </label>
            {canManage ? <button type="submit">Guardar anticipación</button> : null}
          </form>
        </section>
      ) : null}
    </main>
  );
}
