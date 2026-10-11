import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

const settings = [
  ["Información del estudio", "Domicilio, teléfono y datos de contacto.", "empresa"],
  ["Reservas y asistencia", "Cancelaciones, mínimos y políticas del estudio.", "reservas"],
  ["Días festivos", "Decide cuándo abres, cierras o cambias el horario.", "festivos"],
  ["Pagos y transferencias", "Métodos de pago y datos bancarios.", "pagos"],
  ["Apariencia", "Nombre, logo e identidad de tu estudio.", "apariencia"],
  ["Región y formatos", "Zona horaria, moneda y teléfono.", "region"],
  ["Kiosco de asistencia", "Mensaje de bienvenida y PIN para salir.", "kiosco"],
];
export default async function ConfigurationPage() {
  await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  return (
    <main className="dashboard-shell flow-more">
      <Link className="flow-back" href="/admin/mas">
        ‹ Más
      </Link>
      <h1>Configuración del estudio</h1>
      <section className="more-list">
        {settings.map(([title, description, path]) => (
          <Link key={path} className="more-row" href={`/admin/configuracion/${path}`}>
            <span className="more-row-copy">
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
