"use client";

import { useActionState, useMemo, useState } from "react";

import { createActivityPackage, type CreateActivityPackageState } from "./actions";

const initialState: CreateActivityPackageState = { error: null };

type PackageTerm = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

const packageTerms: Array<{
  key: PackageTerm;
  label: string;
  description: string;
  days: number | null;
}> = [
  { key: "monthly", label: "Mensual", description: "30 días", days: 30 },
  { key: "quarterly", label: "Trimestral", description: "90 días", days: 90 },
  { key: "semiannual", label: "Semestral", description: "180 días", days: 180 },
  { key: "annual", label: "Anual", description: "365 días", days: 365 },
  { key: "custom", label: "Otra", description: "Personalizada", days: null },
];

export function CreateActivityPackageForm({
  activityId,
  activityName,
  currency,
  locale,
}: {
  activityId: string;
  activityName: string;
  currency: string;
  locale: string;
}) {
  const [state, formAction, pending] = useActionState(createActivityPackage, initialState);
  const [credits, setCredits] = useState(1);
  const [price, setPrice] = useState("500");
  const [packageTerm, setPackageTerm] = useState<PackageTerm>("monthly");
  const [customDays, setCustomDays] = useState(30);
  const [customName, setCustomName] = useState<string | null>(null);

  const validityDays = packageTerms.find((term) => term.key === packageTerm)?.days ?? customDays;
  const generatedName = `${activityName} · ${credits} ${credits === 1 ? "clase" : "clases"}`;
  const name = customName ?? generatedName;

  const formattedPrice = useMemo(() => {
    const value = Number(price);
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number.isFinite(value) ? value : 0);
  }, [currency, locale, price]);

  return (
    <form action={formAction} className="package-form">
      <input type="hidden" name="activity_id" value={activityId} />
      <input type="hidden" name="package_term" value={packageTerm} />
      <input type="hidden" name="validity_days" value={validityDays} />

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ◇
          </span>
          <span>
            <strong>Actividad</strong>
            <span>Este paquete quedará ligado únicamente a:</span>
          </span>
        </div>
        <div className="package-activity-badge">
          <strong>{activityName}</strong>
          <span>Aunque cambien sus días u horarios, el vínculo se conserva.</span>
        </div>
      </section>

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ▤
          </span>
          <span>
            <strong>Datos básicos</strong>
            <span>Nombre y precio del paquete.</span>
          </span>
        </div>

        <div className="package-form-grid">
          <label>
            Nombre del paquete
            <input
              name="name"
              required
              value={name}
              onChange={(event) => setCustomName(event.target.value)}
              onBlur={() => {
                if (!customName?.trim()) setCustomName(null);
              }}
            />
          </label>

          <label>
            Precio {currency}
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              required
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="package-form-card">
        <div className="package-counter-row">
          <span className="package-counter-copy">
            <strong>Clases incluidas</strong>
            <span>Cuántas sesiones de {activityName} cubre este paquete.</span>
          </span>
          <span className="package-counter">
            <button
              type="button"
              aria-label="Quitar una clase"
              onClick={() => setCredits((value) => Math.max(1, value - 1))}
            >
              −
            </button>
            <input
              name="credit_limit"
              type="number"
              min="1"
              required
              value={credits}
              onChange={(event) => setCredits(Math.max(1, Number(event.target.value) || 1))}
              aria-label="Clases incluidas"
            />
            <button
              type="button"
              aria-label="Agregar una clase"
              onClick={() => setCredits((value) => value + 1)}
            >
              +
            </button>
          </span>
        </div>
      </section>

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ◫
          </span>
          <span>
            <strong>Vigencia</strong>
            <span>Elige cuánto tiempo podrá usarse.</span>
          </span>
        </div>

        <div className="package-term-grid">
          {packageTerms.map((term) => (
            <button
              key={term.key}
              type="button"
              className={`package-term-option${packageTerm === term.key ? " is-selected" : ""}`}
              onClick={() => setPackageTerm(term.key)}
            >
              <strong>{term.label}</strong>
              <span>{term.description}</span>
            </button>
          ))}
        </div>

        {packageTerm === "custom" ? (
          <label>
            Días de vigencia
            <input
              type="number"
              min="1"
              value={customDays}
              onChange={(event) => setCustomDays(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
        ) : null}
      </section>

      <details>
        <summary>
          <span>Opciones adicionales</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div>
          <label>
            Descripción opcional
            <textarea
              name="description"
              placeholder={`Ej. Paquete completo para ${activityName}.`}
            />
          </label>
        </div>
      </details>

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ≡
          </span>
          <span>
            <strong>Resumen</strong>
            <span>Así quedará configurado.</span>
          </span>
        </div>

        <div className="package-summary">
          <strong>
            {credits} {credits === 1 ? "clase" : "clases"} · {validityDays} días · {formattedPrice}
          </strong>
          <div className="package-chip-row">
            <span className="package-list-chip">Solo {activityName}</span>
          </div>
        </div>
      </section>

      {state.error ? (
        <section className="packages-v2-info" role="alert">
          <span className="packages-v2-info-icon" aria-hidden="true">
            !
          </span>
          <p>{state.error}</p>
        </section>
      ) : null}

      <div className="package-form-actions">
        <button type="submit" className="packages-v2-primary" disabled={pending}>
          {pending ? "Guardando…" : "Guardar paquete"}
        </button>
        <a
          href={`/admin/productos/cursos-talleres/${activityId}`}
          className="packages-v2-secondary"
        >
          Cancelar
        </a>
      </div>
    </form>
  );
}
