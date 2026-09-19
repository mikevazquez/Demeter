import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { updateRewardRuleAction } from "../../../actions";
import { RuleForm } from "../../../RuleForm";

export default async function EditRewardRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ ruleId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { ruleId } = await params;
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);

  const { data: rule } = await ctx.supabase
    .from("reward_rules")
    .select("id,status,current_version_number,scheduled_start_at,scheduled_end_at")
    .eq("studio_id", ctx.studio.id)
    .eq("id", ruleId)
    .maybeSingle();

  if (!rule) notFound();

  const { data: version } = await ctx.supabase
    .from("reward_rule_versions")
    .select("*")
    .eq("rule_id", rule.id)
    .eq("version_number", rule.current_version_number)
    .maybeSingle();

  if (!version) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-7 md:px-8">
      <header>
        <Link
          href={`/admin/recompensas/reglas/${rule.id}`}
          className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Detalle de regla
        </Link>
        <p className="eyebrow">NUEVA VERSIÓN</p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">{version.name}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          Guardar estos cambios crea una nueva versión. La versión {rule.current_version_number} y
          las recompensas ya generadas permanecen intactas.
        </p>
      </header>

      {query.error ? (
        <div className="notice error">No pudimos crear la nueva versión: {query.error}</div>
      ) : null}

      <RuleForm
        action={updateRewardRuleAction}
        submitLabel="Crear nueva versión"
        defaults={{
          id: rule.id,
          name: version.name,
          description: version.description,
          family: version.family,
          audienceDefinition: version.audience_definition,
          conditionDefinition: version.condition_definition,
          evaluationDefinition: version.evaluation_definition,
          cycleDefinition: version.cycle_definition,
          rewardDefinition: version.reward_definition,
          presentationDefinition: version.presentation_definition,
          communicationDefinition: version.communication_definition,
          humanSummary: version.human_summary,
          scheduledStartAt: rule.scheduled_start_at,
          scheduledEndAt: rule.scheduled_end_at,
        }}
      />
    </main>
  );
}
