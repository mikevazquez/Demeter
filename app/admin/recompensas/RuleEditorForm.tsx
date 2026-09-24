import PendingActionButton from "@/app/admin/components/PendingActionButton";

import { ConditionsBuilder, type ConditionInput } from "./ConditionsBuilder";
import { OutcomeFields } from "./OutcomeFields";
import {
  saveAchievementAction,
  saveChallengeAction,
  transitionStandaloneRuleAction,
  updateStandaloneCopyAction,
} from "./actions";
import {
  asObject,
  conditionRows,
  conditionsLabel,
  rewardDefinitionLabel,
  rewardItems,
  ruleStatusLabels,
} from "./ui";

type RuleValue = {
  id: string;
  status: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
};

type CopyOverrideValue = {
  title: string | null;
  description: string | null;
  cover_url: string | null;
};

type RuleVersionValue = {
  name: string;
  description: string | null;
  audience_definition: unknown;
  condition_definition: unknown;
  evaluation_definition: unknown;
  cycle_definition: unknown;
  reward_definition: unknown;
  presentation_definition: unknown;
  communication_definition?: unknown;
};

function datetimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(" ", "T");
}

function rewardValue(kind: string, definition: Record<string, unknown>) {
  if (kind === "fixed_discount") return Math.max(1, Number(definition.amount_minor ?? 100) / 100);
  if (kind === "percentage_discount") return Math.max(1, Number(definition.percent ?? 1));
  if (kind === "validity_extension") return Math.max(1, Number(definition.days ?? 1));
  if (definition.benefit_type === "cash") {
    return Math.max(1, Number(definition.amount_minor ?? 100) / 100);
  }
  if (definition.benefit_type === "class_package") {
    return Math.max(1, Number(definition.class_credits ?? 1));
  }
  return Math.max(1, Number(definition.credits ?? 1));
}

function challengeMetricLabel(metric: string) {
  const labels: Record<string, string> = {
    "attendance.count": "Clases asistidas",
    "attendance.distinct_days": "Días distintos con asistencia",
    "attendance.distinct_weeks": "Semanas con asistencia",
    "attendance.distinct_months": "Meses con asistencia",
    "attendance.discipline_count": "Disciplinas distintas",
  };
  return labels[metric] ?? metric;
}

function challengeAudienceLabel(scope: string) {
  return scope === "all_students" ? "Todas las alumnas" : "Alumnas activas";
}

function challengeTieLabel(value: string) {
  return value === "shared" ? "Premio compartido" : "Primera en alcanzar la marca";
}

function challengeDateLabel(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
  }).format(date);
}

