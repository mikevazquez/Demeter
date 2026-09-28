"use client";

import { useState } from "react";

type Discipline = {
  id: string;
  name: string;
};

type ProductSchedule = {
  id: string;
  weekday: number;
  localTime: string;
  activity: string;
  discipline: string;
};

type CreationMode = "class_pack" | "restricted_pack" | "unlimited_membership" | "other";

type ProductFormFieldsProps = {
  disciplines: Discipline[];
  schedules?: ProductSchedule[];
  creationMode?: CreationMode;
  initialProductType?: string;
  initialPackageTerm?: string | null;
  initialPrice?: number;
  initialValidityDays?: number | null;
  initialCreditLimit?: number | null;
  initialUnlimited?: boolean;
  selectedDisciplineIds?: string[];
  selectedScheduleIds?: string[];
};

type EnrollmentValidity = "30" | "90" | "180" | "365" | "lifetime" | "custom";
type PackageTerm = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

const packageTermDays: Record<Exclude<PackageTerm, "custom">, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  annual: 365,
};

const creationModeLabels: Record<CreationMode, string> = {
  class_pack: "Paquete por clases",
  restricted_pack: "Paquete restringido",
  unlimited_membership: "Membresía ilimitada",
  other: "Otro producto",
};

function enrollmentValidityFromDays(days: number | null | undefined): EnrollmentValidity {
  if (days == null) return "lifetime";
  if (days === 30 || days === 90 || days === 180 || days === 365)
    return String(days) as EnrollmentValidity;
  return "custom";
}

function packageTermFromValues(
  term: string | null | undefined,
  days: number | null | undefined,
): PackageTerm {
  if (
    term === "weekly" ||
    term === "monthly" ||
    term === "quarterly" ||
    term === "semiannual" ||
    term === "annual" ||
    term === "custom"
  ) {
    return term;
  }
  if (days === 7) return "weekly";
  if (days === 30) return "monthly";
  if (days === 90) return "quarterly";
  if (days === 180) return "semiannual";
  if (days === 365) return "annual";
  return "custom";
}

