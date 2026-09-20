import Link from "next/link";

import {
  rewardBenefitLabel,
  rewardStatusClass,
  rewardStatusLabel,
  type StudentRewardInstance,
} from "@/lib/student/rewards";
import { formatDateTime } from "@/lib/student/portal";

export function RewardStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${rewardStatusClass(status)}`}
    >
      {rewardStatusLabel(status)}
    </span>
  );
}

export function RewardCard({
  reward,
  timezone,
  compact = false,
}: {
  reward: StudentRewardInstance;
  timezone: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/student/recompensas/${reward.id}`}
      className={`block rounded-${compact ? "2xl" : "3xl"} border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/[0.09] via-white/[0.03] to-transparent ${compact ? "p-4" : "p-5"} transition hover:border-fuchsia-400/35`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
            Tu beneficio
          </p>
          <h2 className={`mt-1 font-semibold text-white ${compact ? "text-base" : "text-xl"}`}>
            {rewardBenefitLabel(reward)}
          </h2>
        </div>
        <RewardStatus status={reward.status} />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-xs text-zinc-500">
          {reward.expires_at
            ? `Vence ${formatDateTime(reward.expires_at, timezone)}`
            : "Sin vencimiento definido"}
        </p>
        <span aria-hidden="true" className="text-lg text-zinc-500">
          ›
        </span>
      </div>
    </Link>
  );
}

export function RewardsEmpty({
  title,
  detail,
  actionHref,
  actionLabel,
}: {
  title: string;
  detail: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center">
      <div
        aria-hidden="true"
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 text-lg text-fuchsia-300"
      >
        ◇
      </div>
      <h2 className="mt-3 text-base font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-zinc-400">{detail}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-fuchsia-500"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
