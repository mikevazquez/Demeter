import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  EmptyState,
  StatusBadge,
  familyLabels,
  formatDateTime,
  rewardDefinitionLabel,
} from "../ui";

const groups = [
  { key: "active", title: "Activas", statuses: ["active"] },
  { key: "scheduled", title: "Programadas", statuses: ["scheduled"] },
  { key: "draft", title: "Borradores", statuses: ["draft"] },
  { key: "paused", title: "Pausadas", statuses: ["paused"] },
  { key: "historical", title: "Históricas", statuses: ["finished", "cancelled"] },
] as const;

export default async function RewardRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; family?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const canManage = ctx.can(CAPABILITIES.REWARDS_MANAGE);

  const { data: rules } = await ctx.supabase
    .from("reward_rules")
    .select(
      "id,status,current_version_number,scheduled_start_at,scheduled_end_at,first_activated_at,updated_at",
    )
    .eq("studio_id", ctx.studio.id)
    .order("updated_at", { ascending: false });

  const ruleIds = (rules ?? []).map((rule) => rule.id);
  const { data: versions } = ruleIds.length
    ? await ctx.supabase
        .from("reward_rule_versions")
        .select("rule_id,version_number,name,family,human_summary,reward_definition,created_at")
        .in("rule_id", ruleIds)
    : { data: [] as Array<Record<string, unknown>> };

  const versionMap = new Map(
    (versions ?? []).map((version) => [`${version.rule_id}:${version.version_number}`, version]),
  );

  const query = (params.q ?? "").trim().toLowerCase();
  const filtered = (rules ?? []).filter((rule) => {
    const version = versionMap.get(`${rule.id}:${rule.current_version_number}`);
    const matchesQuery =
      !query ||
      String(version?.name ?? "")
        .toLowerCase()
        .includes(query) ||
      String(version?.human_summary ?? "")
        .toLowerCase()
        .includes(query);
    const matchesState = !params.status || rule.status === params.status;
    const matchesFamily = !params.family || String(version?.family ?? "") === params.family;
    return matchesQuery && matchesState && matchesFamily;
  });

  return (
    <main className="dashboard-shell space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/admin/recompensas"
            className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
          >
            ← Recompensas
          </Link>
          <p className="eyebrow">REGLAS</p>
          <h1 className="dashboard-title">Reglas de Rewards</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
            Cada cambio estructural genera una nueva versión. El historial y las recompensas ya
            creadas permanecen intactos.
          </p>
        </div>
        {canManage ? (
          <Link
            href="/admin/recompensas/reglas/nueva"
            className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            + Crear regla
          </Link>
        ) : null}
      </header>

      {params.error ? (
        <div className="notice error">No se pudo completar la acción: {params.error}</div>
      ) : null}

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_auto_auto_auto]">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Buscar por nombre o resumen"
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white"
        />
        <select
          name="status"
          defaultValue={params.status ?? ""}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white"
        >
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="scheduled">Programada</option>
          <option value="active">Activa</option>
          <option value="paused">Pausada</option>
          <option value="finished">Finalizada</option>
          <option value="cancelled">Cancelada</option>
        </select>
        <select
          name="family"
          defaultValue={params.family ?? ""}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white"
        >
          <option value="">Todas las familias</option>
          <option value="loyalty">Fidelidad</option>
          <option value="attendance">Asistencia</option>
          <option value="challenge">Reto</option>
          <option value="achievement">Logro</option>
        </select>
        <button
          type="submit"
          className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white"
        >
          Filtrar
        </button>
      </form>

      <div className="grid gap-6">
        {groups.map((group) => {
          const rows = filtered.filter((rule) =>
            (group.statuses as readonly string[]).includes(rule.status),
          );
          if (!rows.length && (params.status || params.family || params.q)) return null;

          return (
            <section key={group.key}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">{group.title}</h2>
                <span className="text-xs text-zinc-500">{rows.length}</span>
              </div>
              {!rows.length ? (
                <EmptyState title={`Sin reglas ${group.title.toLowerCase()}`} />
              ) : (
                <div className="grid gap-3">
                  {rows.map((rule) => {
                    const version = versionMap.get(`${rule.id}:${rule.current_version_number}`);
                    return (
                      <Link
                        key={rule.id}
                        href={`/admin/recompensas/reglas/${rule.id}`}
                        className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/35 lg:grid-cols-[1fr_auto]"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
                              {familyLabels[String(version?.family ?? "")] ?? "Rewards"}
                            </p>
                            <StatusBadge status={rule.status} />
                          </div>
                          <h3 className="mt-2 text-lg font-semibold text-white">
                            {String(version?.name ?? "Regla")}
                          </h3>
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                            {String(version?.human_summary ?? "")}
                          </p>
                        </div>
                        <div className="grid content-center gap-1 text-left lg:min-w-52 lg:text-right">
                          <strong className="text-sm text-white">
                            {rewardDefinitionLabel(version?.reward_definition)}
                          </strong>
                          <span className="text-xs text-zinc-500">
                            Versión {rule.current_version_number}
                          </span>
                          <span className="text-xs text-zinc-500">
                            Actualizada {formatDateTime(rule.updated_at)}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {!filtered.length ? (
        <EmptyState title="No encontramos reglas con esos filtros">
          Prueba quitando alguno de los filtros.
        </EmptyState>
      ) : null}
    </main>
  );
}
