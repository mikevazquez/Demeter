import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../../RewardsNav";
import { RuleEditorForm } from "../../RuleEditorForm";
import ChallengeSavedNotice from "../ChallengeSavedNotice";

export default async function ChallengeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ ruleId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { ruleId } = await params;
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);

  const [{ data: rule }, { data: copyOverride }] = await Promise.all([
    ctx.supabase
      .from("reward_rules")
      .select("id,status,current_version_number,scheduled_start_at,scheduled_end_at,updated_at")
      .eq("id", ruleId)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    ctx.supabase
      .from("reward_rule_copy_overrides")
      .select("title,description,cover_url")
      .eq("rule_id", ruleId)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
  ]);

  if (!rule) notFound();

  const { data: version } = await ctx.supabase
    .from("reward_rule_versions")
    .select(
      "name,description,family,audience_definition,condition_definition,evaluation_definition,cycle_definition,reward_definition,presentation_definition",
    )
    .eq("rule_id", rule.id)
    .eq("version_number", rule.current_version_number)
    .maybeSingle();

  if (!version || version.family !== "challenge") notFound();

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
        <h1 className="dashboard-title">{copyOverride?.title ?? version.name}</h1>
      </header>

      <ChallengeSavedNotice saved={query.saved} />
      {query.error ? <div className="notice error">{query.error}</div> : null}

      <RuleEditorForm
        mode="challenge"
        rule={rule}
        version={version}
        copyOverride={copyOverride}
        canManage={ctx.can(CAPABILITIES.REWARDS_MANAGE)}
        locale={ctx.studio.locale}
        currency={ctx.studio.currency}
        timeZone={ctx.studio.timezone}
      />
    </RewardsShell>
  );
}
