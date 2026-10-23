"use client";

import { useFormStatus } from "react-dom";

import { MEXICO_TIME_ZONES } from "@/lib/studio-time";

import { saveStudioRegionalSettingsAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="advanced-v2-save" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Guardando…" : "Guardar cambios"}
    </button>
  );
}

export function RegionalSettingsForm({
  timezone,
  currency,
  locale,
  phoneCountryCallingCode,
}: {
  timezone: string;
  currency: string;
  locale: string;
  phoneCountryCallingCode: string;
}) {
  const zoneOptions = MEXICO_TIME_ZONES.some((zone) => zone.value === timezone)
    ? MEXICO_TIME_ZONES
    : [{ value: timezone, label: timezone }, ...MEXICO_TIME_ZONES];
  return (
    <form action={saveStudioRegionalSettingsAction} className="advanced-v2-form">
      <input type="hidden" name="return_to" value="region" />

      <label className="advanced-v2-field">
        <span>Zona horaria</span>
        <select name="timezone" defaultValue={timezone} required>
          {zoneOptions.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </select>
        <small>
          Horarios, «hoy», cumpleaños, recordatorios y reportes se calculan con esta hora.
        </small>
      </label>

      {/* NEB-01-35 · Nébora v1 es solo para México: pesos y español de México quedan fijos. */}
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="locale" value={locale} />
      <div className="advanced-v2-field">
        <span>Moneda y formato</span>
        <p>
          {currency} · {locale}
        </p>
        <small>Por ahora todos los estudios usan pesos mexicanos y español de México.</small>
      </div>

      <label className="advanced-v2-field">
        <span>Prefijo telefónico</span>
        <input
          name="phone_country_calling_code"
          defaultValue={phoneCountryCallingCode}
          pattern="\+[1-9][0-9]{0,3}"
          maxLength={5}
          required
        />
        <small>Ejemplos: +52 México, +1 EE. UU./Canadá, +34 España.</small>
      </label>

      <SubmitButton />
    </form>
  );
}
