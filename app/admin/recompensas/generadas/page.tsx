import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../RewardsNav";
import {
  EmptyState,
  StatusBadge,
  asObject,
  formatDateTime,
  rewardDefinitionLabel,
} from "../ui";

export default async function GeneratedRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; origin?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const status = ["available", "reserved", "redeemed", "expired", "revoked"].includes(
    String(query.status),
  )
    ? String(query.status)
    : "";
  const origin = ["program", "challenge", "achievement", "other"].includes(String(query.origin))
    ? String(query.origin)
    : "";

  let rewardsQuery = ctx.supabase
    .from("reward_instances")
    .select(
      "id,student_id,rule_id,status,kind,benefit_definition,origin_snapshot,expires_at,created_at,revoked_reason",
    )
    .eq("studio_id", ctx.studio.id)
    .order("created_at", { ascending: false })
    .limit(250);
  if (status) rewardsQuery = rewardsQuery.eq("status", status);
  const { data: rawRewards } = await rewardsQuery;

  const rewards = (rawRewards ?? []).filter((reward) => {
    if (!origin) return true;
    const snapshot = asObject(reward.origin_snapshot);
    const source = String(snapshot.source_type ?? snapshot.origin_type ?? snapshot.family ?? "other");
    return source === origin || (origin === "other" && !["program", "challenge", "achievement"].includes(source));
  });

  const studentIds = [...new Set(rewards.map((reward) => reward.student_id))];
  const studentsResult = studentIds.length
    ? await ctx.supabase
        .from("students")
        .select("id,full_name")
        .eq("studio_id", ctx.studio.id)
        .in("id", studentIds)
    : { data: [] };
  const studentMap = new Map((studentsResult.data ?? []).map((student) => [student.id, student]));

  return (
    <RewardsShell>
      <header>
        <p className="eyebrow">RECOMPENSAS GENERADAS · {ctx.studio.name}</p>
        <h1 className="dashboard-title">Recompensas generadas</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Aquí se revisan recompensas ya creadas por el sistema. No se crean recompensas manuales.
        </p>
      </header>

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[220px_220px_auto]">
        <select
          name="status"
          defaultValue={status}
          className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
        >
          <option value="">Todos los estados</option>
          <option value="available">Disponible</option>
          <option value="reserved">En uso</option>
          <option value="redeemed">Utilizada</option>
          <option value="expired">Vencida</option>
          <option value="revoked">Ajustada</option>
        </select>
        <select
          name="origin"
          defaultValue={origin}
          className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
        >
          <option value="">Todos los orígenes</option>
          <option value="program">Programa</option>
          <option value="challenge">Reto</option>
          <option value="achievement">Logro</option>
          <option value="other">Otro</option>
        </select>
        <button className="rounded-xl border border-[#FF0A8A]/30 bg-[#FF0A8A]/10 px-4 py-2.5 text-sm font-semibold text-[#ff64b6]">
          Filtrar
        </button>
      </form>

      {!rewards.length ? (
        <EmptyState title="No hay recompensas con estos filtros" />
      ) : (
        <section className="grid gap-2">
          {rewards.map((reward) => {
            const originSnapshot = asObject(reward.origin_snapshot);
            return (
              <Link
                key={reward.id}
                href={`/admin/recompensas/generadas/${reward.id}`}
                className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 transition hover:border-[#FF0A8A]/35 md:grid-cols-[1.3fr_1fr_auto] md:items-center"
              >
                <div>
                  <strong className="text-white">
                    {rewardDefinitionLabel(reward.benefit_definition)}
                  </strong>
                  <p className="mt-1 text-sm text-zinc-400">
                    {studentMap.get(reward.student_id)?.full_name ?? "Alumna"}
                  </p>
                </div>
                <div className="text-sm text-zinc-400">
                  <p>{String(originSnapshot.title ?? originSnapshot.rule_name ?? "Origen automático")}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatDateTime(reward.created_at)}
                  </p>
                </div>
                <StatusBadge status={reward.status} />
              </Link>
            );
          })}
        </section>
      )}
    </RewardsShell>
  );
}
