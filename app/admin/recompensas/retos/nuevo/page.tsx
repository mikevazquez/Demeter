import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../../RewardsNav";
import { RuleEditorForm } from "../../RuleEditorForm";

export default async function NewChallengePage() {
  await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  return (
    <RewardsShell>
      <header>
        <Link
          href="/admin/recompensas/retos"
          className="text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Retos
        </Link>
        <p className="mt-4 eyebrow">CONSTRUCTOR DE RETO</p>
        <h1 className="dashboard-title">Nuevo reto especial</h1>
      </header>
      <RuleEditorForm mode="challenge" canManage />
    </RewardsShell>
  );
}
