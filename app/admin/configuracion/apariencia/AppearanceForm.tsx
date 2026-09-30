"use client";

import { type CSSProperties, useState } from "react";
import { useFormStatus } from "react-dom";

import { saveStudioPortalIdentityAction } from "../actions";

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button className="appearance-v2-save" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Guardando…" : "Guardar apariencia"}
    </button>
  );
}

function LogoPreview({ name, logo }: { name: string; logo: string | null }) {
  if (logo) {
    return (
      <span
        className="appearance-v2-logo"
        role="img"
        aria-label="Vista previa del logo"
        style={{ backgroundImage: `url("${logo}")` }}
      />
    );
  }

  return (
    <span className="appearance-v2-logo is-fallback" aria-hidden="true">
      {(name.trim() || "S").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AppearanceForm({
  initialName,
  initialLogoUrl,
  initialPrimaryColor,
  initialTagline,
  portalPath,
}: {
  initialName: string;
  initialLogoUrl: string | null;
  initialPrimaryColor: string;
  initialTagline: string | null;
  portalPath: string;
}) {
  const [name, setName] = useState(initialName);
  const [tagline, setTagline] = useState(initialTagline ?? "");
  const [primaryColor, setPrimaryColor] = useState(initialPrimaryColor);
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

  const previewStyle = {
    "--appearance-preview-accent": primaryColor,
  } as CSSProperties;

  return (
    <form action={saveStudioPortalIdentityAction} className="appearance-v2-layout">
      <input type="hidden" name="return_to" value="appearance" />
      <input type="hidden" name="remove_logo" value={removeLogo ? "1" : "0"} />

      <section className="appearance-v2-card appearance-v2-editor">
        <div className="appearance-v2-card-heading">
          <div>
            <h2>Marca del estudio</h2>
            <p>Estos datos se usan en el portal, panel e instalación de la app.</p>
          </div>
        </div>

        <label className="appearance-v2-field">
          <span>Nombre visible</span>
          <input
            name="name"
            value={name}
            minLength={2}
            maxLength={80}
            required
            onChange={(event) => setName(event.target.value)}
          />
          <small>Es el nombre que verán alumnas y equipo.</small>
        </label>

        <label className="appearance-v2-field">
          <span>Frase de marca</span>
          <input
            name="tagline"
            value={tagline}
            maxLength={120}
            placeholder="Opcional"
            onChange={(event) => setTagline(event.target.value)}
          />
          <small>Se muestra como apoyo debajo del nombre.</small>
        </label>

        <div className="appearance-v2-field">
          <span>Color principal</span>
          <div className="appearance-v2-color-row">
            <input
              name="primary_color"
              type="color"
              value={primaryColor}
              onChange={(event) => setPrimaryColor(event.target.value.toUpperCase())}
              aria-label="Color principal"
            />
            <input
              className="appearance-v2-color-code"
              value={primaryColor.toUpperCase()}
              readOnly
              aria-label="Código del color principal"
            />
          </div>
          <small>Se usa en botones, acentos y el icono de la PWA.</small>
        </div>

        <div className="appearance-v2-field">
          <span>Logo</span>
          <div className="appearance-v2-logo-control">
            <LogoPreview name={name} logo={previewLogo} />
            <label className="appearance-v2-upload">
              <input
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => handleLogoChange(event.target.files?.[0])}
              />
              <strong>{previewLogo ? "Cambiar logo" : "Seleccionar logo"}</strong>
              <small>PNG, JPG o WebP · máximo 2 MB</small>
            </label>
          </div>
          {previewLogo ? (
            <button className="appearance-v2-remove" type="button" onClick={clearLogo}>
              Quitar logo
            </button>
          ) : null}
        </div>

        <div className="appearance-v2-public-link">
          <span>Enlace público</span>
          <code>{portalPath}</code>
        </div>

        <SaveButton />
      </section>

      <aside className="appearance-v2-previews" style={previewStyle}>
        <section className="appearance-v2-card">
          <div className="appearance-v2-card-heading">
            <div>
              <h2>Vista del portal</h2>
              <p>Así se presenta tu estudio.</p>
            </div>
          </div>

          <div className="appearance-v2-portal-preview">
            <LogoPreview name={name} logo={previewLogo} />
            <strong>{name.trim() || "Nombre del estudio"}</strong>
            <p>{tagline.trim() || "Tu frase de marca"}</p>
            <button type="button">Reservar clase</button>
          </div>
        </section>

        <section className="appearance-v2-card">
          <div className="appearance-v2-card-heading">
            <div>
              <h2>App instalada</h2>
              <p>Nombre e icono que acompañan la PWA del estudio.</p>
            </div>
          </div>

          <div className="appearance-v2-app-preview">
            <div className="appearance-v2-app-icon">
              <LogoPreview name={name} logo={previewLogo} />
            </div>
            <div>
              <strong>{name.trim() || "Nombre del estudio"}</strong>
              <span>Aplicación del estudio</span>
            </div>
          </div>

          <div className="appearance-v2-note">
            El icono se actualiza automáticamente usando tu logo y color principal.
          </div>
        </section>
      </aside>
    </form>
  );
}
