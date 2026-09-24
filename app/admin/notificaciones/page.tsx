import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  MARKETING_COMMUNICATIONS,
  NOTIFICATION_PROCESS_CATEGORIES,
  NOTIFICATION_PROCESSES,
  type NotificationChannelKey,
} from "@/lib/notifications/admin-catalog";
import { saveNotificationPreferencesAction } from "./actions";

type ChannelSnapshot = {
  channel_key: string;
  is_required: boolean;
  ordinal: number;
  channel_policy: Record<string, unknown>;
};

type RuleSnapshot = {
  id: string;
  rule_key: string;
  event_type: string;
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
  non_urgent_send_window: string | null;
  marketing_weekly_limit: number;
};

type ControlSnapshot = {
  rules: RuleSnapshot[];
  settings: SettingsSnapshot;
};

const tabs = [
  { key: "procesos", label: "Procesos" },
  { key: "marketing", label: "Marketing" },
  { key: "plantillas", label: "Plantillas" },
  { key: "preferencias", label: "Preferencias" },
] as const;

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
      non_urgent_send_window:
        typeof settings.non_urgent_send_window === "string"
          ? settings.non_urgent_send_window
          : "08:00-21:00",
      marketing_weekly_limit:
        typeof settings.marketing_weekly_limit === "number"
          ? settings.marketing_weekly_limit
          : 2,
    },
  };
}

function channelState(rules: RuleSnapshot[], channel: NotificationChannelKey) {
  if (!rules.length) return "none" as const;
  const count = rules.filter((rule) =>
    rule.channels.some((item) => item.channel_key === channel),
  ).length;
  if (count === 0) return "none" as const;
  if (count === rules.length) return "all" as const;
  return "some" as const;
}

