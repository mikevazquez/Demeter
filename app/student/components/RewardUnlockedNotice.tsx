import Link from "next/link";

import type { StudentRewardNotice } from "@/lib/student/reward-notices";

import { acknowledgeRewardNoticesAction } from "../recompensas/notice-actions";

export default function RewardUnlockedNotice({ notices }: { notices: StudentRewardNotice[] }) {
  if (!notices.length) return null;

  const prominent = notices.some((notice) => notice.visibility === "high");
  const grouped = notices.length > 1;

  return (
    <section
      aria-live="polite"
      data-reward-unlock-notice
      className={
        prominent
          ? "mb-4 rounded-3xl border border-fuchsia-500/30 bg-[radial-gradient(circle_at_90%_10%,rgba(236,72,153,0.2),transparent_30%),linear-gradient(135deg,rgba(236,72,153,0.1),rgba(255,255,255,0.03))] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
          : "mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
      }
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={
            prominent
              ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-500/15 text-xl text-fuchsia-300"
              : "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/10 text-base text-fuchsia-300"
          }
        >
          ◇
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
            REWARDS
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            {grouped ? `Desbloqueaste ${notices.length} novedades` : notices[0]?.title}
          </h2>

          <div className="mt-3 grid gap-2">
            {notices.map((notice) => (
              <Link
                key={notice.sourceKey}
                href={notice.href}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3.5 py-3 transition hover:bg-white/[0.05]"
              >
                <div className="min-w-0">
                  {grouped ? (
                    <strong className="block text-xs text-white">{notice.title}</strong>
                  ) : null}
                  <p className="mt-0.5 text-xs leading-5 text-zinc-400">{notice.body}</p>
                </div>
                <span aria-hidden="true" className="shrink-0 text-lg text-zinc-500">
                  ›
                </span>
              </Link>
            ))}
          </div>

          <form action={acknowledgeRewardNoticesAction} className="mt-3 flex justify-end">
            {notices.map((notice) => (
              <input
                key={notice.sourceKey}
                type="hidden"
                name="source_key"
                value={notice.sourceKey}
              />
            ))}
            <button
              type="submit"
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-zinc-300 transition hover:text-white"
            >
              Entendido
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
