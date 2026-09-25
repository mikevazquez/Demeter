import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import {
  saveMetaWhatsappConnection,
  saveMetaWhatsappTemplates,
} from "./actions";

type ConnectionSummary = {
  connected?: boolean;
  waba_id?: string;
  phone_number_id?: string;
  graph_api_version?: string;
  language_code?: string;
  country_calling_code?: string;
  templates?: Record<string, string>;
};

const errorCopy: Record<string, string> = {
  ids_invalid: "WABA ID o Phone Number ID no tienen un formato válido.",
  token_invalid: "El access token no parece válido.",
  version_invalid: "La versión de Graph API no es válida.",
  language_invalid: "El código de idioma debe tener formato como es_MX.",
  country_invalid: "El código de país no es válido.",
  template_invalid: "Los nombres de plantilla solo pueden usar minúsculas, números y guion bajo.",
  meta_network: "No se pudo conectar con Meta para validar las credenciales.",
  meta_http: "Meta rechazó las credenciales o el Phone Number ID.",
  save_failed: "La conexión fue validada, pero no se pudo guardar en Vault.",
  test_phone_invalid: "El número de prueba no tiene un formato válido.",
  test_network: "No se pudo conectar con Meta para enviar el mensaje de prueba.",
  test_http: "Meta rechazó el mensaje hello_world de prueba.",
  template_save_failed: "No se pudo guardar el mapeo de plantillas.",
};

const templateFields = [
  {
    key: "student_welcome",
    label: "Bienvenida",
    variables: "1 variable: nombre",
    placeholder: "demeter_bienvenida",
  },
  {
    key: "reservation_confirmed",
    label: "Reserva confirmada",
    variables: "6 variables: nombre, disciplina, fecha, hora, coach, ubicación",
    placeholder: "demeter_reserva_confirmada",
  },
  {
    key: "reservation_cancelled",
    label: "Reserva cancelada",
    variables:
      "6 variables: clase, fecha, hora, tipo de cancelación, crédito recuperado, créditos restantes",
    placeholder: "demeter_reserva_cancelada",
  },
  {
    key: "waitlist_promoted",
    label: "Lugar liberado de lista de espera",
    variables: "6 variables: nombre, disciplina, fecha, hora, coach, ubicación",
    placeholder: "demeter_lista_espera",
  },
  {
    key: "class_reminder",
    label: "Recordatorio de clase",
    variables: "6 variables: nombre, disciplina, fecha, hora, coach, ubicación",
    placeholder: "demeter_recordatorio_clase",
  },
  {
    key: "class_cancelled_coach",
    label: "Clase cancelada · coach",
    variables: "6 variables: coach, clase, fecha, hora, mínimo, reservas",
    placeholder: "demeter_clase_cancelada_coach",
  },
] as const;

function asSummary(value: unknown): ConnectionSummary {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ConnectionSummary)
    : {};
}