export function RuleEditorForm({
  mode,
  rule,
  version,
  canManage,
  copyOverride,
  enrollmentCount,
}: {
  mode: "achievement" | "challenge";
  rule?: RuleValue | null;
  version?: RuleVersionValue | null;
  canManage: boolean;
  copyOverride?: CopyOverrideValue | null;
  enrollmentCount?: number | null;
}) {
  const isAchievement = mode === "achievement";
  const locked = Boolean(
    rule && ["active", "paused", "finished", "cancelled"].includes(rule.status),
  );
  const audience = asObject(version?.audience_definition);
  const presentation = asObject(version?.presentation_definition);
  const communication = asObject(version?.communication_definition);
  const pushCommunication = asObject(communication.push);
  const cycle = asObject(version?.cycle_definition);
  const initialConditions: ConditionInput[] = conditionRows(version?.condition_definition).map(
    (condition, index) => ({
      key: `condition_${index + 1}`,
      metric: String(condition.metric ?? "attendance.count"),
      comparator: String(condition.comparator ?? "gte"),
      target: Number(condition.target ?? 1),
    }),
  );
  const rewardSource =
    presentation.competition_mode === "leaderboard" && presentation.competition_reward_definition
      ? presentation.competition_reward_definition
      : version?.reward_definition;
  const outcomes = rewardItems(rewardSource);
  const badge = outcomes.find((item) => String(item.kind ?? "") === "badge");
  const benefit = outcomes.find((item) => String(item.kind ?? "") !== "badge");
  const rawKind = String(benefit?.kind ?? "credits");
  const kind =
    benefit?.benefit_type === "cash"
      ? "cash"
      : benefit?.benefit_type === "class_package"
        ? "package"
        : benefit?.benefit_type === "custom"
          ? "custom_manual"
          : rawKind;
  const validity = Number(benefit?.validity_days ?? 30);
  const challengeMode =
    presentation.challenge_mode === "periods" || cycle.challenge_mode === "periods"
      ? "periods"
      : "accumulated";
  const periodCadence = ["day", "week", "month"].includes(String(cycle.cadence))
    ? String(cycle.cadence)
    : "week";
  const competitionMode =
    String(presentation.competition_mode) === "leaderboard" ? "leaderboard" : "individual";
  const tieBreaker = String(presentation.tie_breaker) === "shared" ? "shared" : "first_to_reach";
  const winnerCount = Math.min(3, Math.max(1, Number(presentation.winner_count ?? 1)));
  const rankingMetric = String(
    presentation.ranking_metric ?? initialConditions[0]?.metric ?? "attendance.count",
  );
  const rewardVisibility = String(presentation.reward_visibility ?? "visible");
  const displayName = copyOverride?.title ?? version?.name ?? (isAchievement ? "Logro" : "Reto");
  const displayDescription = copyOverride?.description ?? version?.description ?? "";
  const coverUrl = copyOverride?.cover_url ?? String(presentation.cover_url ?? "");

  if (locked) {
    return (
      <div className="grid gap-5">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
                CONFIGURACIÓN VIGENTE
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">{displayName}</h2>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300">
              {ruleStatusLabels[rule?.status ?? ""] ?? rule?.status}
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-400">
            {displayDescription || "Sin descripción."}
          </p>
          {isAchievement ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Condiciones</p>
                <p className="mt-2 text-sm text-white">
                  {conditionsLabel(version?.condition_definition)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Resultado</p>
                <p className="mt-2 text-sm text-white">
                  {rewardDefinitionLabel(version?.reward_definition)}
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Modalidad</p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {competitionMode === "leaderboard" ? "Competencia" : "Individual"}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Participantes</p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {competitionMode === "leaderboard"
                    ? `${enrollmentCount ?? 0} inscritas`
                    : challengeAudienceLabel(String(audience.scope ?? "all_active_students"))}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                  Objetivo / métrica
                </p>
                <p className="mt-2 text-sm text-white">{challengeMetricLabel(rankingMetric)}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {conditionsLabel(version?.condition_definition)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Periodo</p>
                <p className="mt-2 text-sm text-white">
                  {challengeDateLabel(rule?.scheduled_start_at)} →{" "}
                  {challengeDateLabel(rule?.scheduled_end_at)}
                </p>
              </div>
              {competitionMode === "leaderboard" ? (
                <>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Ganadoras</p>
                    <p className="mt-2 text-sm text-white">
                      {winnerCount} {winnerCount === 1 ? "ganadora" : "ganadoras"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Desempate</p>
                    <p className="mt-2 text-sm text-white">{challengeTieLabel(tieBreaker)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Inscripción</p>
                    <p className="mt-2 text-sm text-white">
                      Voluntaria · ranking solo para inscritas
                    </p>
                  </div>
                </>
              ) : null}
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Recompensa</p>
                <p className="mt-2 text-sm text-white">
                  {rewardVisibility === "surprise"
                    ? "Sorpresa"
                    : rewardDefinitionLabel(rewardSource)}
                </p>
              </div>
            </div>
          )}
          {rule?.status === "active" ? (
            <p className="mt-4 text-xs text-zinc-500">
              La configuración estructural está bloqueada mientras está activa.
            </p>
          ) : null}
        </section>

        {canManage && rule && rule.status === "active" && !isAchievement ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              PRESENTACIÓN
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">Editar texto o portada</h3>
            <p className="mt-2 text-sm text-zinc-400">
              Estos cambios no alteran condiciones, fechas, audiencia, progreso ni recompensas.
            </p>
            <form action={updateStandaloneCopyAction} className="mt-4 grid gap-3">
              <input type="hidden" name="rule_id" value={rule.id} />
              <input type="hidden" name="kind" value={mode} />
              <label className="grid gap-1 text-sm text-zinc-300">
                Nombre visible
                <input
                  name="name"
                  required
                  defaultValue={displayName}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                />
              </label>
              <label className="grid gap-1 text-sm text-zinc-300">
                Descripción visible
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={displayDescription}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                />
              </label>
              <label className="grid gap-1 text-sm text-zinc-300">
                Portada (URL opcional)
                <input
                  name="cover_url"
                  type="url"
                  defaultValue={coverUrl}
                  placeholder="https://…"
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                />
              </label>
              <div>
                <PendingActionButton
                  className="rounded-xl border border-[#FF0A8A]/30 bg-[#FF0A8A]/10 px-4 py-2.5 text-sm font-semibold text-[#ff64b6]"
                  pendingLabel="Guardando…"
                >
                  Guardar presentación
                </PendingActionButton>
              </div>
            </form>
          </section>
        ) : null}

        {canManage && rule && rule.status === "active" ? (
          <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5">
            <p className="text-sm text-zinc-300">
              Finalizar conserva resultados, logros y recompensas ya obtenidos.
            </p>
            <form action={transitionStandaloneRuleAction} className="mt-4">
              <input type="hidden" name="rule_id" value={rule.id} />
              <input type="hidden" name="kind" value={mode} />
              <input type="hidden" name="action" value="finish" />
              <PendingActionButton
                className="rounded-xl border border-amber-500/25 px-4 py-2.5 text-sm font-semibold text-amber-300"
                pendingLabel="Finalizando…"
              >
                {isAchievement ? "Retirar logro" : "Finalizar reto ahora"}
              </PendingActionButton>
            </form>
          </section>
        ) : null}
      </div>
    );
  }

  const action = isAchievement ? saveAchievementAction : saveChallengeAction;

  return (
    <div className="grid gap-5">
      {canManage ? (
        <form
          action={action}
          className="grid gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
        >
          {rule ? <input type="hidden" name="rule_id" value={rule.id} /> : null}

          <section className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
              Nombre
              <input
                name="name"
                required
                defaultValue={version?.name ?? ""}
                placeholder={isAchievement ? "Ej. Primera inversión" : "Ej. Reto 12 clases"}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
              Descripción
              <textarea
                name="description"
                rows={3}
                defaultValue={version?.description ?? ""}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-300">
              Audiencia
              <select
                name="audience_scope"
                defaultValue={String(audience.scope ?? "all_active_students")}
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
                defaultValue={String(audience.eligibility_mode ?? "continuous")}
                className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
              >
                <option value="continuous">Continua</option>
                <option value="lock_on_join">Se conserva al entrar</option>
              </select>
            </label>

            {isAchievement ? (
              <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white md:col-span-2">
                <input
                  type="checkbox"
                  name="secret_achievement"
                  value="true"
                  defaultChecked={Boolean(presentation.hidden_until_unlocked)}
                />
                Logro secreto: no mostrar nombre, condición ni recompensa antes de desbloquearlo
              </label>
            ) : (
              <>
                <label className="grid gap-1 text-sm text-zinc-300">
                  Modalidad
                  <select
                    name="challenge_mode"
                    defaultValue={challengeMode}
                    className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
                  >
                    <option value="accumulated">Objetivo acumulado</option>
                    <option value="periods">Por periodos</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-zinc-300">
                  Periodo de evaluación
                  <select
                    name="period_cadence"
                    defaultValue={periodCadence}
                    className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
                  >
                    <option value="day">Diario</option>
                    <option value="week">Semanal</option>
                    <option value="month">Mensual</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-zinc-300">
                  Tipo de reto
                  <select
                    name="competition_mode"
                    defaultValue={competitionMode}
                    className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
                  >
                    <option value="individual">Individual · todas pueden completar la meta</option>
                    <option value="leaderboard">Competencia · ranking Top 3</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-zinc-300">
                  Empates en competencia
                  <select
                    name="tie_breaker"
                    defaultValue={tieBreaker}
                    className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
                  >
                    <option value="first_to_reach">Primera en alcanzar la marca</option>
                    <option value="shared">Premio compartido</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-zinc-300">
                  Número de ganadoras
                  <select
                    name="winner_count"
                    defaultValue={String(winnerCount)}
                    className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
                  >
                    <option value="1">1 ganadora</option>
                    <option value="2">2 ganadoras</option>
                    <option value="3">3 ganadoras</option>
                  </select>
                </label>
                <div className="rounded-xl border border-[#FF0A8A]/20 bg-[#FF0A8A]/[0.06] p-3 text-xs leading-5 text-zinc-300">
                  En competencia, la inscripción es voluntaria y solo las inscritas entran al
                  ranking. El portal muestra Top 3, posición personal y distancia al podio; nunca
                  apellidos completos.
                </div>
                <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
                  Portada (URL opcional)
                  <input
                    name="cover_url"
                    type="url"
                    defaultValue={coverUrl}
                    placeholder="https://…"
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-300">
                  Inicia
                  <input
                    type="datetime-local"
                    name="scheduled_start_at"
                    required
                    defaultValue={datetimeLocal(rule?.scheduled_start_at)}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-300">
                  Finaliza
                  <input
                    type="datetime-local"
                    name="scheduled_end_at"
                    required
                    defaultValue={datetimeLocal(rule?.scheduled_end_at)}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                  />
                </label>
              </>
            )}
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              CONDICIONES
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              ¿Qué debe conseguir la alumna?
            </h2>
            <div className="mt-4">
              <ConditionsBuilder
                initial={initialConditions.length ? initialConditions : undefined}
              />
            </div>
          </section>

          {!isAchievement ? (
            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
                NOTIFICACIONES
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                Hitos que pueden generar push
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                Guardamos solo eventos relevantes para evitar saturar a las alumnas.
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {[
                  ["notify_started", "Inicio del reto", "challenge_started"],
                  ["notify_progress", "Progreso significativo", "meaningful_progress"],
                  ["notify_near_goal", "Cerca de completar", "near_goal"],
                  ["notify_top3", "Entrada al Top 3", "entered_top3"],
                  ["notify_position", "Cambio de posición", "position_changed"],
                  ["notify_overtaken", "Fue superada", "overtaken"],
                  ["notify_ending", "Cierre cercano", "ending_soon"],
                  ["notify_completed", "Reto completado", "completed"],
                  ["notify_results", "Resultados finales", "results"],
                ].map(([name, label, key]) => (
                  <label
                    key={name}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-200"
                  >
                    <input
                      type="checkbox"
                      name={name}
                      value="true"
                      defaultChecked={
                        pushCommunication[key] === undefined
                          ? [
                              "challenge_started",
                              "near_goal",
                              "entered_top3",
                              "ending_soon",
                              "completed",
                              "results",
                            ].includes(key)
                          : Boolean(pushCommunication[key])
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              RESULTADO
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">¿Qué desbloquea?</h2>
            <div className="mt-4">
              <OutcomeFields
                medalAllowed={isAchievement}
                medalRequired={isAchievement}
                defaultMedal={Boolean(badge)}
                defaultBadgeTitle={String(badge?.title ?? version?.name ?? "")}
                defaultReward={Boolean(benefit)}
                defaultRewardKind={kind}
                defaultRewardValue={benefit ? rewardValue(kind, benefit) : 1}
                defaultValidityDays={Number.isFinite(validity) ? validity : 30}
                defaultRewardVisibility={String(presentation.reward_visibility ?? "visible")}
                defaultRewardLabel={String(benefit?.label ?? "")}
              />
            </div>
          </section>

          <div className="flex justify-end">
            <PendingActionButton
              className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white"
              pendingLabel="Guardando…"
            >
              Guardar configuración
            </PendingActionButton>
          </div>
        </form>
      ) : null}

      {canManage && rule ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">
            PUBLICACIÓN
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {rule.status === "draft" && rule.scheduled_start_at ? (
              <form action={transitionStandaloneRuleAction}>
                <input type="hidden" name="rule_id" value={rule.id} />
                <input type="hidden" name="kind" value={mode} />
                <input type="hidden" name="action" value="schedule" />
                <PendingActionButton
                  className="rounded-xl border border-amber-500/20 px-4 py-2.5 text-sm font-semibold text-amber-300"
                  pendingLabel="Programando…"
                >
                  Programar
                </PendingActionButton>
              </form>
            ) : null}

            {["draft", "scheduled"].includes(rule.status) ? (
              <form action={transitionStandaloneRuleAction}>
                <input type="hidden" name="rule_id" value={rule.id} />
                <input type="hidden" name="kind" value={mode} />
                <input type="hidden" name="action" value="activate" />
                <PendingActionButton
                  className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white"
                  pendingLabel="Activando…"
                >
                  Activar ahora
                </PendingActionButton>
              </form>
            ) : null}

            {["draft", "scheduled"].includes(rule.status) ? (
              <form action={transitionStandaloneRuleAction}>
                <input type="hidden" name="rule_id" value={rule.id} />
                <input type="hidden" name="kind" value={mode} />
                <input type="hidden" name="action" value="cancel" />
                <button className="rounded-xl border border-rose-500/20 px-4 py-2.5 text-sm font-semibold text-rose-300">
                  Cancelar
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