export function ProductFormFields({
  disciplines,
  initialProductType = "package",
  initialPackageTerm,
  initialPrice,
  initialValidityDays = 30,
  initialCreditLimit = 8,
  initialUnlimited = false,
  selectedDisciplineIds = [],
  selectedScheduleIds = [],
  schedules = [],
  creationMode,
}: ProductFormFieldsProps) {
  const [productType, setProductType] = useState(initialProductType);
  const [enrollmentValidity, setEnrollmentValidity] = useState<EnrollmentValidity>(() =>
    enrollmentValidityFromDays(initialValidityDays),
  );
  const initialTerm = packageTermFromValues(initialPackageTerm, initialValidityDays);
  const [packageTerm, setPackageTerm] = useState<PackageTerm>(initialTerm);
  const [customValidityDays, setCustomValidityDays] = useState(() =>
    initialTerm === "custom" ? (initialValidityDays ?? 30) : 30,
  );
  const isEnrollment = productType === "enrollment";
  const isPackageLike = productType === "package" || productType === "membership";
  const selected = new Set(selectedDisciplineIds);
  const selectedSchedules = new Set(selectedScheduleIds);
  const [scheduleScope, setScheduleScope] = useState<"all" | "specific">(
    creationMode === "restricted_pack" || selectedScheduleIds.length ? "specific" : "all",
  );
  const weekdayLabels: Record<number, string> = {
    0: "Domingo",
    1: "Lunes",
    2: "Martes",
    3: "Miércoles",
    4: "Jueves",
    5: "Viernes",
    6: "Sábado",
  };

  const locksProductType =
    creationMode === "class_pack" ||
    creationMode === "restricted_pack" ||
    creationMode === "unlimited_membership";
  const hidesCreditLimit = creationMode === "unlimited_membership";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {locksProductType ? (
          <div className="text-sm text-zinc-300">
            Modalidad
            <input type="hidden" name="product_type" value={productType} />
            <div className="mt-2 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] px-3 py-2.5 font-medium text-fuchsia-100">
              {creationMode ? creationModeLabels[creationMode] : "Producto"}
            </div>
          </div>
        ) : (
          <label className="text-sm text-zinc-300">
            Tipo
            <select
              name="product_type"
              required
              value={productType}
              onChange={(event) => setProductType(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-white"
            >
              {creationMode !== "other" ? <option value="package">Paquete</option> : null}
              {creationMode !== "other" ? <option value="membership">Membresía</option> : null}
              <option value="single_class">Clase suelta</option>
              <option value="enrollment">Inscripción</option>
              <option value="other">Otro</option>
            </select>
          </label>
        )}

        <label className="text-sm text-zinc-300">
          Precio MXN
          <input
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={initialPrice}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>

        {isEnrollment ? (
          <>
            <label className="text-sm text-zinc-300">
              Vigencia
              <select
                value={enrollmentValidity}
                onChange={(event) =>
                  setEnrollmentValidity(event.target.value as EnrollmentValidity)
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-white"
              >
                <option value="30">30 días</option>
                <option value="90">3 meses</option>
                <option value="180">6 meses</option>
                <option value="365">1 año</option>
                <option value="lifetime">Vitalicia</option>
                <option value="custom">Días específicos</option>
              </select>
            </label>

            {enrollmentValidity === "custom" ? (
              <label className="text-sm text-zinc-300">
                Días de vigencia
                <input
                  name="validity_days"
                  type="number"
                  min="1"
                  required
                  value={customValidityDays}
                  onChange={(event) => setCustomValidityDays(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                />
              </label>
            ) : (
              <input
                type="hidden"
                name="validity_days"
                value={enrollmentValidity === "lifetime" ? "" : enrollmentValidity}
              />
            )}
          </>
        ) : isPackageLike ? (
          <>
            <label className="text-sm text-zinc-300">
              Vigencia
              <select
                name="package_term"
                required
                value={packageTerm}
                onChange={(event) => setPackageTerm(event.target.value as PackageTerm)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-white"
              >
                <option value="weekly">1 semana · 7 días</option>\n                <option value="monthly">1 mes · 30 días</option>
                <option value="quarterly">3 meses · 90 días</option>
                <option value="semiannual">6 meses · 180 días</option>
                <option value="annual">1 año · 365 días</option>
                <option value="custom">Otra vigencia</option>
              </select>
            </label>

            {packageTerm === "custom" ? (
              <label className="text-sm text-zinc-300">
                Días de vigencia
                <input
                  name="validity_days"
                  type="number"
                  min="1"
                  required
                  value={customValidityDays}
                  onChange={(event) => setCustomValidityDays(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                />
              </label>
            ) : (
              <input type="hidden" name="validity_days" value={packageTermDays[packageTerm]} />
            )}
          </>
        ) : (
          <label className="text-sm text-zinc-300">
            Vigencia (días)
            <input
              name="validity_days"
              type="number"
              min="1"
              required
              defaultValue={initialValidityDays ?? 30}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
        )}

        {!isEnrollment && !hidesCreditLimit ? (
          <label className="text-sm text-zinc-300">
            Cantidad de clases
            <input
              name="credit_limit"
              type="number"
              min="1"
              defaultValue={initialCreditLimit ?? 1}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
        ) : null}

        {isEnrollment ? (
          <div className="md:col-span-2 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-4">
            <p className="text-sm font-semibold text-fuchsia-200">Inscripción administrativa</p>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              La inscripción no es un paquete: no otorga clases, créditos ni acceso a disciplinas.
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              Si eliges Vitalicia, la inscripción no tendrá fecha de vencimiento.
            </p>
          </div>
        ) : null}
      </div>

      {!isEnrollment ? (
        <>
          {creationMode === "unlimited_membership" ? (
            <>
              <input type="hidden" name="unlimited" value="on" />
              <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-4">
                <p className="text-sm font-semibold text-fuchsia-100">Acceso ilimitado</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  Esta membresía no consume créditos. Su límite es la vigencia y las reglas de
                  acceso que configures debajo.
                </p>
              </div>
            </>
          ) : creationMode === "class_pack" || creationMode === "restricted_pack" ? (
            <div className="rounded-xl border border-white/10 bg-black/10 p-4">
              <p className="text-sm font-medium text-white">Consumo por clases</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Cada reserva consume los créditos definidos arriba según el costo de la actividad.
              </p>
            </div>
          ) : (
            <label className="flex items-center gap-3 rounded-xl border border-white/10 p-4 text-sm text-zinc-300">
              <input
                name="unlimited"
                type="checkbox"
                defaultChecked={initialUnlimited}
                className="h-4 w-4"
              />
              Producto ilimitado (ignora el número de créditos)
            </label>
          )}

          <fieldset>
            <legend className="text-sm font-medium text-white">Disciplinas incluidas</legend>
            <p className="mt-1 text-xs text-zinc-500">
              Define en qué disciplinas puede utilizarse este producto.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {disciplines.map((discipline) => (
                <label
                  key={discipline.id}
                  className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-zinc-300"
                >
                  <input
                    type="checkbox"
                    name="discipline_ids"
                    value={discipline.id}
                    defaultChecked={selected.has(discipline.id)}
                  />
                  {discipline.name}
                </label>
              ))}
            </div>
          </fieldset>

          {isPackageLike ? (
            creationMode === "class_pack" ? (
              <input type="hidden" name="schedule_scope" value="all" />
            ) : (
              <fieldset className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <legend className="px-1 text-sm font-medium text-white">
                  {creationMode === "restricted_pack" ? "Horarios incluidos" : "Horarios permitidos"}
                </legend>
                <p className="mt-1 text-xs text-zinc-500">
                  {creationMode === "restricted_pack"
                    ? "Selecciona exactamente los días y horarios en los que este paquete podrá utilizarse."
                    : "Puedes dejar todos los horarios disponibles o limitar la membresía a horarios concretos."}
                </p>
                <input
                  type="hidden"
                  name="schedule_scope"
                  value={creationMode === "restricted_pack" ? "specific" : scheduleScope}
                />

                {creationMode !== "restricted_pack" ? (
                  <div className="mt-4 grid gap-2">
                    <label className="flex items-start gap-3 rounded-xl border border-white/10 px-3 py-3 text-sm text-zinc-300">
                      <input
                        type="radio"
                        name="schedule_scope_choice"
                        value="all"
                        checked={scheduleScope === "all"}
                        onChange={() => setScheduleScope("all")}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <strong className="block font-medium text-white">
                          Todos los horarios de las disciplinas seleccionadas
                        </strong>
                        <small className="mt-1 block text-xs text-zinc-500">
                          La membresía funcionará en cualquier horario compatible.
                        </small>
                      </span>
                    </label>

                    <label className="flex items-start gap-3 rounded-xl border border-white/10 px-3 py-3 text-sm text-zinc-300">
                      <input
                        type="radio"
                        name="schedule_scope_choice"
                        value="specific"
                        checked={scheduleScope === "specific"}
                        onChange={() => setScheduleScope("specific")}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <strong className="block font-medium text-white">
                          Solo horarios específicos
                        </strong>
                        <small className="mt-1 block text-xs text-zinc-500">
                          El acceso ilimitado también puede limitarse a ciertos horarios.
                        </small>
                      </span>
                    </label>
                  </div>
                ) : null}

                {creationMode === "restricted_pack" || scheduleScope === "specific" ? (
                  schedules.length ? (
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {Object.keys(weekdayLabels)
                        .map(Number)
                        .filter((weekday) =>
                          schedules.some((schedule) => schedule.weekday === weekday),
                        )
                        .sort((left, right) => (left === 0 ? 7 : left) - (right === 0 ? 7 : right))
                        .map((weekday) => (
                          <div
                            key={weekday}
                            className="rounded-2xl border border-white/10 bg-black/20 p-3"
                          >
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                              {weekdayLabels[weekday]}
                            </p>
                            <div className="mt-2 grid gap-2">
                              {schedules
                                .filter((schedule) => schedule.weekday === weekday)
                                .map((schedule) => (
                                  <label
                                    key={schedule.id}
                                    className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-zinc-300"
                                  >
                                    <input
                                      type="checkbox"
                                      name="schedule_ids"
                                      value={schedule.id}
                                      defaultChecked={selectedSchedules.has(schedule.id)}
                                    />
                                    <span>
                                      <strong className="font-medium text-white">
                                        {schedule.localTime.slice(0, 5)} · {schedule.activity}
                                      </strong>
                                      <small className="ml-2 text-zinc-500">
                                        {schedule.discipline}
                                      </small>
                                    </span>
                                  </label>
                                ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-amber-200">
                      Aún no hay horarios recurrentes configurados. Crea primero los horarios del
                      estudio para poder restringir este producto.
                    </p>
                  )
                ) : null}
              </fieldset>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
