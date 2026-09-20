import Link from "next/link";

import { formatDateTime, formatMoney } from "@/lib/student/portal";
import {
  actualRewardSavingsMinor,
  getStudentRewardsContext,
  rewardBenefitLabel,
  rewardStatusClass,
  rewardStatusLabel,
} from "@/lib/student/rewards";

import { RewardsEmpty } from "../components";

const filters = [
  { key: "all", label: "Todas" },
  { key: "used", label: "Utilizadas" },
  { key: "expired", label: "Vencidas" },
  { key: "adjusted", label: "Ajustadas" },
] as const;

export default async function StudentRewardHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getStudentRewardsContext();
  const activeView = ["used", "expired", "adjusted"].includes(query.view ?? "")
    ? query.view
    : "all";

  const historical = ctx.rewards
    .filter((reward) => ["redeemed", "expired", "revoked"].includes(reward.status))
    .filter((reward) => {
      if (activeView === "used") return reward.status === "redeemed";
      if (activeView === "expired") return reward.status === "expired";
      if (activeView === "adjusted") return reward.status === "revoked";
      return true;
    })
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/recompensas"
          className="mb-3 inline-flex text-xs font-semibold text-zinc-400 hover:text-white"
        >
          ← Mis recompensas
        </Link>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
          HISTORIAL
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Recompensas anteriores
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Consulta beneficios utilizados, vencidos o ajustados, en orden cronológico.
        </p>
      </header>

      <nav
        aria-label="Filtro de historial de recompensas"
        className="grid grid-cols-4 rounded-2xl border border-white/10 bg-white/[0.03] p-1"
      >
        {filters.map((filter) => {
          const active = activeView === filter.key;
          const href =
            filter.key === "all"
              ? "/student/recompensas/historial"
              : `/student/recompensas/historial?view=${filter.key}`;
          return (
            <Link
              key={filter.key}
              href={href}
              className={
                active
                  ? "rounded-xl bg-fuchsia-600 px-2 py-2.5 text-center text-[10px] font-semibold text-white sm:text-xs"
                  : "rounded-xl px-2 py-2.5 text-center text-[10px] font-semibold text-zinc-400 sm:text-xs"
              }
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {historical.length ? (
        <section className="grid gap-2">
          {historical.map((reward) => {
            const savings = actualRewardSavingsMinor(reward);
            return (
              <Link
                key={reward.id}
                href={`/student/recompensas/${reward.id}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:bg-white/[0.05]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="text-sm text-white">{rewardBenefitLabel(reward)}</strong>
                    <p className="mt-1 text-xs text-zinc-500">
                      {reward.status === "redeemed" && reward.redeemed_at
                        ? formatDateTime(reward.redeemed_at, ctx.studio.timezone)
                        : formatDateTime(
                            reward.revoked_at ?? reward.expires_at ?? reward.created_at,
                            ctx.studio.timezone,
                          )}
                    </p>
                    {reward.status === "redeemed" && savings !== null ? (
                      <p className="mt-1 text-xs font-semibold text-emerald-300">
                        Ahorro real {formatMoney(savings)}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${rewardStatusClass(reward.status)}`}
                  >
                    {rewardStatusLabel(reward.status)}
                  </span>
                </div>
              </Link>
            );
          })}
        </section>
      ) : (
        <RewardsEmpty
          title="No hay recompensas en esta vista"
          detail="Cuando utilices una recompensa o alguna cambie a un estado histórico aparecerá aquí."
        />
      )}
    </main>
  );
}