function Notice({
  error,
  saved,
}: {
  error?: string;
  saved?: string;
}) {
  if (!error && !saved) return null;
  return (
    <div className={error ? "notification-feedback is-error" : "notification-feedback is-success"}>
      {error
        ? "No se pudo guardar el cambio. Revisa la configuración e inténtalo de nuevo."
        : "Cambios guardados correctamente."}
    </div>
  );
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    category?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  const query = await searchParams;
  const activeTab = tabs.some((tab) => tab.key === query.tab) ? query.tab! : "procesos";
  const activeCategory = NOTIFICATION_PROCESS_CATEGORIES.some(
    (category) => category.key === query.category,
  )
    ? query.category!
    : "all";

  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_READ);
  const canManage = ctx.can(CAPABILITIES.AUTOMATIONS_MANAGE);

  const [{ data: rawSnapshot }, { data: automationInstances }] = await Promise.all([
    ctx.supabase.rpc("admin_notification_rules_snapshot", {
      p_studio_id: ctx.studio.id,
    }),
    ctx.supabase
      .from("automation_instances")
      .select("catalog_code,status")
      .eq("studio_id", ctx.studio.id)
      .neq("status", "archived"),
  ]);

  const snapshot = safeSnapshot(rawSnapshot);
  const rulesByKey = new Map(snapshot.rules.map((rule) => [rule.rule_key, rule]));
  const automationRows = automationInstances ?? [];

  const filteredProcesses =
    activeCategory === "all"
      ? NOTIFICATION_PROCESSES
      : NOTIFICATION_PROCESSES.filter((process) => process.category === activeCategory);

  const liveProcesses = NOTIFICATION_PROCESSES.filter(
    (process) =>
      !process.planned &&
      process.ruleKeys.length > 0 &&
      process.ruleKeys.every((ruleKey) => rulesByKey.has(ruleKey)),
  );
  const activeProcesses = liveProcesses.filter((process) =>
    process.ruleKeys.every((ruleKey) => rulesByKey.get(ruleKey)?.enabled),
  );

  return (
    <main className="dashboard-shell admin-module-page notification-admin-page admin-ux04-secondary">
      <header className="notification-page-header">
        <div>
          <p className="notification-eyebrow">Studio Flow</p>
          <h1>Notificaciones</h1>
          <p>Decide qué comunicación se envía, por qué canal y cuándo.</p>
        </div>
        <span className="notification-operation-badge">
          <span aria-hidden="true" />
          Operación activa
        </span>
      </header>

      <nav className="notification-tabs" aria-label="Secciones de notificaciones">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/notificaciones?tab=${tab.key}`}
            className={activeTab === tab.key ? "is-active" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <Notice error={query.error} saved={query.saved} />

      {activeTab === "procesos" ? (
        <>
          <section className="notification-overview-card">
            <div className="notification-overview-heading">
              <div>
                <h2>Comunicación del estudio</h2>
                <p>Estado general de tus avisos y canales configurados.</p>
              </div>
              <span className="notification-operation-badge compact">
                <span aria-hidden="true" />
                Operación activa
              </span>
            </div>

            <div className="notification-kpis">
              <article>
                <strong>{activeProcesses.length}</strong>
                <span>avisos operativos activos</span>
              </article>
              <article>
                <strong>3</strong>
                <span>canales administrables</span>
              </article>
              <article>
                <strong>{NOTIFICATION_PROCESSES.length - liveProcesses.length}</strong>
                <span>procesos por conectar</span>
              </article>
            </div>

            <div className="notification-recommendation">
              <strong>Recomendación:</strong> usa Push para avisos inmediatos y reserva
              WhatsApp para confirmaciones o acciones que realmente requieren atención.
            </div>
          </section>

          <section className="notification-section-heading">
            <div>
              <h2>Procesos del estudio</h2>
              <p>Mensajes de servicio · no promocionales</p>
            </div>
          </section>

          <div className="notification-filter-row">
            {NOTIFICATION_PROCESS_CATEGORIES.map((category) => {
              const count =
                category.key === "all"
                  ? NOTIFICATION_PROCESSES.length
                  : NOTIFICATION_PROCESSES.filter(
                      (process) => process.category === category.key,
                    ).length;
              return (
                <Link
                  key={category.key}
                  href={`/admin/notificaciones?tab=procesos&category=${category.key}`}
                  className={activeCategory === category.key ? "is-active" : undefined}
                >
                  {category.label}
                  <span>{count}</span>
                </Link>
              );
            })}
          </div>

          <section className="notification-process-list">
            {filteredProcesses.map((process) => {
              const processRules = process.ruleKeys
                .map((key) => rulesByKey.get(key))
                .filter((rule): rule is RuleSnapshot => Boolean(rule));
              const live =
                !process.planned &&
                process.ruleKeys.length > 0 &&
                processRules.length === process.ruleKeys.length;
              const enabled = live && processRules.every((rule) => rule.enabled);

              const content = (
                <>
                  <span className="notification-process-icon" aria-hidden="true">
                    {process.category === "evaluaciones"
                      ? "⌁"
                      : process.category === "paquetes"
                        ? "◇"
                        : process.category === "documentos"
                          ? "▤"
                          : process.category === "cuenta"
                            ? "○"
                            : "✓"}
                  </span>
                  <span className="notification-process-copy">
                    <strong>{process.name}</strong>
                    <small>{process.timingLabel}</small>
                  </span>
                  <span className="notification-channel-chips">
                    {(["push", "whatsapp", "email"] as const).map((channel) => {
                      const state = channelState(processRules, channel);
                      return (
                        <span
                          key={channel}
                          className={
                            state === "all"
                              ? "is-on"
                              : state === "some"
                                ? "is-partial"
                                : undefined
                          }
                        >
                          {channelLabels[channel]}
                        </span>
                      );
                    })}
                  </span>
                  <span
                    className={
                      live
                        ? enabled
                          ? "notification-row-status is-on"
                          : "notification-row-status"
                        : "notification-row-status is-planned"
                    }
                  >
                    {live ? (enabled ? "Activo" : "Pausado") : "Pendiente"}
                  </span>
                  <span className="notification-row-chevron" aria-hidden="true">
                    {live ? "›" : ""}
                  </span>
                </>
              );

              return live ? (
                <Link
                  key={process.key}
                  href={`/admin/notificaciones/${process.key}`}
                  className="notification-process-row"
                >
                  {content}
                </Link>
              ) : (
                <div key={process.key} className="notification-process-row is-disabled">
                  {content}
                </div>
              );
            })}
          </section>
        </>
      ) : null}

      {activeTab === "marketing" ? (
        <>
          <section className="notification-section-heading marketing-heading">
            <div>
              <h2>Marketing</h2>
              <p>Comunicación comercial y de engagement con tus alumnas.</p>
            </div>
          </section>

          <section className="notification-process-list">
            {MARKETING_COMMUNICATIONS.map((item) => {
              const codes = item.automationCodes ?? [];
              const rows = automationRows.filter((row) => codes.includes(row.catalog_code));
              const configured = rows.length > 0;
              const active = rows.some((row) => row.status === "active");

              return (
                <article key={item.key} className="notification-process-row marketing-row">
                  <span className="notification-process-icon marketing" aria-hidden="true">
                    {item.key === "birthday" ? "✦" : item.key === "special-promotions" ? "◇" : "↗"}
                  </span>
                  <span className="notification-process-copy">
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="notification-channel-chips">
                    <span className={active ? "is-on" : undefined}>Push</span>
                    <span className={active ? "is-on" : undefined}>WhatsApp</span>
                    <span>Email</span>
                  </span>
                  <span
                    className={
                      configured
                        ? active
                          ? "notification-row-status is-on"
                          : "notification-row-status"
                        : "notification-row-status is-planned"
                    }
                  >
                    {configured ? (active ? "Activo" : "Pausado") : "Borrador"}
                  </span>
                  <span className="notification-row-chevron" />
                </article>
              );
            })}
          </section>

          <div className="notification-info-box">
            Las comunicaciones de recuperación ya existentes siguen ejecutándose con el motor
            actual. Campañas, cumpleaños, retos, referidos y eventos aparecen como borrador hasta
            conectar sus disparadores al motor central; no se enviará nada por accidente.
          </div>
        </>
      ) : null}

      {activeTab === "plantillas" ? (
        <>
          <section className="notification-section-heading">
            <div>
              <h2>Plantillas de mensajes</h2>
              <p>Edita el contenido sin entrar al motor técnico.</p>
            </div>
          </section>

          <section className="notification-process-list">
            {liveProcesses.map((process) => {
              const processRules = process.ruleKeys
                .map((key) => rulesByKey.get(key))
                .filter((rule): rule is RuleSnapshot => Boolean(rule));
              return (
                <Link
                  key={process.key}
                  href={`/admin/notificaciones/${process.key}#mensajes`}
                  className="notification-process-row template-row"
                >
                  <span className="notification-process-icon" aria-hidden="true">
                    ✎
                  </span>
                  <span className="notification-process-copy">
                    <strong>{process.name}</strong>
                    <small>{process.description}</small>
                  </span>
                  <span className="notification-channel-chips">
                    {(["push", "whatsapp", "email"] as const).map((channel) => (
                      <span
                        key={channel}
                        className={
                          channelState(processRules, channel) !== "none" ? "is-on" : undefined
                        }
                      >
                        {channelLabels[channel]}
                      </span>
                    ))}
                  </span>
                  <span className="notification-row-status is-edit">Editar</span>
                  <span className="notification-row-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              );
            })}
          </section>

          <div className="notification-info-box">
            WhatsApp usa plantillas administradas por Assistian. Push e Inbox admiten contenido
            editable desde Studio Flow. Email queda preparado, pero su proveedor todavía no está
            configurado.
          </div>
        </>
      ) : null}

      {activeTab === "preferencias" ? (
        <form action={saveNotificationPreferencesAction} className="notification-preferences">
          <section className="notification-settings-card">
            <div className="notification-settings-heading">
              <div>
                <h2>Canales disponibles</h2>
                <p>Control global para futuras comunicaciones.</p>
              </div>
            </div>
            <div className="notification-channel-settings-grid">
              <label>
                <span className="notification-channel-symbol">⌁</span>
                <span>
                  <strong>Push</strong>
                  <small>Notificaciones en la app</small>
                </span>
                <input
                  type="checkbox"
                  name="push_enabled"
                  defaultChecked={snapshot.settings.push_enabled}
                  disabled={!canManage}
                />
              </label>
              <label>
                <span className="notification-channel-symbol">◉</span>
                <span>
                  <strong>WhatsApp</strong>
                  <small>Mensajes mediante Assistian</small>
                </span>
                <input
                  type="checkbox"
                  name="whatsapp_enabled"
                  defaultChecked={snapshot.settings.whatsapp_enabled}
                  disabled={!canManage}
                />
              </label>
              <label>
                <span className="notification-channel-symbol">✉</span>
                <span>
                  <strong>Email</strong>
                  <small>Proveedor aún no configurado</small>
                </span>
                <input
                  type="checkbox"
                  name="email_enabled"
                  defaultChecked={snapshot.settings.email_enabled}
                  disabled={!canManage}
                />
              </label>
            </div>
          </section>

          <section className="notification-settings-card">
            <div className="notification-settings-heading">
              <div>
                <h2>Horario de comunicaciones no urgentes</h2>
                <p>
                  Se usa para recuperación y marketing. Los avisos operativos críticos no esperan
                  esta ventana.
                </p>
              </div>
            </div>
            <label className="notification-field">
              <span>Ventana de envío</span>
              <input
                name="send_window"
                defaultValue={snapshot.settings.non_urgent_send_window ?? ""}
                placeholder="08:00-21:00"
                disabled={!canManage}
              />
              <small>Formato 24 h: HH:MM-HH:MM</small>
            </label>
          </section>

          <section className="notification-settings-card">
            <div className="notification-settings-heading">
              <div>
                <h2>Límite de marketing</h2>
                <p>Evita saturar a tus alumnas con comunicaciones comerciales.</p>
              </div>
            </div>
            <label className="notification-field">
              <span>Máximo por alumna en 7 días</span>
              <select
                name="marketing_weekly_limit"
                defaultValue={String(snapshot.settings.marketing_weekly_limit)}
                disabled={!canManage}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? "mensaje" : "mensajes"}
                  </option>
                ))}
              </select>
              <small>2 por semana es el valor recomendado para Studio Flow.</small>
            </label>
          </section>

          {canManage ? (
            <div className="notification-form-actions">
              <button type="submit">Guardar preferencias</button>
            </div>
          ) : null}
        </form>
      ) : null}
    </main>
  );
}
