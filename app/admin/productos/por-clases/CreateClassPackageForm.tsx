"use client";

import { useActionState, useMemo, useState } from "react";

import { createClassPackage, type CreateClassPackageState } from "./actions";

const initialState: CreateClassPackageState = { error: null };

type Props = {
  currency: string;
  locale: string;
  packageTerm: "monthly" | "quarterly" | "semiannual" | "annual" | "custom";
  periodLabel: string;
  initialDays: number;
  fixedValidity: boolean;
};

export function CreateClassPackageForm({
  currency,
  locale,
  packageTerm,
  periodLabel,
  initialDays,
  fixedValidity,
}: Props) {
  const [state, formAction, pending] = useActionState(createClassPackage, initialState);
  const [credits, setCredits] = useState(12);
  const [days, setDays] = useState(initialDays);
  const [price, setPrice] = useState("700");
  const [customName, setCustomName] = useState<string | null>(null);

  const generatedName = `${credits} clases · ${fixedValidity ? periodLabel : `${days} días`}`;
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
      <input type="hidden" name="package_term" value={packageTerm} />

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ▤
          </span>
          <span>
            <strong>Datos básicos</strong>
            <span>Lo indispensable para identificar y vender este paquete.</span>
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
            <span>Cantidad de clases disponibles en el paquete.</span>
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
        {fixedValidity ? (
          <>
            <div className="package-form-card-heading">
              <span className="package-form-card-heading-icon" aria-hidden="true">
                ◫
              </span>
              <span>
                <strong>Vigencia</strong>
                <span>La duración viene definida por la categoría elegida.</span>
              </span>
            </div>
            <input type="hidden" name="validity_days" value={initialDays} />
            <div className="package-fixed-period">
              <strong>{periodLabel}</strong>
              <span>{initialDays} días de vigencia</span>
            </div>
          </>
        ) : (
          <div className="package-counter-row">
            <span className="package-counter-copy">
              <strong>Vigencia</strong>
              <span>Elige cuántos días estará activo después de comprarlo.</span>
            </span>
            <span className="package-counter">
              <button
                type="button"
                aria-label="Quitar un día"
                onClick={() => setDays((value) => Math.max(1, value - 1))}
              >
                −
              </button>
              <input
                name="validity_days"
                type="number"
                min="1"
                required
                value={days}
                onChange={(event) => setDays(Math.max(1, Number(event.target.value) || 1))}
                aria-label="Días de vigencia"
              />
              <button
                type="button"
                aria-label="Agregar un día"
                onClick={() => setDays((value) => value + 1)}
              >
                +
              </button>
            </span>
          </div>
        )}
      </section>

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ◇
          </span>
          <span>
            <strong>Dónde aplica</strong>
            <span>Esta categoría mantiene la regla simple.</span>
          </span>
        </div>
        <span className="package-scope-pill">Todas las disciplinas</span>
        <p className="package-scope-note">
          Si quieres limitar un paquete a disciplinas, días u horarios concretos, se configura en
          “Por disciplina / horario”.
        </p>
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
              placeholder="Ej. Ideal para entrenar dos o tres veces por semana."
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
            <span>Revisa lo importante antes de guardar.</span>
          </span>
        </div>
        <div className="package-summary">
          <strong>
            {credits} clases · {fixedValidity ? periodLabel : `${days} días`} · {formattedPrice}
          </strong>
          <span className="package-list-chip">Todas las disciplinas</span>
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
          href={`/admin/productos/por-clases/${packageTerm}`}
          className="packages-v2-secondary"
        >
          Cancelar
        </a>
      </div>
    </form>
  );
}
