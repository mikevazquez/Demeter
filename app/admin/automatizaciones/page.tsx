import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { AUTOMATION_CATALOG } from "@/lib/automations/catalog";
import AutomationNotice from "./AutomationNotice";
import { saveGlobalCommunicationWindowAction } from "./actions";
import "./communication-v2.css";

type Tab = "processes" | "marketing" | "templates" | "preferences";

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  active: "Activa",
  paused: "Pausada",
  error: "Con error",
  archived: "Archivada",
  unconfigured: "Sin configurar",
};

function statusTone(status: string) {
  if (status === "active") return "is-active";
  if (status === "error") return "is-error";
  if (status === "paused") return "is-paused";
  if (status === "draft") return "is-draft";
  return "is-muted";
}

function configValue(configuration: unknown, key: string) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    return "";
  }
  const value = (configuration as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function CommunicationIcon({ kind }: { kind: "process" | "marketing" | "template" }) {
  if (kind === "marketing") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 15V9l11-4v14L4 15Z" />
        <path d="M15 9h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3M7 16l1.5 4h3L10 16" />
      </svg>
    );
  }

  if (kind === "template") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3h9l3 3v15H6V3Z" />
        <path d="M15 3v4h4M9 11h6M9 15h6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v12H4V6Z" />
      <path d="m4 8 8 5 8-5" />
    </svg>
  );
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_READ);
  const canManageNotifications = ctx.can(CAPABILITIES.NOTIFICATIONS_MANAGE);

  const requestedTab = String(params.tab ?? "processes");
  const tab: Tab = ["processes", "marketing", "templates", "preferences"].includes(requestedTab)
    ? (requestedTab as Tab)
    : "processes";

  const [{ data: instances }, { data: communicationSettings }] = await Promise.all([
    ctx.supabase
      .from("automation_instances")
      .select("id,catalog_code,status,current_version_number,updated_at")
      .eq("studio_id", ctx.studio.id)
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    ctx.supabase
      .from("automation_communication_settings")
      .select("global_send_window")
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
  ]);

  const instanceRows = instances ?? [];
  const instanceIds = instanceRows.map((item) => item.id);
  const { data: versions } = instanceIds.length
    ? await ctx.supabase
        .from("automation_instance_versions")
        .select("instance_id,version_number,configuration")
        .in("instance_id", instanceIds)
    : { data: [] };

  const latestByCode = new Map<string, (typeof instanceRows)[number]>();
  for (const instance of instanceRows) {
    if (!latestByCode.has(instance.catalog_code)) {
      latestByCode.set(instance.catalog_code, instance);
    }
  }

  const currentConfiguration = new Map<string, unknown>();
  for (const instance of instanceRows) {
    const version = (versions ?? []).find(
      (item) =>
        item.instance_id === instance.id &&
        item.version_number === instance.current_version_number,
    );
    currentConfiguration.set(instance.catalog_code, version?.configuration ?? {});
  }

  const processes = AUTOMATION_CATALOG.filter((item) =>
    ["operation", "team", "administration"].includes(item.category),
  );
  const marketing = AUTOMATION_CATALOG.filter((item) =>
    ["conversion", "retention"].includes(item.category),
  );
  const templates = AUTOMATION_CATALOG.filter((item) =>
    item.configurableParameters.includes("message_template"),
  );

  const renderAutomationRows = (
    rows: readonly (typeof AUTOMATION_CATALOG)[number][],
    kind: "process" | "marketing",
  ) => (
    <section className="communication-v2-list">
      {rows.map((template) => {
        const instance = latestByCode.get(template.code);
        const status = instance?.status ?? "unconfigured";

        return (
          <Link
            key={template.code}
            href={`/admin/automatizaciones/${template.code}`}
            className="communication-v2-row"
          >
            <span className={`communication-v2-icon is-${kind}`}>
              <CommunicationIcon kind={kind} />
            </span>

            <span className="communication-v2-row-copy">
              <strong>{template.name}</strong>
              <small>{template.description}</small>
              <span className="communication-v2-trigger">
                Cuando: {template.trigger.description}
              </span>
            </span>

            <span className={`communication-v2-status ${statusTone(status)}`}>
              {statusLabels[status] ?? status}
            </span>

            <span className="communication-v2-chevron" aria-hidden="true">›</span>
          </Link>
        );
      })}
    </section>
  );

  return (
    <main className="communication-v2">
      <header className="communication-v2-header">
        <div>
          <h1>Comunicación</h1>
          <p>Define qué mensajes salen del estudio y cuándo deben enviarse.</p>
        </div>
      </header>

      <AutomationNotice error={params.error} saved={params.saved} />

      <nav className="communication-v2-tabs" aria-label="Configuración de comunicación">
        {[
          ["processes", "Procesos"],
          ["marketing", "Marketing"],
          ["templates", "Plantillas"],
          ["preferences", "Preferencias"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/admin/automatizaciones?tab=${key}`}
            className={tab === key ? "is-active" : ""}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "processes" ? (
        <section className="communication-v2-section">
          <div className="communication-v2-section-heading">
            <div>
              <h2>Procesos</h2>
              <p>Reservas, recordatorios, pagos, paquetes y operación del estudio.</p>
            </div>
          </div>
          {renderAutomationRows(processes, "process")}
        </section>
      ) : null}

      {tab === "marketing" ? (
        <section className="communication-v2-section">
          <div className="communication-v2-section-heading">
            <div>
              <h2>Marketing</h2>
              <p>Seguimiento, conversión, renovación y recuperación de alumnas.</p>
            </div>
          </div>
          {renderAutomationRows(marketing, "marketing")}
        </section>
      ) : null}

      {tab === "templates" ? (
        <section className="communication-v2-section">
          <div className="communication-v2-section-heading">
            <div>
              <h2>Plantillas</h2>
              <p>Mensajes que actualmente permiten personalización desde Studio Flow.</p>
            </div>
          </div>

          <section className="communication-v2-template-list">
            {templates.map((template) => {
              const configuration = currentConfiguration.get(template.code);
              const message = configValue(configuration, "message_template");

              return (
                <Link
                  key={template.code}
                  href={`/admin/automatizaciones/${template.code}`}
                  className="communication-v2-template"
                >
                  <span className="communication-v2-icon is-template">
                    <CommunicationIcon kind="template" />
                  </span>
                  <span>
                    <strong>{template.name}</strong>
                    <small>{message || "Plantilla predeterminada"}</small>
                  </span>
                  <span className="communication-v2-chevron" aria-hidden="true">›</span>
                </Link>
              );
            })}
          </section>
        </section>
      ) : null}

      {tab === "preferences" ? (
        <section className="communication-v2-section">
          <div className="communication-v2-section-heading">
            <div>
              <h2>Preferencias</h2>
              <p>Define el horario general permitido para las comunicaciones del estudio.</p>
            </div>
          </div>

          <form action={saveGlobalCommunicationWindowAction} className="communication-v2-preferences">
            <label className="communication-v2-field">
              <span>Horario de envío</span>
              <div className="communication-v2-window-input">
                <input
                  name="global_send_window"
                  defaultValue={communicationSettings?.global_send_window ?? ""}
                  placeholder="09:00-20:00"
                  pattern="([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]"
                  disabled={!canManageNotifications}
                />
                <b>{ctx.studio.timezone}</b>
              </div>
              <small>
                Ejemplo: 09:00-20:00. Fuera de este horario, los mensajes se posponen cuando la regla lo permite.
              </small>
            </label>

            {canManageNotifications ? (
              <button type="submit" className="communication-v2-save">
                Guardar cambios
              </button>
            ) : null}
          </form>
        </section>
      ) : null}
    </main>
  );
}
