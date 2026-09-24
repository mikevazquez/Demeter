import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RuleEditorForm } from "../../recompensas/RuleEditorForm";

export default async function NewChallengePage() {
  await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  return (
    <main className="dashboard-shell space-y-6 admin-ux04-secondary">
      <header>
        <Link href="/admin/retos" className="text-sm font-semibold text-zinc-400 hover:text-white">
          ← Retos
        </Link>
        <p className="mt-4 eyebrow">RETOS · CONFIGURACIÓN</p>
        <h1 className="dashboard-title">Crear reto</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Define objetivo, modalidad, participantes, recompensa y notificaciones antes de publicar.
        </p>
      </header>
      <RuleEditorForm mode="challenge" canManage />
    </main>
  );
}
