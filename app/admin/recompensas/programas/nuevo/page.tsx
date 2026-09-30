import Link from "next/link";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { createProgramAction } from "../../actions";
import { RewardsShell } from "../../RewardsNav";

export default async function NewProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);

  return (
    <RewardsShell>
      <header>
        <Link
          href="/admin/recompensas/programas"
          className="text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Programas
        </Link>
        <p className="mt-4 eyebrow">NUEVO PROGRAMA · {ctx.studio.name}</p>
        <h1 className="dashboard-title">Crear programa</h1>
      </header>

      {query.error ? (
        <div className="notice error">No se pudo crear el programa: {query.error}</div>
      ) : null}

      <form
        action={createProgramAction}
        className="grid gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
            Nombre
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Ej. Programa de constancia"
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
            Descripción
            <textarea
              name="description"
              rows={3}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">
            Progresión
            <select
              name="progression_mode"
              defaultValue="cumulative"
              className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
            >
              <option value="cumulative">Acumulativa</option>
              <option value="sequential">Secuencial</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">
            Audiencia
            <select
              name="audience_scope"
              defaultValue="all_active_students"
              className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
            >
              <option value="all_active_students">Alumnas activas</option>
              <option value="all_students">Todas las alumnas</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">
            Elegibilidad
            <select
              name="eligibility_mode"
              defaultValue="continuous"
              className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
            >
              <option value="continuous">Debe seguir siendo elegible</option>
              <option value="lock_on_join">Se conserva al entrar</option>
            </select>
          </label>
        </div>

        <div className="flex justify-end">
          <PendingActionButton
            className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white"
            pendingLabel="Creando…"
          >
            Crear y configurar niveles
          </PendingActionButton>
        </div>
      </form>
    </RewardsShell>
  );
}
