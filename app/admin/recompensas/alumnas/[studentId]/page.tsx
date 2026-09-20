import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { grantManualRewardAction, requestRewardReviewAction } from "../../actions";
import {
  EmptyState,
  MetricCard,
  StatusBadge,
  formatDateTime,
  rewardBenefitLabel,
  rewardDefinitionLabel,
} from "../../ui";

export default async function StudentRewardsProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { studentId } = await params;
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const canManage = ctx.can(CAPABILITIES.REWARDS_MANAGE);

  const { data: student } = await ctx.supabase
    .from("students")
    .select("id,full_name,email,lifecycle_status")
    .eq("studio_id", ctx.studio.id)
    .eq("id", studentId)
    .maybeSingle();

  if (!student) notFound();

  const [rewardsResult, participationsResult, achievementsResult, incidentsResult, cyclesResult] =
    await Promise.all([
      ctx.supabase
        .from("reward_instances")
        .select("*")
        .eq("studio_id", ctx.studio.id)
        .eq("student_id", student.id)
        .order("created_at", { ascending: false }),
      ctx.supabase
        .from("reward_participations")
        .select("*")
        .eq("studio_id", ctx.studio.id)
        .eq("student_id", student.id)
        .order("updated_at", { ascending: false }),
      ctx.supabase
        .from("reward_achievement_unlocks")
        .select("*")
        .eq("studio_id", ctx.studio.id)
        .eq("student_id", student.id)
        .order("unlocked_at", { ascending: false }),
      ctx.supabase
        .from("reward_incidents")
        .select("*")
        .eq("studio_id", ctx.studio.id)
        .eq("student_id", student.id)
        .order("opened_at", { ascending: false }),
      ctx.supabase
        .from("reward_cycles")
        .select("*")
        .eq("studio_id", ctx.studio.id)
        .eq("student_id", student.id)
        .order("updated_at", { ascending: false }),
    ]);

  const rewards = rewardsResult.data ?? [];
  const participations = participationsResult.data ?? [];
  const achievements = achievementsResult.data ?? [];
  const incidents = incidentsResult.data ?? [];
  const cycles = cyclesResult.data ?? [];
  const ruleIds = [...new Set(participations.map((item) => item.rule_id))];
  const { data: rules } = ruleIds.length
    ? await ctx.supabase
        .from("reward_rules")
        .select("id,current_version_number,status")
        .in("id", ruleIds)
    : { data: [] as Array<{ id: string; current_version_number: number; status: string }> };
  const { data: versions } = ruleIds.length
    ? await ctx.supabase
        .from("reward_rule_versions")
        .select("rule_id,version_number,name,family,human_summary")
        .in("rule_id", ruleIds)
    : {
        data: [] as Array<{
          rule_id: string;
          version_number: number;
          name: string;
          family: string;
          human_summary: string;
        }>,
      };

  const versionMap = new Map(
    (versions ?? []).map((version) => [`${version.rule_id}:${version.version_number}`, version]),
  );
  const ruleMap = new Map((rules ?? []).map((rule) => [rule.id, rule]));
  const available = rewards.filter((reward) => reward.status === "available");
  const openIncidents = incidents.filter((incident) => incident.status !== "closed");
  const loyaltyParticipation = participations.find((participation) => {
    const rule = ruleMap.get(participation.rule_id);
    const version = rule ? versionMap.get(`${rule.id}:${rule.current_version_number}`) : null;
    return version?.family === "loyalty";
  });

  return (
    <main className="dashboard-shell space-y-6">
      <header>
        <Link
          href={`/admin/alumnas/${student.id}`}
          className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Perfil de alumna
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">PERFIL REWARDS</p>
            <h1 className="dashboard-title">{student.full_name}</h1>
            <p className="mt-2 text-sm text-zinc-400">
              {student.email ?? "Sin correo"} · {student.lifecycle_status}
            </p>
          </div>
          {canManage ? (
            <a
              href="#recompensa-manual"
              className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              + Otorgar recompensa
            </a>
          ) : null}
        </div>
      </header>

      {query.saved ? (
        <div className="notice success">Recompensa manual otorgada y auditada.</div>
      ) : null}
      {query.error ? (
        <div className="notice error">No se pudo completar la acción: {query.error}</div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Disponibles" value={available.length} />
        <MetricCard
          label="Progresos activos"
          value={cycles.filter((cycle) => ["open", "frozen"].includes(cycle.status)).length}
        />
        <MetricCard label="Logros" value={achievements.length} />
        <MetricCard label="Incidencias abiertas" value={openIncidents.length} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            RECOMPENSAS DISPONIBLES
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Listas para usar</h2>
          <div className="mt-5 grid gap-3">
            {!available.length ? (
              <EmptyState title="No tiene recompensas disponibles" />
            ) : (
              available.map((reward) => (
                <div
                  key={reward.id}
                  className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.05] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <strong className="text-base text-white">
                      {rewardDefinitionLabel(reward.benefit_definition)}
                    </strong>
                    <StatusBadge status={reward.status} />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    {reward.manually_granted ? "Otorgada manualmente" : "Generada por regla"}
                    {reward.expires_at ? ` · vence ${formatDateTime(reward.expires_at)}` : ""}
                  </p>
                  {canManage ? (
                    <form
                      action={requestRewardReviewAction}
                      className="mt-4 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-[1fr_auto]"
                    >
                      <input type="hidden" name="reward_instance_id" value={reward.id} />
                      <input
                        name="reason"
                        required
                        placeholder="Motivo para revisar o ajustar"
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                      />
                      <button className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-white">
                        Revisar / ajustar
                      </button>
                    </form>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            FIDELIDAD
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Continuidad</h2>
          {loyaltyParticipation ? (
            <div className="mt-5">
              <StatusBadge status={loyaltyParticipation.status} />
              <p className="mt-3 text-sm text-zinc-400">
                Participando desde {formatDateTime(loyaltyParticipation.joined_at)}.
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <EmptyState title="Sin regla de fidelidad activa" />
            </div>
          )}
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            PROGRESO ACTIVO
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Reglas y retos</h2>
          <div className="mt-5 grid gap-2">
            {!participations.length ? (
              <EmptyState title="Sin participación registrada" />
            ) : (
              participations.slice(0, 8).map((participation) => {
                const rule = ruleMap.get(participation.rule_id);
                const version = rule
                  ? versionMap.get(`${rule.id}:${rule.current_version_number}`)
                  : null;
                return (
                  <Link
                    key={participation.id}
                    href={`/admin/recompensas/reglas/${participation.rule_id}/participantes/${student.id}`}
                    className="rounded-xl border border-white/10 bg-black/15 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm text-white">{version?.name ?? "Regla"}</strong>
                      <StatusBadge status={participation.status} />
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{version?.human_summary ?? ""}</p>
                  </Link>
                );
              })
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            LOGROS
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Trayectoria</h2>
          <div className="mt-5 grid gap-2">
            {!achievements.length ? (
              <EmptyState title="Todavía no ha desbloqueado logros" />
            ) : (
              achievements.slice(0, 8).map((achievement) => (
                <div
                  key={achievement.id}
                  className="rounded-xl border border-white/10 bg-black/15 p-4"
                >
                  <strong className="text-sm text-white">{achievement.title_snapshot}</strong>
                  <p className="mt-1 text-xs text-zinc-500">
                    {achievement.level_key ? `Nivel ${achievement.level_key} · ` : ""}
                    {formatDateTime(achievement.unlocked_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            HISTORIAL RECIENTE
          </p>
          <div className="mt-5 grid gap-2">
            {!rewards.length ? (
              <EmptyState title="Sin historial de recompensas" />
            ) : (
              rewards.slice(0, 10).map((reward) => (
                <div key={reward.id} className="rounded-xl border border-white/10 bg-black/15 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-white">
                      {rewardBenefitLabel(reward.kind, reward.benefit_definition)}
                    </strong>
                    <StatusBadge status={reward.status} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{formatDateTime(reward.created_at)}</p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            INCIDENCIAS
          </p>
          <div className="mt-5 grid gap-2">
            {!openIncidents.length ? (
              <EmptyState title="Sin incidencias abiertas" />
            ) : (
              openIncidents.slice(0, 8).map((incident) => (
                <Link
                  key={incident.id}
                  href={`/admin/recompensas/incidencias/${incident.id}`}
                  className="rounded-xl border border-white/10 bg-black/15 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-white">{incident.summary}</strong>
                    <StatusBadge status={incident.status} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{formatDateTime(incident.opened_at)}</p>
                </Link>
              ))
            )}
          </div>
        </article>
      </section>

      {canManage ? (
        <section
          id="recompensa-manual"
          className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-5"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            EXCEPCIÓN ADMINISTRATIVA
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Otorgar recompensa manual</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Requiere motivo y queda marcada como manual. No modifica el contador ni el progreso de
            ninguna regla.
          </p>
          <form action={grantManualRewardAction} className="mt-5 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="student_id" value={student.id} />
            <label className="grid gap-2 text-sm text-zinc-300">
              Tipo
              <select
                name="kind"
                defaultValue="credits"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              >
                <option value="percentage_discount">% de descuento</option>
                <option value="fixed_discount">Descuento fijo</option>
                <option value="credits">Créditos</option>
                <option value="validity_extension">Extensión de vigencia</option>
                <option value="surcharge_waiver">Eliminar recargo</option>
                <option value="special_benefit">Beneficio especial</option>
                <option value="custom_manual">Personalizada</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm text-zinc-300">
              Valor
              <input
                name="value"
                type="number"
                min="0"
                step="1"
                defaultValue="1"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>
            <label className="grid gap-2 text-sm text-zinc-300">
              Vigencia en días
              <input
                name="validity_days"
                type="number"
                min="0"
                step="1"
                placeholder="Sin vencimiento"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>
            <label className="grid gap-2 text-sm text-zinc-300">
              Nombre / detalle
              <input
                name="label"
                placeholder="Ej. 1 crédito de cortesía"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>
            <label className="grid gap-2 text-sm text-zinc-300 md:col-span-2">
              Motivo obligatorio
              <textarea
                name="reason"
                required
                rows={2}
                placeholder="Explica por qué se otorga esta excepción."
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>
            <div className="md:col-span-2 flex justify-end">
              <button className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white">
                Otorgar y auditar
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
