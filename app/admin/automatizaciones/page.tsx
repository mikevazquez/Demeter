import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { AUTOMATION_CATALOG } from "@/lib/automations/catalog";
import AutomationNotice from "./AutomationNotice";
import { saveGlobalCommunicationWindowAction } from "./actions";

const categoryLabels = {
  operation: "Operación",
  team: "Equipo",
  administration: "Administración",
  conversion: "Conversión",
  retention: "Retención",
} as const;

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  active: "Activa",
  paused: "Pausada",
  error: "Error",
  archived: "Archivada",
};

function statusClass(status: string) {
  if (status === "active") return "bg-emerald-500/15 text-emerald-300";
  if (status === "error") return "bg-rose-500/15 text-rose-300";
  if (status === "paused") return "bg-amber-500/15 text-amber-300";
  if (status === "archived") return "bg-zinc-500/15 text-zinc-400";
  return "bg-sky-500/15 text-sky-300";
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_READ);
  const canManage = ctx.can(CAPABILITIES.AUTOMATIONS_MANAGE);

  const [{ data: instances }, { data: executions }, { data: communicationSettings }] =
    await Promise.all([
      ctx.supabase
        .from("automation_instances")
        .select(
          "id,catalog_code,status,current_version_number,eligible_from,error_code,error_message,first_executed_at,last_executed_at,created_at,updated_at",
        )
        .eq("studio_id", ctx.studio.id)
        .order("updated_at", { ascending: false }),
      ctx.supabase
        .from("automation_executions")
        .select("id,instance_id,status,created_at")
        .eq("studio_id", ctx.studio.id)
        .order("created_at", { ascending: false })
        .limit(500),
      ctx.supabase
        .from("automation_communication_settings")
        .select("global_send_window")
        .eq("studio_id", ctx.studio.id)
        .maybeSingle(),
    ]);

  const instanceRows = instances ?? [];
  const executionRows = executions ?? [];
  const byCode = new Map<string, typeof instanceRows>();

  for (const instance of instanceRows) {
    const rows = byCode.get(instance.catalog_code) ?? [];
    rows.push(instance);
    byCode.set(instance.catalog_code, rows);
  }

  const executionsByInstance = new Map<string, number>();
  for (const execution of executionRows) {
    executionsByInstance.set(
      execution.instance_id,
      (executionsByInstance.get(execution.instance_id) ?? 0) + 1,
    );
  }

  const activeCount = instanceRows.filter((item) => item.status === "active").length;
  const errorCount = instanceRows.filter((item) => item.status === "error").length;

  return (
    <main className="dashboard-shell admin-module-page automation-page">
      <header className="module-header">
        <div>
          <h1>Automatizaciones</h1>
          <p>Flujos, mensajes, recordatorios y configuraciones del estudio.</p>
        </div>
      </header>

      <AutomationNotice error={params.error} saved={params.saved} />

      <section className="panel automation-settings-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">
              Comunicaciones
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              Horario global de comunicaciones
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
              Se aplica a las comunicaciones de alumnas y prospectos. Cada automatización puede
              tener además su propia ventana. La zona horaria del estudio es {ctx.studio.timezone}.
            </p>
          </div>
          <span className="rounded-full bg-zinc-500/15 px-3 py-1 text-xs text-zinc-300">
            {communicationSettings?.global_send_window ?? "Sin restricción global"}
          </span>
        </div>

        <form action={saveGlobalCommunicationWindowAction} className="mt-5 flex flex-wrap gap-3">
          <label className="min-w-[220px] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Ventana global
            </span>
            <input
              name="global_send_window"
              defaultValue={communicationSettings?.global_send_window ?? ""}
              placeholder="09:00-20:00"
              pattern="([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]"
              disabled={!canManage}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-fuchsia-500/60 disabled:opacity-50"
            />
            <span className="mt-1.5 block text-xs text-zinc-500">
              Formato 24 h, por ejemplo 09:00-20:00. Vacío = sin restricción global.
            </span>
          </label>
          {canManage ? (
            <button
              type="submit"
              className="self-start rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500 sm:mt-6"
            >
              Guardar horario
            </button>
          ) : null}
        </form>
      </section>

      <section className="automation-summary-grid">
        <article className="automation-summary-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Catálogo</p>
          <p className="mt-2 text-2xl font-semibold text-white">{AUTOMATION_CATALOG.length}</p>
          <p className="mt-1 text-xs text-zinc-500">automatizaciones predefinidas</p>
        </article>
        <article className="automation-summary-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Activas</p>
          <p className="mt-2 text-2xl font-semibold text-white">{activeCount}</p>
          <p className="mt-1 text-xs text-zinc-500">instancias actualmente ejecutables</p>
        </article>
        <article className="automation-summary-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Con error</p>
          <p className="mt-2 text-2xl font-semibold text-white">{errorCount}</p>
          <p className="mt-1 text-xs text-zinc-500">requieren revisión técnica</p>
        </article>
      </section>

      <section className="automation-list">
        {AUTOMATION_CATALOG.map((template) => {
          const templateInstances = byCode.get(template.code) ?? [];
          const visibleInstances = templateInstances.filter((item) => item.status !== "archived");
          const activeInstances = visibleInstances.filter((item) => item.status === "active");
          const executionCount = templateInstances.reduce(
            (total, item) => total + (executionsByInstance.get(item.id) ?? 0),
            0,
          );
          const primaryStatus =
            activeInstances[0]?.status ??
            visibleInstances[0]?.status ??
            (template.configurationMode === "system_managed" ? "system" : "unconfigured");

          return (
            <Link
              key={template.code}
              href={`/admin/automatizaciones/${template.code}`}
              className="automation-list-row"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-fuchsia-300">
                    {categoryLabels[template.category]}
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-white">{template.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{template.description}</p>
                </div>
                {primaryStatus === "system" ? (
                  <span className="shrink-0 rounded-full bg-violet-500/15 px-2.5 py-1 text-xs text-violet-300">
                    Sistema
                  </span>
                ) : primaryStatus === "unconfigured" ? (
                  <span className="shrink-0 rounded-full bg-zinc-500/15 px-2.5 py-1 text-xs text-zinc-400">
                    Sin configurar
                  </span>
                ) : (
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${statusClass(primaryStatus)}`}
                  >
                    {statusLabels[primaryStatus] ?? primaryStatus}
                  </span>
                )}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-sm">
                <div>
                  <p className="text-zinc-500">Instancias</p>
                  <strong className="mt-1 block text-white">{templateInstances.length}</strong>
                </div>
                <div>
                  <p className="text-zinc-500">Activas</p>
                  <strong className="mt-1 block text-white">{activeInstances.length}</strong>
                </div>
                <div>
                  <p className="text-zinc-500">Ejecuciones</p>
                  <strong className="mt-1 block text-white">{executionCount}</strong>
                </div>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