export default async function WhatsappIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    saved?: string;
    test_sent?: string;
    templates_saved?: string;
    error?: string;
    status?: string;
  }>;
}) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const query = await searchParams;

  const { data } = await supabase.rpc("admin_get_meta_whatsapp_connection_summary", {
    target_studio_id: studio.id,
  });

  const connection = asSummary(data);
  const templates = connection.templates ?? {};

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/mas">
            ← Más
          </Link>
          <p className="eyebrow">INTEGRACIONES · WHATSAPP</p>
          <h1 className="dashboard-title">WhatsApp directo con Meta</h1>
          <p>
            Studio Flow envía WhatsApp directamente por Cloud API. Asistian queda fuera de este
            canal.
          </p>
        </div>
      </header>

      {query.connected === "1" ? (
        <div className="notice success">Conexión con Meta validada y guardada.</div>
      ) : null}

      {query.test_sent === "1" ? (
        <div className="notice success">
          Meta aceptó el mensaje hello_world de prueba. La ruta directa ya funciona.
        </div>
      ) : null}

      {query.templates_saved === "1" ? (
        <div className="notice success">Mapeo de plantillas actualizado.</div>
      ) : null}

      {query.error ? (
        <div className="notice error">
          {errorCopy[query.error] ?? "No se pudo completar la operación."}
          {query.status ? ` · HTTP ${query.status}` : ""}
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ESTADO</p>
            <h2>{connection.connected ? "🟢 Meta conectado" : "⚪ Meta sin conectar"}</h2>
          </div>
        </div>

        {connection.connected ? (
          <div className="compact-form">
            <p>
              <strong>WABA ID:</strong> {connection.waba_id}
            </p>
            <p>
              <strong>Phone Number ID:</strong> {connection.phone_number_id}
            </p>
            <p>
              <strong>Graph API:</strong> {connection.graph_api_version}
            </p>
            <p className="text-sm text-zinc-400">
              El access token está cifrado en Supabase Vault y nunca se vuelve a mostrar.
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            Conecta primero el número de prueba de Meta. No necesitas desconectar Asistian para
            hacer esta prueba.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">META CLOUD API</p>
            <h2>{connection.connected ? "Reemplazar credenciales" : "Conectar cuenta"}</h2>
            <p className="text-sm text-zinc-400">
              La conexión se valida contra Meta antes de guardarse. Para producción usa un token
              de System User; no uses el token temporal del panel de pruebas.
            </p>
          </div>
        </div>

        <form action={saveMetaWhatsappConnection} className="compact-form">
          <label>
            WABA ID
            <input
              type="text"
              name="waba_id"
              inputMode="numeric"
              defaultValue={connection.waba_id ?? ""}
              placeholder="123456789012345"
              required
            />
          </label>

          <label>
            Phone Number ID
            <input
              type="text"
              name="phone_number_id"
              inputMode="numeric"
              defaultValue={connection.phone_number_id ?? ""}
              placeholder="123456789012345"
              required
            />
          </label>

          <label>
            Access token
            <input
              type="password"
              name="access_token"
              autoComplete="off"
              placeholder={connection.connected ? "Pega un token nuevo para reemplazar la conexión" : "EAAG…"}
              required
            />
          </label>

          <label>
            Graph API
            <input
              type="text"
              name="graph_api_version"
              defaultValue={connection.graph_api_version ?? "v26.0"}
              required
            />
          </label>

          <label>
            Número de prueba · opcional
            <input
              type="tel"
              name="test_recipient"
              placeholder="33 3638 6674"
              autoComplete="tel"
            />
          </label>

          <input
            type="hidden"
            name="language_code"
            value={connection.language_code ?? "es_MX"}
          />
          <input
            type="hidden"
            name="country_calling_code"
            value={connection.country_calling_code ?? "52"}
          />

          {templateFields.map((template) => (
            <input
              key={template.key}
              type="hidden"
              name={`template_${template.key}`}
              value={templates[template.key] ?? ""}
            />
          ))}

          <p className="text-sm text-zinc-400">
            Si agregas un número de prueba, Studio Flow enviará la plantilla oficial{" "}
            <code>hello_world</code> directamente por Meta al guardar.
          </p>

          <button className="primary-button" type="submit">
            {connection.connected ? "Validar y reemplazar conexión" : "Validar y conectar Meta"}
          </button>
        </form>
      </section>

      {connection.connected ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PLANTILLAS</p>
              <h2>Mapeo Studio Flow → Meta</h2>
              <p className="text-sm text-zinc-400">
                Crea y aprueba estas plantillas en WhatsApp Manager. Luego pega aquí el nombre
                exacto. Los campos vacíos no se enviarán por WhatsApp.
              </p>
            </div>
          </div>

          <form action={saveMetaWhatsappTemplates} className="compact-form">
            <label>
              Idioma de las plantillas
              <input
                type="text"
                name="language_code"
                defaultValue={connection.language_code ?? "es_MX"}
                required
              />
            </label>

            <label>
              Código telefónico predeterminado
              <input
                type="text"
                name="country_calling_code"
                inputMode="numeric"
                defaultValue={connection.country_calling_code ?? "52"}
                required
              />
            </label>

            {templateFields.map((template) => (
              <label key={template.key}>
                {template.label}
                <input
                  type="text"
                  name={`template_${template.key}`}
                  defaultValue={templates[template.key] ?? ""}
                  placeholder={template.placeholder}
                />
                <span className="text-sm text-zinc-400">{template.variables}</span>
              </label>
            ))}

            <button className="primary-button" type="submit">
              Guardar plantillas
            </button>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ASISTIAN</p>
            <h2>Compatibilidad temporal</h2>
          </div>
        </div>
        <p className="text-sm text-zinc-400">
          El adaptador anterior se conserva para entregas que ya estaban en cola. Las nuevas
          entregas de WhatsApp en Sandbox usan Meta.
        </p>
        <Link className="secondary-button" href="/admin/integraciones/asistian">
          Abrir integración anterior
        </Link>
      </section>
    </main>
  );
}
