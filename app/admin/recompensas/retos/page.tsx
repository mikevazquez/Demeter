import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../RewardsNav";
import {
  EmptyState,
  StatusBadge,
  asObject,
  conditionsLabel,
  rewardDefinitionLabel,
} from "../ui";

const filterLabels: Record<string, string> = {
  all: "Todos",
  active: "Activos",
  scheduled: "Programados",
  draft: "Borradores",
  finished: "Finalizados",
};

export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const search = String(query.q ?? "").trim().toLocaleLowerCase("es-MX");
  const status = ["active", "scheduled", "draft", "finished"].includes(String(query.status))
    ? String(query.status)
    : "all";

  const { data: versions } = await ctx.supabase
    .from("reward_rule_versions")
    .select(
      "rule_id,version_number,name,description,family,condition_definition,reward_definition,presentation_definition,created_at",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("family", "challenge")
    .order("created_at", { ascending: false });

  const ruleIds = [...new Set((versions ?? []).map((version) => version.rule_id))];
  const [rulesResult, overridesResult] = ruleIds.length
    ? await Promise.all([
        ctx.supabase
          .from("reward_rules")
          .select(
            "id,status,current_version_number,scheduled_start_at,scheduled_end_at,updated_at",
          )
          .in("id", ruleIds)
          .neq("status", "cancelled")
          .order("updated_at", { ascending: false }),
        ctx.supabase
          .from("reward_rule_copy_overrides")
          .select("rule_id,title,description,cover_url")
          .in("rule_id", ruleIds),
      ])
    : [{ data: [] }, { data: [] }];

  const current = new Map(
    (versions ?? []).map((version) => [`${version.rule_id}:${version.version_number}`, version]),
  );
  const overrideMap = new Map(
    (overridesResult.data ?? []).map((override) => [override.rule_id, override]),
  );

  const rows = (rulesResult.data ?? [])
    .map((rule) => ({
      rule,
      version: current.get(`${rule.id}:${rule.current_version_number}`),
      override: overrideMap.get(rule.id),
    }))
    .filter((item) => item.version)
    .filter(({ rule }) => status === "all" || rule.status === status)
    .filter(({ version, override }) => {
      if (!search) return true;
      const haystack = `${override?.title ?? version?.name ?? ""} ${override?.description ?? version?.description ?? ""}`
        .toLocaleLowerCase("es-MX");
      return haystack.includes(search);
    });

  return (
    <RewardsShell>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">RETOS ESPECIALES · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Retos especiales</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Campañas temporales con participación automática y resultados permanentes.
          </p>
        </div>
        {ctx.can(CAPABILITIES.REWARDS_MANAGE) ? (
          <Link
            href="/admin/recompensas/retos/nuevo"
            className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white"
          >
            + Nuevo reto
          </Link>
        ) : null}
      </header>

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:grid-cols-[1fr_auto]">
        <input
          name="q"
          defaultValue={String(query.q ?? "")}
          placeholder="Buscar reto"
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
        />
        <button className="rounded-xl border border-[#FF0A8A]/30 bg-[#FF0A8A]/10 px-4 py-2.5 text-sm font-semibold text-[#ff64b6]">
          Buscar
        </button>
        <div className="flex gap-2 overflow-x-auto lg:col-span-2">
          {Object.entries(filterLabels).map(([value, label]) => (
            <Link
              key={value}
              href={`/admin/recompensas/retos?status=${value}${query.q ? `&q=${encodeURIComponent(String(query.q))}` : ""}`}
              className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ${
                status === value
                  ? "bg-[#FF0A8A] text-white"
                  : "border border-white/10 text-zinc-400"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </form>

      {!rows.length ? (
        <EmptyState title="No hay retos que coincidan con estos filtros" />
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {rows.map(({ rule, version, override }) => {
            const presentation = asObject(version?.presentation_definition);
            const cycleMode =
              presentation.challenge_mode === "periods" ? "POR PERIODOS" : "ACUMULADO";
            return (
              <Link
                key={rule.id}
                href={`/admin/recompensas/retos/${rule.id}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#FF0A8A]/35"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#FF0A8A]">
                      {cycleMode}
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-white">
                      {override?.title ?? version?.name ?? "Reto"}
                    </h2>
                  </div>
                  <StatusBadge status={rule.status} />
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {conditionsLabel(version?.condition_definition)}
                </p>
                <p className="mt-3 text-xs font-semibold text-zinc-500">
                  {presentation.reward_visibility === "surprise"
                    ? "Recompensa sorpresa"
                    : rewardDefinitionLabel(version?.reward_definition)}
                </p>
              </Link>
            );
          })}
        </section>
      )}
    </RewardsShell>
  );
}
