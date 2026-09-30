"use client";

import { useActionState, useMemo, useState } from "react";

import { createUnlimitedMembership, type CreateUnlimitedState } from "./actions";

const initialState: CreateUnlimitedState = { error: null };

type Props = {
  currency: string;
  locale: string;
  packageTerm: "monthly" | "quarterly" | "semiannual" | "annual" | "custom";
  periodLabel: string;
  initialDays: number;
  fixedValidity: boolean;
};

export function CreateUnlimitedForm({
  currency,
  locale,
  packageTerm,
  periodLabel,
  initialDays,
  fixedValidity,
}: Props) {
  const [state, formAction, pending] = useActionState(
    createUnlimitedMembership,
    initialState,
  );
  const [days, setDays] = useState(initialDays);
  const [price, setPrice] = useState("1000");
  const [customName, setCustomName] = useState<string | null>(null);

  const generatedName = `${periodLabel} · Ilimitado`;
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
            ∞
          </span>
          <span>
            <strong>Datos básicos</strong>
            <span>Nombre y precio de la membresía.</span>
          </span>
        </div>

        <div className="package-form-grid">
          <label>
            Nombre
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
              <span>Elige cuántos días estará activa.</span>
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
            ∞
          </span>
          <span>
            <strong>Acceso</strong>
            <span>Esta membresía no descuenta créditos.</span>
          </span>
        </div>

        <div className="package-unlimited-badge">
          <strong>Acceso ilimitado</strong>
          <span>Puede reservar todas las veces que permita la agenda mientras esté vigente.</span>
        </div>

        <span className="package-scope-pill">Todas las disciplinas</span>
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
              placeholder="Ej. Membresía para entrenar sin límite durante el mes."
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
            Ilimitado · {fixedValidity ? periodLabel : `${days} días`} · {formattedPrice}
          </strong>
          <div className="package-chip-row">
            <span className="package-list-chip">Sin límite de créditos</span>
            <span className="package-list-chip">Todas las disciplinas</span>
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
          {pending ? "Guardando…" : "Guardar ilimitado"}
        </button>
        <a
          href={`/admin/productos/ilimitados/${packageTerm}`}
          className="packages-v2-secondary"
        >
          Cancelar
        </a>
      </div>
    </form>
  );
}
