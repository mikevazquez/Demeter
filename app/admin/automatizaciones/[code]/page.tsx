import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { AUTOMATION_CATALOG } from "@/lib/automations/catalog";
import AutomationNotice from "../AutomationNotice";
import {
  activateAutomationAction,
  archiveAutomationAction,
  createAutomationAction,
  deleteAutomationDraftAction,
  pauseAutomationAction,
  updateAutomationConfigurationAction,
} from "../actions";

const configurationLabels: Record<string, string> = {
  lead_time: "Anticipación",
  message_template: "Plantilla de mensaje",
  send_window: "Ventana de envío",
  wait_duration: "Tiempo de espera",
  days_before_expiration: "Días antes del vencimiento",
  optional_filters: "Filtros opcionales (JSON)",
  allowed_frequency: "Frecuencia permitida",
  inactivity_days: "Días de inactividad",
  elapsed_since_expiration: "Tiempo desde el vencimiento",
};

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  active: "Activa",
  paused: "Pausada",
  error: "Error",
  archived: "Archivada",
  eligible: "Elegible",
  scheduled: "Programada",
  processing: "Procesando",
  sent: "Enviada",
  accepted: "Aceptada",
  suppressed: "Suprimida",
  cancelled: "Cancelada",
};

const communicationDecisionLabels: Record<string, string> = {
  send: "Enviar",
  defer: "Diferir",
  suppress: "Suprimir",
  substitute: "Sustituir",
  combine: "Combinar",
};

function statusClass(status: string) {
  if (status === "active" || status === "accepted") return "bg-emerald-500/15 text-emerald-300";
  if (status === "error") return "bg-rose-500/15 text-rose-300";
  if (status === "paused" || status === "scheduled") return "bg-amber-500/15 text-amber-300";
  if (status === "processing" || status === "sent" || status === "eligible") {
    return "bg-sky-500/15 text-sky-300";
  }
  return "bg-zinc-500/15 text-zinc-400";
}

