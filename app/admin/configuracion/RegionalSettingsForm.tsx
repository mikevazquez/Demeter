"use client";

import { useFormStatus } from "react-dom";

import { saveStudioRegionalSettingsAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Guardando…" : "Guardar región"}
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
    <form action={saveStudioRegionalSettingsAction} className="panel branding-config-form">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">REGIÓN</p>
          <h2>Hora, moneda, idioma y teléfono</h2>
        </div>
      </div>

      <label className="branding-field">
        <span>Zona horaria</span>
        <input name="timezone" defaultValue={timezone} required />
        <small>Usa una zona IANA, por ejemplo America/Mexico_City.</small>
      </label>

      <label className="branding-field">
        <span>Moneda</span>
        <input
          name="currency"
          defaultValue={currency}
          minLength={3}
          maxLength={3}
          required
        />
        <small>Código ISO de tres letras, por ejemplo MXN, USD o EUR.</small>
      </label>

      <label className="branding-field">
        <span>Locale</span>
        <input name="locale" defaultValue={locale} minLength={2} maxLength={20} required />
        <small>Formato regional, por ejemplo es-MX o en-US.</small>
      </label>

      <label className="branding-field">
        <span>Prefijo telefónico internacional</span>
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
