import PendingActionButton from "@/app/admin/components/PendingActionButton";

import { ConditionsBuilder, type ConditionInput } from "../../../ConditionsBuilder";
import { OutcomeFields } from "../../../OutcomeFields";
import { saveProgramLevelAction } from "../../../actions";
import { asObject, conditionRows, rewardItems } from "../../../ui";

type LevelValue = {
  level_key: string;
  level_order: number;
  title: string;
  description: string | null;
  level_visibility: string;
  reward_visibility: string;
};

type RuleVersionValue = {
  condition_definition: unknown;
  reward_definition: unknown;
};

function numericRewardValue(kind: string, definition: Record<string, unknown>) {
  if (kind === "fixed_discount") return Math.max(1, Number(definition.amount_minor ?? 100) / 100);
  if (kind === "percentage_discount") return Math.max(1, Number(definition.percent ?? 1));
  if (kind === "validity_extension") return Math.max(1, Number(definition.days ?? 1));
  return Math.max(1, Number(definition.credits ?? 1));
}

export function ProgramLevelForm({
  programId,
  level,
  ruleVersion,
  nextOrder,
}: {
  programId: string;
  level?: LevelValue | null;
  ruleVersion?: RuleVersionValue | null;
  nextOrder: number;
}) {
  const initialConditions: ConditionInput[] = conditionRows(ruleVersion?.condition_definition).map(
    (condition, index) => ({
      key: `condition_${index + 1}`,
      metric: String(condition.metric ?? "attendance.count"),
      comparator: String(condition.comparator ?? "gte"),
      target: Number(condition.target ?? 1),
    }),
  );

  const outcomes = rewardItems(ruleVersion?.reward_definition);
  const badge = outcomes.find((item) => String(item.kind ?? "") === "badge");
  const benefit = outcomes.find((item) => String(item.kind ?? "") !== "badge");
  const benefitKind = String(benefit?.kind ?? "credits");
  const benefitValue = benefit ? numericRewardValue(benefitKind, benefit) : 1;
  const validityDays = Number(asObject(benefit).validity_days ?? 30);

  return (
    <form
      action={saveProgramLevelAction}
      className="grid gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      <input type="hidden" name="program_id" value={programId} />
      <input type="hidden" name="original_level_key" value={level?.level_key ?? ""} />
      {level ? <input type="hidden" name="level_key" value={level.level_key} /> : null}

      <section className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm text-zinc-300">
          Orden
          <input
            type="number"
            name="level_order"
            min="1"
            step="1"
            required
            defaultValue={level?.level_order ?? nextOrder}
            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>

        <label className="grid gap-1 text-sm text-zinc-300">
          Visibilidad del nivel
          <select
            name="level_visibility"
            defaultValue={level?.level_visibility ?? "visible"}
            className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
          >
            <option value="visible">Visible</option>
            <option value="hidden">Nivel oculto</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
          Nombre del nivel
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={level?.title ?? ""}
            placeholder="Ej. Nivel Bronce"
            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>

        <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
          Descripción
          <textarea
            name="description"
            rows={3}
            defaultValue={level?.description ?? ""}
            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
          CONDICIONES
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">¿Qué debe conseguir?</h2>
        <div className="mt-4">
          <ConditionsBuilder initial={initialConditions.length ? initialConditions : undefined} />
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
          RESULTADO
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">¿Qué desbloquea?</h2>
        <div className="mt-4">
          <OutcomeFields
            defaultMedal={Boolean(badge)}
            defaultBadgeTitle={String(badge?.title ?? "")}
            defaultReward={Boolean(benefit)}
            defaultRewardKind={benefitKind}
            defaultRewardValue={benefitValue}
            defaultValidityDays={Number.isFinite(validityDays) ? validityDays : 30}
            defaultRewardVisibility={level?.reward_visibility ?? "visible"}
          />
        </div>
      </section>

      <div className="flex justify-end">
        <PendingActionButton
          className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white"
          pendingLabel="Guardando…"
        >
          Guardar nivel
        </PendingActionButton>
      </div>
    </form>
  );
}
