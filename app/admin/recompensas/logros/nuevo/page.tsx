import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../../RewardsNav";
import { RuleEditorForm } from "../../RuleEditorForm";

export default async function NewAchievementPage() {
  await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  return (
    <RewardsShell>
      <header>
        <Link
          href="/admin/recompensas/logros"
          className="text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Logros
        </Link>
        <p className="mt-4 eyebrow">CONFIGURAR LOGRO</p>
        <h1 className="dashboard-title">Nuevo logro</h1>
      </header>
      <RuleEditorForm mode="achievement" canManage />
    </RewardsShell>
  );
}
