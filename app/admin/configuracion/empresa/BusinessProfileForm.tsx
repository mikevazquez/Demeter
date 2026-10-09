"use client";

import { useFormStatus } from "react-dom";

import { saveStudioBusinessProfileAction } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="advanced-v2-save" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Guardando…" : "Guardar información"}
    </button>
  );
}

export function BusinessProfileForm({
  contactPhone,
  contactEmail,
  websiteUrl,
  locationName,
  address,
}: {
  contactPhone: string;
  contactEmail: string;
  websiteUrl: string;
  locationName: string;
  address: string;
}) {
  return (
    <form action={saveStudioBusinessProfileAction} className="advanced-v2-form">
      <div className="advanced-v2-section-copy">
        <h2>Datos públicos del estudio</h2>
        <p>
          Demi consulta esta información para responder preguntas sobre ubicación, teléfono, correo
          y página web.
        </p>
      </div>

      <label className="advanced-v2-field">
        <span>Teléfono de atención</span>
        <input
          name="contact_phone"
          type="tel"
          defaultValue={contactPhone}
          maxLength={40}
          placeholder="+52 33 0000 0000"
        />
        <small>Es el número que Demi puede compartir con prospectos y alumnas.</small>
      </label>

      <label className="advanced-v2-field">
        <span>Correo de contacto</span>
        <input
          name="contact_email"
          type="email"
          defaultValue={contactEmail}
          maxLength={160}
          placeholder="hola@tustudio.com"
        />
      </label>

      <label className="advanced-v2-field">
        <span>Página web</span>
        <input
          name="website_url"
          type="url"
          defaultValue={websiteUrl}
          maxLength={300}
          placeholder="https://tustudio.com"
        />
      </label>

      <div className="advanced-v2-section-copy">
        <h2>Sede principal</h2>
        <p>Esta dirección también se usa cuando Demi responde dónde se imparten las clases.</p>
      </div>

      <label className="advanced-v2-field">
        <span>Nombre de la sede</span>
        <input
          name="location_name"
          defaultValue={locationName}
          maxLength={100}
          placeholder="Principal"
        />
      </label>

      <label className="advanced-v2-field">
        <span>Domicilio</span>
        <textarea
          name="address"
          defaultValue={address}
          maxLength={500}
          rows={3}
          placeholder="Calle, número, colonia, ciudad, estado y código postal"
        />
        <small>
          Escríbelo exactamente como quieres que Demi lo comparta. No necesita inferir ni inventar
          nada.
        </small>
      </label>

      <SubmitButton />
    </form>
  );
}
