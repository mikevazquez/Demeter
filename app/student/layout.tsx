import Link from "next/link";

import { signOut } from "@/app/auth/actions";
import { getPendingStudentRewardNotices } from "@/lib/student/reward-notices";
import { getStudentPortalContext } from "@/lib/student/portal";

import PendingActionButton from "./components/PendingActionButton";
import RewardUnlockedNotice from "./components/RewardUnlockedNotice";
import { StudentNav } from "./StudentNav";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const [{ snapshot, studio }, rewardNotices] = await Promise.all([
    getStudentPortalContext(),
    getPendingStudentRewardNotices(),
  ]);

  return (
    <div className="min-h-screen bg-[#090a0f] text-white">
      <header className="border-b border-white/10 bg-[#0d0e14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/student" className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-fuchsia-300">
              Studio Flow
            </p>
            <p className="truncate text-sm font-semibold text-white">{studio.name}</p>
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-white">{snapshot.profile.first_name}</p>
              <p className="text-xs text-zinc-500">Portal de alumna</p>
            </div>
            <form action={signOut}>
              <PendingActionButton
                pendingLabel="Saliendo…"
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-wait disabled:opacity-60"
              >
                Salir
              </PendingActionButton>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 pb-32 pt-6 sm:px-6 lg:px-8 lg:pb-10">
        <StudentNav />
        <div className="min-w-0 flex-1">
          <RewardUnlockedNotice notices={rewardNotices} />
          {children}
        </div>
      </div>
    </div>
  );
}
