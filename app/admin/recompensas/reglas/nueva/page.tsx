import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { createRewardRuleAction } from "../../actions";
import { RuleForm } from "../../RuleForm";

export default async function NewRewardRulePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  await getAdminContext(CAPABILITIES.REWARDS_MANAGE);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-7 md:px-8">
      <header>
        <Link
          href="/admin/recompensas/reglas"
          className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Reglas
        </Link>
        <p className="eyebrow">NUEVA REGLA</p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">Crear regla</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          Configura la regla completa y guárdala primero como borrador. La activación ocurre
          después de revisar el resumen humano.
        </p>
      </header>

      {params.error ? (
        <div className="notice error">No pudimos guardar el borrador: {params.error}</div>
      ) : null}

      <RuleForm action={createRewardRuleAction} submitLabel="Guardar borrador" />
    </main>
  );
}
