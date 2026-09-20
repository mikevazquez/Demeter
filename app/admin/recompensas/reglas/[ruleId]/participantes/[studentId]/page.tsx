import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  EmptyState,
  StatusBadge,
  formatDateTime,
  primaryConditionSummary,
  progressSummary,
  rewardDefinitionLabel,
} from "../../../../ui";

export default async function RewardStudentProgressPage({
  params,
}: {
  params: Promise<{ ruleId: string; studentId: string }>;
}) {
  const { ruleId, studentId } = await params;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);

  const [{ data: rule }, { data: student }, { data: participation }] = await Promise.all([
    ctx.supabase
      .from("reward_rules")
      .select("id,current_version_number,status")
      .eq("studio_id", ctx.studio.id)
      .eq("id", ruleId)
      .maybeSingle(),
    ctx.supabase
      .from("students")
      .select("id,full_name,email")
      .eq("studio_id", ctx.studio.id)
      .eq("id", studentId)
      .maybeSingle(),
    ctx.supabase
      .from("reward_participations")
      .select("*")
      .eq("rule_id", ruleId)
      .eq("student_id", studentId)
      .maybeSingle(),
  ]);

  if (!rule || !student || !participation) notFound();

  const [{ data: version }, { data: cycles }, { data: evaluations }, { data: rewards }] =
    await Promise.all([
      ctx.supabase
        .from("reward_rule_versions")
        .select("*")
        .eq("rule_id", rule.id)
        .eq("version_number", rule.current_version_number)
        .maybeSingle(),
      ctx.supabase
        .from("reward_cycles")
        .select("*")
        .eq("participation_id", participation.id)
        .order("created_at", { ascending: false }),
      ctx.supabase
        .from("reward_progress_evaluations")
        .select(
          "id,cycle_id,evaluation_kind,outcome,candidate_occurred_at,condition_results,progress,evidence,fulfilled,reason_code,evaluated_at",
        )
        .eq("participation_id", participation.id)
        .order("evaluated_at", { ascending: false })
        .limit(50),
      ctx.supabase
        .from("reward_instances")
        .select("id,status,kind,benefit_definition,created_at,expires_at,redeemed_at")
        .eq("rule_id", rule.id)
        .eq("student_id", student.id)
        .order("created_at", { ascending: false }),
    ]);

  if (!version) notFound();

  const cycleIds = (cycles ?? []).map((cycle) => cycle.id);
  const { data: snapshots } = cycleIds.length
    ? await ctx.supabase
        .from("reward_progress_snapshots")
        .select("id,cycle_id,progress,evidence_summary,source_through,calculated_at")
        .in("cycle_id", cycleIds)
        .order("calculated_at", { ascending: false })
    : {
        data: [] as Array<{
          id: string;
          cycle_id: string;
          progress: unknown;
          evidence_summary: unknown;
          source_through: string | null;
          calculated_at: string;
        }>,
      };

  const latestCycle = cycles?.[0] ?? null;
  const latestSnapshot = latestCycle
    ? (snapshots ?? []).find((snapshot) => snapshot.cycle_id === latestCycle.id)
    : null;
  const ignored = (evaluations ?? []).filter((evaluation) => evaluation.outcome === "ignored");
  const corrections = (evaluations ?? []).filter(
    (evaluation) => evaluation.evaluation_kind === "recalculation",
  );

  return (
    <main className="dashboard-shell space-y-6">
      <header>
        <Link
          href={`/admin/recompensas/reglas/${rule.id}/participantes`}
          className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Participantes
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{version.name}</p>
            <h1 className="dashboard-title">{student.full_name}</h1>
            <p className="mt-2 text-sm text-zinc-400">{student.email ?? "Sin correo"}</p>
          </div>
          <StatusBadge status={latestCycle?.status ?? participation.status} />
        </div>
      </header>

      <section className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.05] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
          CONDICIÓN
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">
          {primaryConditionSummary(version.condition_definition)}
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{version.human_summary}</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            PROGRESO ACTUAL
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {latestSnapshot ? progressSummary(latestSnapshot.progress) : "Sin progreso calculado"}
          </h2>
          {latestSnapshot ? (
            <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-zinc-300">
              {JSON.stringify(latestSnapshot.progress, null, 2)}
            </pre>
          ) : (
            <EmptyState title="Aún no hay snapshot" />
          )}
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            CICLO
          </p>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Versión</span>
              <strong className="text-white">
                V{latestCycle?.version_number ?? participation.joined_version_number}
              </strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Inicio</span>
              <strong className="text-white">{formatDateTime(latestCycle?.window_start_at)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Fin</span>
              <strong className="text-white">{formatDateTime(latestCycle?.window_end_at)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Cumplido</span>
              <strong className="text-white">{formatDateTime(latestCycle?.fulfilled_at)}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            DESGLOSE
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Evaluaciones recientes</h2>
          <div className="mt-5 grid gap-2">
            {!(evaluations ?? []).length ? (
              <EmptyState title="Sin evaluaciones" />
            ) : (
              (evaluations ?? []).slice(0, 12).map((evaluation) => (
                <div
                  key={evaluation.id}
                  className="rounded-xl border border-white/10 bg-black/15 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-white">{evaluation.evaluation_kind}</strong>
                    <StatusBadge
                      status={evaluation.fulfilled ? "fulfilled" : evaluation.outcome}
                      label={evaluation.fulfilled ? "Cumplida" : evaluation.outcome}
                    />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    {progressSummary(evaluation.progress)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {formatDateTime(evaluation.evaluated_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            NO CONTÓ / CORRECCIONES
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Evidencia explicable</h2>
          <div className="mt-5 grid gap-2">
            {!ignored.length && !corrections.length ? (
              <EmptyState title="Sin excepciones ni correcciones" />
            ) : (
              [...ignored, ...corrections].slice(0, 12).map((evaluation) => (
                <div
                  key={evaluation.id}
                  className="rounded-xl border border-white/10 bg-black/15 p-4"
                >
                  <strong className="text-sm text-white">
                    {evaluation.evaluation_kind === "recalculation"
                      ? "Recálculo"
                      : "Evento no contado"}
                  </strong>
                  <p className="mt-1 text-xs text-zinc-500">
                    {evaluation.reason_code ?? "Sin motivo adicional"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {formatDateTime(evaluation.evaluated_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
          RECOMPENSA
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white">Resultado del cumplimiento</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {!(rewards ?? []).length ? (
            <div className="md:col-span-2">
              <EmptyState title="Todavía no hay recompensa generada" />
            </div>
          ) : (
            (rewards ?? []).map((reward) => (
              <article
                key={reward.id}
                className="rounded-xl border border-white/10 bg-black/15 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <strong className="text-sm text-white">
                    {rewardDefinitionLabel(reward.benefit_definition)}
                  </strong>
                  <StatusBadge status={reward.status} />
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Creada {formatDateTime(reward.created_at)}
                </p>
                {reward.expires_at ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Vence {formatDateTime(reward.expires_at)}
                  </p>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
