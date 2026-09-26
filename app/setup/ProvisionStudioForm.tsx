"use client";

import { useActionState } from "react";

import {
  initialProvisionStudioState,
  provisionStudioAction,
} from "./actions";

export function ProvisionStudioForm() {
  const [state, formAction, pending] = useActionState(
    provisionStudioAction,
    initialProvisionStudioState,
  );

  return (
    <div className="auth-form">
      {state.status === "success" ? (
        <div className="notice success">
          <strong>{state.message}</strong>
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            <span>Slug: {state.studioSlug}</span>
            <span>Owner: {state.ownerEmail}</span>
            <span>
              Cuenta: {state.reusedExistingAccount ? "reutilizada" : "nueva"}
            </span>
            {state.activationRequired ? (
              state.activationLink ? (
                <a href={state.activationLink}>Abrir enlace de activación del owner</a>
              ) : (
                <span>El owner requiere activación, pero no se pudo generar el enlace.</span>
              )
            ) : (
              <span>El owner ya puede entrar con sus credenciales actuales.</span>
            )}
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="notice error">{state.message}</div>
      ) : null}

      <form action={formAction} className="auth-form">
        <label>
          Nombre del estudio
          <input name="studio_name" required placeholder="Nombre comercial" />
        </label>

        <label>
          Slug
          <input
            name="studio_slug"
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="nombre-del-estudio"
          />
        </label>

        <label>
          Nombre del owner
          <input name="owner_name" required autoComplete="name" placeholder="Nombre completo" />
        </label>

        <label>
          Correo del owner
          <input
            name="owner_email"
            type="email"
            required
            autoComplete="email"
            placeholder="owner@estudio.com"
          />
        </label>

        <label>
          Sede principal
          <input name="site_name" defaultValue="Principal" required />
        </label>

        <label>
          Dirección
          <input name="address" placeholder="Opcional" />
        </label>

        <label>
          Sala principal
          <input name="space_name" defaultValue="Sala principal" required />
        </label>

        <label>
          Zona horaria
          <input name="timezone" defaultValue="America/Mexico_City" required />
        </label>

        <label>
          Moneda
          <input name="currency" defaultValue="MXN" maxLength={3} required />
        </label>

        <label>
          Locale
          <input name="locale" defaultValue="es-MX" required />
        </label>

        <label>
          Prefijo telefónico internacional
          <input
            name="phone_country_calling_code"
            defaultValue="+52"
            pattern="\+[1-9][0-9]{0,3}"
            maxLength={5}
            required
          />
        </label>

        <label>
          Color principal
          <input name="primary_color" defaultValue="#FF0A8A" pattern="#[0-9A-Fa-f]{6}" required />
        </label>

        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Creando estudio…" : "Crear estudio"}
        </button>
      </form>
    </div>
  );
}
