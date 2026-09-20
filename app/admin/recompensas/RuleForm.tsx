import type { ReactNode } from "react";

type JsonObject = Record<string, unknown>;

export type RewardRuleFormDefaults = {
  id?: string;
  name?: string;
  description?: string | null;
  family?: string;
  audienceDefinition?: JsonObject;
  conditionDefinition?: JsonObject;
  evaluationDefinition?: JsonObject;
  cycleDefinition?: JsonObject;
  rewardDefinition?: JsonObject;
  presentationDefinition?: JsonObject;
  communicationDefinition?: JsonObject;
  humanSummary?: string;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
};

function section(number: string, title: string, description: string, children: ReactNode) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
      <div className="flex gap-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fuchsia-500/15 text-sm font-black text-fuchsia-300">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{description}</p>
          <div className="mt-5 grid gap-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

function jsonValue<T>(source: JsonObject | undefined, key: string, fallback: T): T {
  const value = source?.[key];
  return (value === undefined ? fallback : value) as T;
}

function dateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function RuleForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaults?: RewardRuleFormDefaults;
  submitLabel: string;
}) {
  const conditions = Array.isArray(defaults.conditionDefinition?.conditions)
    ? (defaults.conditionDefinition?.conditions as JsonObject[])
    : [];
  const primary = conditions[0] ?? {};
  const reward = defaults.rewardDefinition ?? {};

  return (
    <form action={action} className="grid gap-4">
      {defaults.id ? <input type="hidden" name="rule_id" value={defaults.id} /> : null}

      {section(
        "01",
        "Información básica",
        "Nombre interno, descripción y el resumen humano que verá el equipo.",
        <>
          <label className="grid gap-2 text-sm text-zinc-300">
            Nombre de la regla
            <input
              name="name"
              required
              defaultValue={defaults.name ?? ""}
              placeholder="Ej. Fidelidad 6 meses"
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white outline-none focus:border-fuchsia-500/60"
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Descripción
            <textarea
              name="description"
              rows={2}
              defaultValue={defaults.description ?? ""}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white outline-none focus:border-fuchsia-500/60"
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Resumen de la regla
            <textarea
              name="human_summary"
              required
              rows={2}
              defaultValue={defaults.humanSummary ?? ""}
              placeholder="Completa 6 periodos activos consecutivos y recibe 10% de descuento."
              className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.05] px-3 py-2.5 text-white outline-none focus:border-fuchsia-500/60"
            />
          </label>
        </>,
      )}

      {section(
        "02",
        "Familia",
        "Define qué motor alimenta el progreso. No cambia la recompensa en sí.",
        <label className="grid gap-2 text-sm text-zinc-300">
          Familia
          <select
            name="family"
            defaultValue={defaults.family ?? "loyalty"}
            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          >
            <option value="loyalty">Fidelidad</option>
            <option value="attendance">Asistencia / racha</option>
            <option value="challenge">Reto</option>
            <option value="achievement">Logro</option>
          </select>
        </label>,
      )}

      {section(
        "03",
        "Audiencia",
        "En v1 la regla trabaja con alumnas activas; la definición queda versionada para futuras segmentaciones.",
        <label className="grid gap-2 text-sm text-zinc-300">
          Audiencia
          <select
            name="audience_scope"
            defaultValue={jsonValue(defaults.audienceDefinition, "scope", "all_active_students")}
            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          >
            <option value="all_active_students">Todas las alumnas activas</option>
            <option value="eligible_students">Alumnas elegibles por la condición</option>
          </select>
        </label>,
      )}

      {section(
        "04",
        "Condición",
        "Configura la métrica principal. Las reglas compuestas ALL/ANY usan el mismo motor.",
        <div className="grid gap-3 md:grid-cols-[1.3fr_.7fr_.6fr]">
          <label className="grid gap-2 text-sm text-zinc-300">
            Métrica
            <input
              name="metric"
              required
              defaultValue={String(primary.metric ?? "loyalty.current_consecutive_periods")}
              placeholder="attendance.count"
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Comparador
            <select
              name="comparator"
              defaultValue={String(primary.comparator ?? "gte")}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            >
              <option value="gte">≥</option>
              <option value="gt">&gt;</option>
              <option value="eq">=</option>
              <option value="lte">≤</option>
              <option value="lt">&lt;</option>
              <option value="neq">≠</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Meta
            <input
              name="target"
              type="number"
              step="1"
              min="0"
              defaultValue={Number(primary.target ?? 1)}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300 md:col-span-3">
            Lógica
            <select
              name="operator"
              defaultValue={String(defaults.conditionDefinition?.operator ?? "all")}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            >
              <option value="all">Todas las condiciones (ALL)</option>
              <option value="any">Cualquiera de las condiciones (ANY)</option>
            </select>
          </label>
        </div>,
      )}

      {section(
        "05",
        "Periodo y evaluación",
        "Controla cuándo comienza a contar, tolerancias y reglas de asistencia.",
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-zinc-300">
            Inicio programado
            <input
              type="datetime-local"
              name="scheduled_start_at"
              defaultValue={dateTimeLocal(defaults.scheduledStartAt)}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Fin programado
            <input
              type="datetime-local"
              name="scheduled_end_at"
              defaultValue={dateTimeLocal(defaults.scheduledEndAt)}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Tolerancia después de vencimiento
            <div className="flex items-center gap-2">
              <input
                name="grace_days"
                type="number"
                min="0"
                step="1"
                defaultValue={Number(jsonValue(defaults.evaluationDefinition, "grace_days", 0))}
                className="w-28 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
              <span className="text-zinc-500">días</span>
            </div>
          </label>
          <div className="grid gap-3 pt-1 text-sm text-zinc-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="allow_historical"
                defaultChecked={Boolean(
                  jsonValue(defaults.evaluationDefinition, "allow_historical", false),
                )}
              />
              Permitir histórico previo a la activación
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="attendance_max_one_per_day"
                defaultChecked={Boolean(
                  jsonValue(defaults.evaluationDefinition, "attendance_max_one_per_day", false),
                )}
              />
              Máximo una asistencia contable por día
            </label>
          </div>
        </div>,
      )}

      {section(
        "06",
        "Repetición y ciclos",
        "Define si la regla puede volver a cumplirse y cómo se agrupan sus periodos.",
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-zinc-300">
            Ciclo
            <select
              name="cadence"
              defaultValue={String(jsonValue(defaults.cycleDefinition, "cadence", "continuous"))}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            >
              <option value="continuous">Continuo</option>
              <option value="day">Diario</option>
              <option value="week">Semanal</option>
              <option value="month">Mensual</option>
              <option value="campaign">Campaña</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              name="repeatable"
              defaultChecked={Boolean(jsonValue(defaults.cycleDefinition, "repeatable", false))}
            />
            Puede repetirse después de completar el ciclo
          </label>
        </div>,
      )}

      {section(
        "07",
        "Recompensa",
        "La recompensa se congela cuando se genera; cambios posteriores no reescriben lo ganado.",
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-zinc-300">
            Tipo
            <select
              name="reward_kind"
              defaultValue={String(reward.kind ?? "credits")}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            >
              <option value="percentage_discount">% de descuento</option>
              <option value="fixed_discount">Descuento fijo</option>
              <option value="credits">Créditos</option>
              <option value="validity_extension">Extensión de vigencia</option>
              <option value="surcharge_waiver">Eliminar recargo</option>
              <option value="special_benefit">Beneficio especial</option>
              <option value="badge">Insignia</option>
              <option value="custom_manual">Personalizada</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Valor
            <input
              name="reward_value"
              type="number"
              min="0"
              step="1"
              defaultValue={Number(
                reward.percent ??
                  (typeof reward.amount_minor === "number"
                    ? Number(reward.amount_minor) / 100
                    : (reward.credits ?? reward.days ?? 1)),
              )}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Vigencia del beneficio
            <input
              name="validity_days"
              type="number"
              min="0"
              step="1"
              defaultValue={
                typeof reward.validity_days === "number" ? Number(reward.validity_days) : ""
              }
              placeholder="Sin vencimiento"
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            Texto / detalle especial
            <input
              name="reward_note"
              defaultValue={String(reward.label ?? reward.title ?? reward.waiver ?? "")}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 md:col-span-2">
            <input type="checkbox" name="stackable" defaultChecked={Boolean(reward.stackable)} />
            Puede combinarse con beneficios compatibles
          </label>
        </div>,
      )}

      {section(
        "08",
        "Comunicación y visibilidad",
        "Separa el cálculo de la comunicación para que un canal nunca bloquee la recompensa.",
        <div className="grid gap-3 text-sm text-zinc-300 md:grid-cols-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="progress_visible"
              defaultChecked={Boolean(
                jsonValue(defaults.presentationDefinition, "progress_visible", true),
              )}
            />
            Mostrar progreso a la alumna
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="hidden_until_unlocked"
              defaultChecked={Boolean(
                jsonValue(defaults.presentationDefinition, "hidden_until_unlocked", false),
              )}
            />
            Ocultar hasta desbloquear
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="unlock_notice"
              defaultChecked={Boolean(
                jsonValue(defaults.communicationDefinition, "unlock_notice", true),
              )}
            />
            Avisar al desbloquear
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="expiring_notice"
              defaultChecked={Boolean(
                jsonValue(defaults.communicationDefinition, "expiring_notice", true),
              )}
            />
            Avisar antes de vencer
          </label>
        </div>,
      )}

      {section(
        "09",
        "Revisión",
        "Guardar crea una nueva versión inmutable. Activar o programar se hace desde el detalle de la regla.",
        <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-4 text-sm leading-6 text-zinc-300">
          <strong className="text-white">Antes de guardar:</strong> confirma que el resumen humano
          coincide con la condición y el beneficio. Rewards nunca debe bloquear reservas, pagos o
          asistencia.
        </div>,
      )}

      <div className="sticky bottom-3 z-10 flex justify-end rounded-2xl border border-white/10 bg-[#11141b]/95 p-3 shadow-2xl backdrop-blur">
        <button
          type="submit"
          className="rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
