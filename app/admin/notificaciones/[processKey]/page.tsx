import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  getNotificationProcess,
  type NotificationChannelKey,
} from "@/lib/notifications/admin-catalog";
import {
  saveNotificationLeadTimeAction,
  saveNotificationMessageAction,
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
    title: "Reserva confirmada",
    body: "Tu lugar quedó reservado. Consulta los detalles en Studio Flow.",
  },
  "reservation-cancelled": {
    title: "Reserva cancelada",
    body: "Tu reserva fue cancelada. Consulta los detalles en Studio Flow.",
  },
  "reservation-rescheduled": {
    title: "Cambio de horario",
    body: "El horario de una de tus clases cambió. Revisa la nueva hora en Studio Flow.",
  },
  "class-reminder": {
    title: "Tu clase es pronto",
    body: "Tienes una clase próxima. Revisa el horario y los detalles en Studio Flow.",
  },
  "minimum-cancelled": {
    title: "Clase cancelada",
    body: "La sesión fue cancelada por no alcanzar el mínimo de reservas.",
  },
  "waitlist-promoted": {
    title: "¡Ya tienes lugar!",
    body: "Se liberó un lugar y tu reserva quedó confirmada.",
  },
  "evaluation-invitation": {
    title: "Tienes una evaluación disponible",
    body: "Ya puedes agendar tu evaluación desde Studio Flow.",
  },
  "evaluation-scheduled": {
    title: "Evaluación programada",
    body: "Tu evaluación quedó programada.",
  },
  "evaluation-completed": {
    title: "Resultados disponibles",
    body: "Ya puedes consultar los resultados de tu evaluación.",
  },
};

function Feedback({ error, saved }: { error?: string; saved?: string }) {
  if (!error && !saved) return null;

  const errorCopy: Record<string, string> = {
    notification_whatsapp_provider_managed:
      "WhatsApp usa una plantilla administrada por Assistian y no se edita desde esta pantalla.",
    notification_message_title_body_required: "El título y el mensaje son obligatorios.",
    notification_timing_out_of_range: "La anticipación debe estar entre 0 minutos y 7 días.",
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

  const enabled = rules.every((rule) => rule.enabled);
  const uniqueTemplates = new Set(rules.map((rule) => rule.template_key));
  const canEditSharedMessage = uniqueTemplates.size === 1;
  const fallback = fallbackMessages[process.key] ?? {
    title: process.name,
    body: process.description,
  };

  const globalChannels: Record<NotificationChannelKey, boolean> = {
    push: snapshot.settings.push_enabled,
    whatsapp: snapshot.settings.whatsapp_enabled,
    email: snapshot.settings.email_enabled,
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
            ◷
          </span>
          <div>
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
            <h2>Información general</h2>
            <p>Qué ocurre y a quién se comunica.</p>
          </div>

          {process.essential ? (
            <span className="notification-essential-badge">🔒 Esencial · siempre activo</span>
          ) : canManage ? (
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
            <h2>Canales de envío</h2>
            <p>Activa únicamente los canales que aporten valor a este aviso.</p>
          </div>
        </div>

        <div className="notification-detail-channel-grid">
          {(["push", "whatsapp", "email"] as const).map((channel) => {
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
                    {channel === "push" ? "⌁" : channel === "whatsapp" ? "◉" : "✉"}
                  </span>
                  <div>
                    <strong>{channelLabels[channel]}</strong>
                    <small>
                      {!globalEnabled
                        ? "Desactivado en Preferencias"
                        : coverage === "some"
                          ? "Activo para parte de los destinatarios"
                          : channel === "email"
                            ? "Proveedor no configurado"
                            : "Canal disponible"}
                    </small>
                  </div>
                  {canManage && globalEnabled ? (
                    <form action={toggleNotificationChannelAction}>
                      <input type="hidden" name="process_key" value={process.key} />
                      <input type="hidden" name="channel" value={channel} />
                      <input type="hidden" name="next_enabled" value={String(!active)} />
                      <button
                        type="submit"
                        className={active ? "notification-switch is-on" : "notification-switch"}
                        aria-label={
                          active
                            ? `Desactivar ${channelLabels[channel]}`
                            : `Activar ${channelLabels[channel]}`
                        }
                      >
                        <span />
                      </button>
                    </form>
                  ) : (
                    <span className={active ? "channel-dot is-on" : "channel-dot"} />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="mensajes" className="notification-detail-card">
        <div className="notification-detail-card-heading">
          <div>
            <h2>Mensaje por canal</h2>
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
            {(["push", "whatsapp", "email"] as const).map((channel) => {
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
                      <span>{coverage === "none" ? "Inactivo" : "Assistian"}</span>
                    </div>
                    <div className="notification-message-preview">
                      <strong>Plantilla administrada en Assistian</strong>
                      <p>
                        Studio Flow envía las variables correctas; el texto aprobado de WhatsApp se
                        mantiene en el proveedor.
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
              <h2>Configuración avanzada</h2>
              <p>Ajusta la anticipación sin tocar reglas técnicas.</p>
            </div>
          </div>

          <form action={saveNotificationLeadTimeAction} className="notification-advanced-form">
            <input type="hidden" name="process_key" value={process.key} />
            <label className="notification-field">
              <span>Minutos antes de la clase</span>
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
