"use client";

import { type CSSProperties, useState } from "react";
import { useFormStatus } from "react-dom";

import { saveStudioPortalIdentityAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Guardando…" : "Guardar identidad"}
    </button>
  );
}

export function PortalIdentityForm({
  initialName,
  initialLogoUrl,
  portalPath,
  primaryColor,
}: {
  initialName: string;
  initialLogoUrl: string | null;
  portalPath: string;
  primaryColor: string;
}) {
  const [name, setName] = useState(initialName);
  const [previewLogo, setPreviewLogo] = useState<string | null>(initialLogoUrl);
  const [removeLogo, setRemoveLogo] = useState(false);

  function handleLogoChange(file?: File) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPreviewLogo(typeof reader.result === "string" ? reader.result : null);
      setRemoveLogo(false);
    };
    reader.readAsDataURL(file);
  }

  function clearLogo() {
    setPreviewLogo(null);
    setRemoveLogo(true);
  }

  return (
    <form action={saveStudioPortalIdentityAction} className="branding-config-grid">
      <section className="panel branding-config-form">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PORTAL E IDENTIDAD</p>
            <h2>Cómo se presenta tu estudio</h2>
          </div>
        </div>

        <label className="branding-field">
          <span>Nombre visible del estudio</span>
          <input
            name="name"
            value={name}
            minLength={2}
            maxLength={80}
            required
            onChange={(event) => setName(event.target.value)}
          />
          <small>Este mismo nombre se usa en el portal y dentro del panel del estudio.</small>
        </label>

        <div className="branding-field">
          <span>Logo</span>
          <label className="branding-upload">
            <input
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => handleLogoChange(event.target.files?.[0])}
            />
            <strong>Seleccionar logo</strong>
            <small>PNG, JPG o WebP · máximo 2 MB</small>
          </label>
          {previewLogo ? (
            <button className="ghost-button branding-remove-logo" type="button" onClick={clearLogo}>
              Quitar logo
            </button>
          ) : null}
          <input type="hidden" name="remove_logo" value={removeLogo ? "1" : "0"} />
        </div>

        <div className="branding-portal-link">
          <span>Enlace público del estudio</span>
          <code>{portalPath}</code>
        </div>

        <SubmitButton />
      </section>

      <section className="panel branding-preview-panel">
        <div>
          <p className="eyebrow">VISTA PREVIA</p>
          <h2>Entrada de tu portal</h2>
        </div>

        <div
          className="branding-preview-card"
          style={{ "--preview-accent": primaryColor } as CSSProperties}
        >
          {previewLogo ? (
            <div
              className="branding-preview-logo"
              role="img"
              aria-label="Vista previa del logo"
              style={{ backgroundImage: `url("${previewLogo}")` }}
            />
          ) : (
            <div className="branding-preview-logo-fallback" aria-hidden="true">
              {(name.trim() || "D").slice(0, 1).toUpperCase()}
            </div>
          )}
          <strong>{name.trim() || "Nombre del estudio"}</strong>
          <span />
          <p>Movimiento que transforma</p>
          <div className="branding-preview-actions">
            <small>MI ESTUDIO</small>
            <small>SOY ALUMNA</small>
          </div>
        </div>
      </section>
    </form>
  );
}
