import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RuleEditorForm } from "../../recompensas/RuleEditorForm";
import ChallengeSavedNotice from "../../recompensas/retos/ChallengeSavedNotice";
import { rewardDefinitionLabel } from "../../recompensas/ui";

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
      "name,description,family,audience_definition,condition_definition,evaluation_definition,cycle_definition,reward_definition,presentation_definition,communication_definition",
    )
    .eq("rule_id", rule.id)
    .eq("version_number", rule.current_version_number)
    .maybeSingle();

  if (!version || version.family !== "challenge") notFound();

  const presentation =
    version.presentation_definition && typeof version.presentation_definition === "object"
      ? (version.presentation_definition as Record<string, unknown>)
      : {};
  const isCompetitive = presentation.competition_mode === "leaderboard";
  const enrollmentCount = isCompetitive
    ? (
        await ctx.supabase
          .from("reward_challenge_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("rule_id", rule.id)
          .eq("studio_id", ctx.studio.id)
          .eq("status", "active")
      ).count
    : null;

  const { data: settlement } = isCompetitive
    ? await ctx.supabase
        .from("reward_challenge_settlements")
        .select("status,winners,settled_at")
        .eq("rule_id", rule.id)
        .eq("studio_id", ctx.studio.id)
        .maybeSingle()
    : { data: null };

  const winnerRows =
    settlement?.winners && Array.isArray(settlement.winners)
      ? settlement.winners.filter(
          (
            item,
          ): item is {
            student_id: string;
            position: number;
            score: number;
          } =>
            Boolean(
              item &&
                typeof item === "object" &&
                "student_id" in item &&
                typeof item.student_id === "string",
            ),
        )
      : [];

  const winnerIds = winnerRows.map((winner) => winner.student_id);
  const { data: winnerStudents } = winnerIds.length
    ? await ctx.supabase
        .from("students")
        .select("id,full_name")
        .eq("studio_id", ctx.studio.id)
        .in("id", winnerIds)
    : { data: [] };

  const winnerNames = new Map(
    (winnerStudents ?? []).map((student) => [student.id, student.full_name]),
  );

  return (
    <main className="dashboard-shell space-y-6 admin-ux04-secondary">
      <header>
        <Link href="/admin/retos" className="text-sm font-semibold text-zinc-400 hover:text-white">
          ← Retos
        </Link>
        <p className="mt-4 eyebrow">RETOS · CONFIGURACIÓN</p>
        <h1 className="dashboard-title">{copyOverride?.title ?? version.name}</h1>
      </header>

      <ChallengeSavedNotice saved={query.saved} />
      {query.error ? <div className="notice error">{query.error}</div> : null}

      {isCompetitive && settlement ? (
        <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-300">
            RESULTADO FINAL
          </p>
          {winnerRows.length ? (
            <>
              <h2 className="mt-2 text-xl font-semibold text-white">
                {winnerRows.length === 1 ? "🥇 Ganadora" : "🏆 Ganadoras"}
              </h2>
              <div className="mt-4 grid gap-3">
                {winnerRows
                  .sort((a, b) => Number(a.position) - Number(b.position))
                  .map((winner) => (
                    <div
                      key={winner.student_id}
                      className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 p-4"
                    >
                      <div>
                        <p className="font-semibold text-white">
                          {Number(winner.position) === 1 ? "🥇 " : ""}
                          {winnerNames.get(winner.student_id) ?? "Alumna"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Posición #{winner.position}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-white">
                          {winner.score} asistencias
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Premio:{" "}
                          {rewardDefinitionLabel(
                            presentation.competition_reward_definition,
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">
              El reto cerró sin una ganadora elegible.
            </p>
          )}
        </section>
      ) : null}

      <RuleEditorForm
        mode="challenge"
        rule={rule}
        version={version}
        copyOverride={copyOverride}
        canManage={ctx.can(CAPABILITIES.REWARDS_MANAGE)}
        enrollmentCount={enrollmentCount}
      />
    </main>
  );
}
