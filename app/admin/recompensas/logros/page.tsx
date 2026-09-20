import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../RewardsNav";
import { EmptyState, StatusBadge, asObject, conditionsLabel, rewardDefinitionLabel } from "../ui";

export default async function AchievementsPage() {
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const { data: versions } = await ctx.supabase
    .from("reward_rule_versions")
    .select(
      "rule_id,version_number,name,description,family,condition_definition,reward_definition,presentation_definition,created_at",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("family", "achievement")
    .order("created_at", { ascending: false });

  const ruleIds = [...new Set((versions ?? []).map((version) => version.rule_id))];
  const rulesResult = ruleIds.length
    ? await ctx.supabase
        .from("reward_rules")
        .select("id,status,current_version_number,scheduled_start_at,scheduled_end_at,updated_at")
        .in("id", ruleIds)
        .order("updated_at", { ascending: false })
    : { data: [] };

  const current = new Map(
    (versions ?? []).map((version) => [`${version.rule_id}:${version.version_number}`, version]),
  );
  const rows = (rulesResult.data ?? [])
    .map((rule) => ({
      rule,
      version: current.get(`${rule.id}:${rule.current_version_number}`),
    }))
    .filter((item) => item.version);

  return (
    <RewardsShell>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">LOGROS · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Logros</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Medallas permanentes que forman parte de la trayectoria de la alumna.
          </p>
        </div>
        {ctx.can(CAPABILITIES.REWARDS_MANAGE) ? (
          <Link
            href="/admin/recompensas/logros/nuevo"
            className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white"
          >
            + Nuevo logro
          </Link>
        ) : null}
      </header>

      {!rows.length ? (
        <EmptyState title="Todavía no hay logros configurados" />
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {rows.map(({ rule, version }) => {
            const presentation = asObject(version?.presentation_definition);
            return (
              <Link
                key={rule.id}
                href={`/admin/recompensas/logros/${rule.id}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#FF0A8A]/35"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#FF0A8A]">
                      {presentation.hidden_until_unlocked ? "SECRETO" : "VISIBLE"}
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-white">
                      {version?.name ?? "Logro"}
                    </h2>
                  </div>
                  <StatusBadge status={rule.status} />
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {conditionsLabel(version?.condition_definition)}
                </p>
                <p className="mt-3 text-xs font-semibold text-zinc-500">
                  {rewardDefinitionLabel(version?.reward_definition)}
                </p>
              </Link>
            );
          })}
        </section>
      )}
    </RewardsShell>
  );
}
