"use client";

import { useFormStatus } from "react-dom";

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
  return (
    <form action={saveStudioRegionalSettingsAction} className="advanced-v2-form">
      <input type="hidden" name="return_to" value="region" />

      <label className="advanced-v2-field">
        <span>Zona horaria</span>
        <input name="timezone" defaultValue={timezone} required />
        <small>Ejemplo: America/Mexico_City.</small>
      </label>

      <label className="advanced-v2-field">
        <span>Moneda</span>
        <input name="currency" defaultValue={currency} minLength={3} maxLength={3} required />
        <small>Ejemplos: MXN, USD o EUR.</small>
      </label>

      <label className="advanced-v2-field">
        <span>Formato regional</span>
        <input name="locale" defaultValue={locale} minLength={2} maxLength={20} required />
        <small>Ejemplos: es-MX o en-US.</small>
      </label>

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
