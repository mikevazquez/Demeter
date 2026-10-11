import { Children, isValidElement, type ReactNode } from "react";
import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import AppearancePage from "./apariencia/page";
import BusinessProfilePage from "./empresa/page";
import PaymentSettingsPage from "./pagos/page";
import RegionSettingsPage from "./region/page";
import ReservationSettingsPage from "./reservas/page";
import KioskSettings from "./kiosco/page";
import "./reservas/reservas-v2.css";
import { addProfileFieldAction, deactivateProfileFieldAction } from "./profile-field-actions";

function sectionContent(page: { props: { children?: ReactNode } }) {
  return Children.toArray(page.props.children).filter(
    (child) =>
      !isValidElement<{ className?: string }>(child) ||
      (child.type !== "header" && child.type !== "h1" && !child.props.className?.includes("back")),
  );
}
export default async function ConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data: fields } = await supabase
    .from("profile_field_definitions")
    .select("id,key,label,field_type")
    .eq("studio_id", studio.id)
    .eq("entity_type", "student")
    .eq("active", true)
    .order("sort_order");
  const pages = await Promise.all([
    AppearancePage({ searchParams }),
    BusinessProfilePage({ searchParams }),
    PaymentSettingsPage({ searchParams }),
    RegionSettingsPage({ searchParams }),
    ReservationSettingsPage({ searchParams }),
    KioskSettings({ searchParams }),
  ]);
  const headings = [
    "Identidad y apariencia",
    "Información del estudio",
    "Pagos y transferencias",
    "Región",
    "Reservas y cancelaciones",
    "Kiosco de asistencia",
  ];
  return (
    <main className="portal-page portal-settings">
      <header className="portal-module-heading">
        <div>
          <Link className="flow-back" href="/admin/mas">
            ‹ Más
          </Link>
          <h1>Configuración</h1>
          <p>Reglas que aplican a todo el estudio.</p>
        </div>
      </header>
      {pages.slice(0, 4).map((page, index) => (
        <details className="card portal-settings-section" key={headings[index]} open={index === 0}>
          <summary>
            <strong>{headings[index]}</strong>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="portal-settings-content">{sectionContent(page)}</div>
        </details>
      ))}
      <details className="card portal-settings-section" id="campos">
        <summary>
          <strong>Campos adicionales del expediente</strong>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="portal-settings-content">
          <p>
            Agrega información que necesite tu estudio. Al quitar un campo, los datos capturados se
            conservan.
          </p>
          {(fields ?? [])
            .filter((f) => f.key.startsWith("custom_"))
            .map((field) => (
              <form
                key={field.id}
                action={deactivateProfileFieldAction}
                className="portal-inline-form"
              >
                <input type="hidden" name="definition_id" value={field.id} />
                <span>{field.label}</span>
                <button className="portal-button">Quitar campo</button>
              </form>
            ))}
          <form action={addProfileFieldAction} className="portal-form">
            <label>
              Nombre del campo
              <input
                name="label"
                required
                minLength={2}
                maxLength={80}
                placeholder="Ej. Objetivo personal"
              />
            </label>
            <label>
              Tipo
              <select name="field_type" defaultValue="short_text">
                <option value="short_text">Texto corto</option>
                <option value="long_text">Texto largo</option>
                <option value="number">Número</option>
                <option value="date">Fecha</option>
                <option value="boolean">Sí / No</option>
                <option value="single_select">Una opción</option>
                <option value="multi_select">Varias opciones</option>
              </select>
            </label>
            <label>
              Opciones, una por línea
              <textarea name="options" rows={3} placeholder="Solo para campos de selección" />
            </label>
            <button className="portal-button portal-button-primary">Agregar campo</button>
          </form>
        </div>
      </details>
      <section className="more-list">
        <Link className="more-row" href="/admin/configuracion/festivos">
          <span className="more-row-icon" aria-hidden="true">
            📅
          </span>
          <span className="more-row-copy">
            <strong>Días festivos y fechas especiales</strong>
            <small>Decide cuándo abres, cierras o cambias el horario.</small>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
        <Link className="more-row" href="/admin/configuracion/recursos">
          <span className="more-row-icon" aria-hidden="true">
            ⊞
          </span>
          <span className="more-row-copy">
            <strong>Recursos y mapas</strong>
            <small>Salones, tubos y aros.</small>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      </section>
      {pages.slice(4).map((page, index) => (
        <details className="card portal-settings-section" key={headings[index + 4]}>
          <summary>
            <strong>{headings[index + 4]}</strong>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="portal-settings-content">{sectionContent(page)}</div>
        </details>
      ))}
    </main>
  );
}
