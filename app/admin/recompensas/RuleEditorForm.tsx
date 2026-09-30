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
};

function datetimeLocal(value: string | null | undefined, timeZone: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
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
  return Math.max(1, Number(definition.credits ?? 1));
}

export function RuleEditorForm({
  mode,
  rule,
  version,
  canManage,
  copyOverride,
  locale,
  currency,
  timeZone,
}: {
  mode: "achievement" | "challenge";
  rule?: RuleValue | null;
  version?: RuleVersionValue | null;
  canManage: boolean;
  copyOverride?: CopyOverrideValue | null;
  locale: string;
  currency: string;
  timeZone: string;
}) {
  const isAchievement = mode === "achievement";
  const locked = Boolean(
    rule && ["active", "paused", "finished", "cancelled"].includes(rule.status),
  );
  const audience = asObject(version?.audience_definition);
  const presentation = asObject(version?.presentation_definition);
  const cycle = asObject(version?.cycle_definition);
  const initialConditions: ConditionInput[] = conditionRows(version?.condition_definition).map(
    (condition, index) => ({
      key: `condition_${index + 1}`,
      metric: String(condition.metric ?? "attendance.count"),
      comparator: String(condition.comparator ?? "gte"),
      target: Number(condition.target ?? 1),
    }),
  );
  const outcomes = rewardItems(version?.reward_definition);
  const badge = outcomes.find((item) => String(item.kind ?? "") === "badge");
  const benefit = outcomes.find((item) => String(item.kind ?? "") !== "badge");
  const kind = String(benefit?.kind ?? "credits");
  const validity = Number(benefit?.validity_days ?? 30);
  const challengeMode =
    presentation.challenge_mode === "periods" || cycle.challenge_mode === "periods"
      ? "periods"
      : "accumulated";
  const periodCadence = ["day", "week", "month"].includes(String(cycle.cadence))
    ? String(cycle.cadence)
    : "week";
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
                {rewardDefinitionLabel(version?.reward_definition, locale, currency)}
              </p>
            </div>
          </div>
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
                    defaultValue={datetimeLocal(rule?.scheduled_start_at, timeZone)}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-300">
                  Finaliza
                  <input
                    type="datetime-local"
                    name="scheduled_end_at"
                    required
                    defaultValue={datetimeLocal(rule?.scheduled_end_at, timeZone)}
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

          <section>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              RESULTADO
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">¿Qué desbloquea?</h2>
            <div className="mt-4">
              <OutcomeFields
                medalRequired={isAchievement}
                defaultMedal={Boolean(badge)}
                defaultBadgeTitle={String(badge?.title ?? version?.name ?? "")}
                defaultReward={Boolean(benefit)}
                defaultRewardKind={kind}
                defaultRewardValue={benefit ? rewardValue(kind, benefit) : 1}
                defaultValidityDays={Number.isFinite(validity) ? validity : 30}
                defaultRewardVisibility={String(presentation.reward_visibility ?? "visible")}
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
