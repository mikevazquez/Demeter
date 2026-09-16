import Link from "next/link";

import { getCoachContext } from "@/lib/auth/coach-context";

import { CoachNav } from "./CoachNav";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const { studio, person } = await getCoachContext();
  const coachName = [person.first_name, person.last_name].filter(Boolean).join(" ");

  return (
    <div className="min-h-screen bg-[#090a0f] text-white">
      <header className="border-b border-white/10 bg-[#0d0e14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/coach" className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-fuchsia-300">
              Studio Flow
            </p>
            <p className="truncate text-sm font-semibold text-white">{studio.name}</p>
          </Link>
          <div className="text-right">
            <p className="text-sm font-medium text-white">{coachName}</p>
            <p className="text-xs text-zinc-500">Coach</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10">
        <CoachNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