function configurationValue(configuration: unknown, key: string) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration))
    return "";
  const value = (configuration as Record<string, unknown>)[key];
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function ConfigurationFields({
  keys,
  configuration,
}: {
  keys: readonly string[];
  configuration?: unknown;
}) {
  if (!keys.length) {
    return (
      <p className="text-sm text-zinc-500">Esta automatización no requiere parámetros editables.</p>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {keys.map((key) => {
        const value = configurationValue(configuration, key);
        const numeric = [
          "days_before_expiration",
          "inactivity_days",
          "elapsed_since_expiration",
        ].includes(key);

        if (key === "optional_filters") {
          return (
            <label key={key} className="md:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {configurationLabels[key] ?? key}
              </span>
              <textarea
                name={`config_${key}`}
                defaultValue={value}
                rows={3}
                placeholder='Ej. {"disciplina":"Pole Fitness"}'
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-fuchsia-500/60"
              />
            </label>
          );
        }

        return (
          <label key={key}>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {configurationLabels[key] ?? key}
            </span>
            <input
              name={`config_${key}`}
              type={numeric ? "number" : "text"}
              min={numeric ? 0 : undefined}
              step={numeric ? 1 : undefined}
              defaultValue={value}
              placeholder={key === "days_before_expiration" ? "Ej. 1" : undefined}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-fuchsia-500/60"
            />
          </label>
        );
      })}
    </div>
  );
}

export default async function AutomationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    instance?: string;
    version?: string;
  }>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const template = AUTOMATION_CATALOG.find((item) => item.code === code);
  if (!template) notFound();

  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_READ);
  const canManage = ctx.can(CAPABILITIES.AUTOMATIONS_MANAGE);

  const { data: instances } = await ctx.supabase
    .from("automation_instances")
    .select(
      "id,catalog_code,status,current_version_number,eligible_from,error_code,error_message,error_at,first_executed_at,last_executed_at,created_at,updated_at",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("catalog_code", template.code)
    .order("created_at", { ascending: false });

  const instanceRows = instances ?? [];
  const instanceIds = instanceRows.map((item) => item.id);

  const [{ data: versions }, { data: executions }, { data: communicationControls }] =
    instanceIds.length
      ? await Promise.all([
          ctx.supabase
            .from("automation_instance_versions")
            .select("instance_id,version_number,configuration,effective_from,created_at")
            .in("instance_id", instanceIds)
            .order("version_number", { ascending: false }),
          ctx.supabase
            .from("automation_executions")
            .select(
              "id,instance_id,version_number,catalog_code,status,scheduled_for,attempt_count,last_error_code,last_error_message,last_error_retryable,created_at,completed_at,data_snapshot,template_snapshot,variables_snapshot",
            )
            .in("instance_id", instanceIds)
            .order("created_at", { ascending: false })
            .limit(50),
          ctx.supabase
            .from("automation_communication_controls")
            .select(
              "id,instance_id,version_number,priority,decision,reason_code,reason,group_key,dominant_key,deferred_until,related_candidate_keys,details,evaluated_at,parent_control_id",
            )
            .in("instance_id", instanceIds)
            .order("evaluated_at", { ascending: false })
            .limit(50),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  const executionRows = executions ?? [];
  const executionIds = executionRows.map((item) => item.id);

  const [{ data: attempts }, { data: events }] = executionIds.length
    ? await Promise.all([
        ctx.supabase
          .from("automation_execution_attempts")
          .select(
            "id,execution_id,attempt_number,status,provider_key,provider_reference,error_code,error_message,retryable,started_at,sent_at,accepted_at,finished_at",
          )
          .in("execution_id", executionIds)
          .order("attempt_number", { ascending: true }),
        ctx.supabase
          .from("automation_execution_events")
          .select(
            "id,execution_id,attempt_id,event_type,from_status,to_status,code,message,details,occurred_at",
          )
          .in("execution_id", executionIds)
          .order("occurred_at", { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }];

  const versionMap = new Map<string, unknown>();
  for (const instance of instanceRows) {
    const current = (versions ?? []).find(
      (version) =>
        version.instance_id === instance.id &&
        version.version_number === instance.current_version_number,
    );
    versionMap.set(instance.id, current?.configuration ?? {});
  }

  const attemptsByExecution = new Map<string, typeof attempts>();
  for (const attempt of attempts ?? []) {
    const rows = attemptsByExecution.get(attempt.execution_id) ?? [];
    rows.push(attempt);
    attemptsByExecution.set(attempt.execution_id, rows);
  }

  const eventsByExecution = new Map<string, typeof events>();
  for (const event of events ?? []) {
    const rows = eventsByExecution.get(event.execution_id) ?? [];
    rows.push(event);
    eventsByExecution.set(event.execution_id, rows);
  }

  const dateTime = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.studio.timezone,
  });
  const formatDate = (value: string | null | undefined) =>
    value ? dateTime.format(new Date(value)) : "—";

  const nonArchived = instanceRows.filter((item) => item.status !== "archived");
  const canCreate =
    canManage && (template.configurationMode === "multiple" || nonArchived.length === 0);

  return (
    <main className="dashboard-shell admin-ux04-secondary-detail automation-detail-page">
      <header>
        <Link
          href="/admin/automatizaciones"
          className="mb-3 inline-flex text-sm font-semibold text-zinc-400 transition hover:text-white"
        >
          ← Automatizaciones
        </Link>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
          {template.category}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">{template.name}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{template.description}</p>
      </header>

      <AutomationNotice error={query.error} saved={query.saved} version={query.version} />

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Disparador</p>
          <p className="mt-2 text-sm font-semibold text-white">{template.trigger.description}</p>
          <p className="mt-2 text-xs text-zinc-500">Tipo: {template.trigger.kind}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Salida</p>
          <p className="mt-2 text-sm font-semibold text-white">{template.output.description}</p>
          <p className="mt-2 text-xs text-zinc-500">
            Prioridad: {template.priority.communication ?? "Interna"}
          </p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Frecuencia</p>
          <p className="mt-2 text-sm font-semibold text-white">{template.frequency.description}</p>
          <p className="mt-2 text-xs text-zinc-500">
            {template.configurationMode === "multiple"
              ? "Permite varias configuraciones"
              : "Una configuración activa"}
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Condiciones protegidas
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {template.protectedConditions.map((condition) => (
            <div
              key={condition}
              className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-zinc-300"
            >
              {condition}
            </div>
          ))}
        </div>
      </section>

      {canCreate ? (
        <section className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.05] p-5">
          <h2 className="text-lg font-semibold text-white">
            {template.configurationMode === "multiple" && nonArchived.length
              ? "Nueva configuración"
              : "Configurar automatización"}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Se crea primero como borrador. Después podrás activarla explícitamente.
          </p>
          <form action={createAutomationAction} className="mt-5 space-y-4">
            <input type="hidden" name="catalog_code" value={template.code} />
            <ConfigurationFields keys={template.configurableParameters} />
            <button
              type="submit"
              className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Crear configuración
            </button>
          </form>
        </section>
      ) : null}

      <section className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Configuraciones
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {instanceRows.length ? `${instanceRows.length} instancia(s)` : "Sin instancias"}
          </h2>
        </div>

        {!instanceRows.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-400">
            Todavía no existe una instancia para esta automatización.
          </div>
        ) : (
          instanceRows.map((instance) => {
            const configuration = versionMap.get(instance.id) ?? {};
            return (
              <article
                key={instance.id}
                id={instance.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-zinc-500">Instancia {instance.id.slice(0, 8)}</p>
                    <h3 className="mt-1 font-semibold text-white">
                      Versión {instance.current_version_number}
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      Elegible desde {formatDate(instance.eligible_from)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs ${statusClass(instance.status)}`}
                  >
                    {statusLabels[instance.status] ?? instance.status}
                  </span>
                </div>

                {instance.error_message ? (
                  <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
                    {instance.error_code ? `${instance.error_code}: ` : ""}
                    {instance.error_message}
                  </div>
                ) : null}

                {instance.status !== "archived" ? (
                  <form
                    action={updateAutomationConfigurationAction}
                    className="mt-5 space-y-4 border-t border-white/10 pt-5"
                  >
                    <input type="hidden" name="catalog_code" value={template.code} />
                    <input type="hidden" name="instance_id" value={instance.id} />
                    <ConfigurationFields
                      keys={template.configurableParameters}
                      configuration={configuration}
                    />
                    {canManage ? (
                      <button
                        type="submit"
                        className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.04]"
                      >
                        Guardar configuración
                      </button>
                    ) : null}
                  </form>
                ) : null}

                {canManage ? (
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-5">
                    {["draft", "paused", "error"].includes(instance.status) ? (
                      <form action={activateAutomationAction}>
                        <input type="hidden" name="catalog_code" value={template.code} />
                        <input type="hidden" name="instance_id" value={instance.id} />
                        <button className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                          Activar
                        </button>
                      </form>
                    ) : null}
                    {instance.status === "active" ? (
                      <form action={pauseAutomationAction}>
                        <input type="hidden" name="catalog_code" value={template.code} />
                        <input type="hidden" name="instance_id" value={instance.id} />
                        <button className="rounded-xl border border-amber-500/30 px-4 py-2 text-sm font-semibold text-amber-200">
                          Pausar
                        </button>
                      </form>
                    ) : null}
                    {instance.status === "draft" ? (
                      <form action={deleteAutomationDraftAction}>
                        <input type="hidden" name="catalog_code" value={template.code} />
                        <input type="hidden" name="instance_id" value={instance.id} />
                        <button className="rounded-xl border border-rose-500/30 px-4 py-2 text-sm font-semibold text-rose-200">
                          Eliminar borrador
                        </button>
                      </form>
                    ) : null}
                    {instance.status !== "archived" ? (
                      <form action={archiveAutomationAction}>
                        <input type="hidden" name="catalog_code" value={template.code} />
                        <input type="hidden" name="instance_id" value={instance.id} />
                        <button className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300">
                          Archivar
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Control de comunicaciones
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Decisiones de comunicación</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Cada registro conserva la prioridad y el motivo por el que Studio Flow decidió enviar,
            diferir, suprimir, sustituir o combinar una comunicación.
          </p>
        </div>

        {communicationControls?.length ? (
          <div className="space-y-3">
            {communicationControls.map((control) => (
              <article
                key={control.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-zinc-500">
                      Control {control.id.slice(0, 8)} · versión {control.version_number}
                    </p>
                    <h3 className="mt-1 text-sm font-semibold text-white">{control.reason}</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {formatDate(control.evaluated_at)} · {control.reason_code}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-fuchsia-500/15 px-2.5 py-1 text-xs text-fuchsia-200">
                      {control.priority}
                    </span>
                    <span className="rounded-full bg-zinc-500/15 px-2.5 py-1 text-xs text-zinc-300">
                      {communicationDecisionLabels[control.decision] ?? control.decision}
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-xs text-zinc-400 md:grid-cols-3">
                  <p>
                    Grupo: <span className="text-zinc-200">{control.group_key ?? "—"}</span>
                  </p>
                  <p>
                    Dominante: <span className="text-zinc-200">{control.dominant_key ?? "—"}</span>
                  </p>
                  <p>
                    Diferida hasta:{" "}
                    <span className="text-zinc-200">{formatDate(control.deferred_until)}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-400">
            Aún no hay decisiones de comunicación registradas para esta automatización.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Historial de ejecuciones
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Ejecuciones auditables</h2>
          <p className="mt-1 text-sm text-zinc-400">
            “Aceptada” significa que el ejecutor/proveedor aceptó la operación; no implica entrega
            ni lectura.
          </p>
        </div>

        {!executionRows.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-400">
            Aún no hay ejecuciones registradas para esta automatización.
          </div>
        ) : (
          executionRows.map((execution) => {
            const executionAttempts = attemptsByExecution.get(execution.id) ?? [];
            const executionEvents = eventsByExecution.get(execution.id) ?? [];
            return (
              <details
                key={execution.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-zinc-500">
                        Ejecución {execution.id.slice(0, 8)} · versión {execution.version_number}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {formatDate(execution.created_at)} · {execution.attempt_count} intento(s)
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${statusClass(execution.status)}`}
                    >
                      {statusLabels[execution.status] ?? execution.status}
                    </span>
                  </div>
                </summary>

                {execution.last_error_message ? (
                  <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
                    {execution.last_error_code ? `${execution.last_error_code}: ` : ""}
                    {execution.last_error_message}
                    {execution.last_error_retryable ? " · reintentable" : ""}
                  </div>
                ) : null}

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Intentos</h3>
                    <div className="mt-2 space-y-2">
                      {executionAttempts.length ? (
                        executionAttempts.map((attempt) => (
                          <div
                            key={attempt.id}
                            className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <strong className="text-white">
                                Intento {attempt.attempt_number}
                              </strong>
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs ${statusClass(attempt.status)}`}
                              >
                                {statusLabels[attempt.status] ?? attempt.status}
                              </span>
                            </div>
                            <p className="mt-2 text-xs text-zinc-500">
                              Inicio {formatDate(attempt.started_at)}
                              {attempt.provider_key ? ` · ${attempt.provider_key}` : ""}
                            </p>
                            {attempt.error_message ? (
                              <p className="mt-2 text-xs text-rose-300">
                                {attempt.error_code}: {attempt.error_message}
                              </p>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-zinc-500">Sin intentos todavía.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-white">Timeline</h3>
                    <div className="mt-2 space-y-2">
                      {executionEvents.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-xl border border-white/10 bg-black/10 p-3"
                        >
                          <p className="text-xs text-zinc-500">{formatDate(event.occurred_at)}</p>
                          <p className="mt-1 text-sm font-semibold text-white">{event.message}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {event.from_status ? `${event.from_status} → ` : ""}
                            {event.to_status} · {event.code ?? event.event_type}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 border-t border-white/10 pt-5 lg:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Datos
                    </p>
                    <pre className="mt-2 overflow-auto rounded-xl bg-black/20 p-3 text-xs text-zinc-300">
                      {JSON.stringify(execution.data_snapshot ?? {}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Plantilla
                    </p>
                    <pre className="mt-2 overflow-auto rounded-xl bg-black/20 p-3 text-xs text-zinc-300">
                      {JSON.stringify(execution.template_snapshot ?? {}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Variables
                    </p>
                    <pre className="mt-2 overflow-auto rounded-xl bg-black/20 p-3 text-xs text-zinc-300">
                      {JSON.stringify(execution.variables_snapshot ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            );
          })
        )}
      </section>
    </main>
  );
}
