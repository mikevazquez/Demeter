"use client";

import { useState } from "react";

type Discipline = {
  id: string;
  name: string;
};

type ProductFormFieldsProps = {
  disciplines: Discipline[];
  initialProductType?: string;
  initialPackageTerm?: string | null;
  initialPrice?: number;
  initialValidityDays?: number | null;
  initialCreditLimit?: number | null;
  initialUnlimited?: boolean;
  selectedDisciplineIds?: string[];
  currency?: string;
};

type EnrollmentValidity = "30" | "90" | "180" | "365" | "lifetime" | "custom";
type PackageTerm = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

const packageTermDays: Record<Exclude<PackageTerm, "custom">, number> = {
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  annual: 365,
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
    term === "monthly" ||
    term === "quarterly" ||
    term === "semiannual" ||
    term === "annual" ||
    term === "custom"
  ) {
    return term;
  }
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
  currency = "MXN",
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm text-zinc-300">
          Tipo
          <select
            name="product_type"
            required
            value={productType}
            onChange={(event) => setProductType(event.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-white"
          >
            <option value="package">Paquete</option>
            <option value="membership">Membresía</option>
            <option value="single_class">Clase suelta</option>
            <option value="enrollment">Inscripción</option>
            <option value="other">Otro</option>
          </select>
        </label>

        <label className="text-sm text-zinc-300">
          Precio {currency}
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
              Periodo del paquete
              <select
                name="package_term"
                required
                value={packageTerm}
                onChange={(event) => setPackageTerm(event.target.value as PackageTerm)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-white"
              >
                <option value="monthly">Mensual</option>
                <option value="quarterly">Trimestral</option>
                <option value="semiannual">Semestral</option>
                <option value="annual">Anual</option>
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

        {!isEnrollment ? (
          <label className="text-sm text-zinc-300">
            Créditos
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
          <label className="flex items-center gap-3 rounded-xl border border-white/10 p-4 text-sm text-zinc-300">
            <input
              name="unlimited"
              type="checkbox"
              defaultChecked={initialUnlimited}
              className="h-4 w-4"
            />
            Producto ilimitado (ignora el número de créditos)
          </label>

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
        </>
      ) : null}
    </div>
  );
}
