import type { SupabaseClient } from "@supabase/supabase-js";

import { GiftIcon } from "@/app/admin/hoy/GiftIcon";
import type { MetaWhatsAppAdminDiagnostics } from "@/lib/assistant/meta-whatsapp-admin";
import type { ChannelReadiness } from "@/lib/notifications/channel-readiness";
import { metaWhatsAppStatusLabel } from "@/lib/notifications/meta-template-catalog";
import {
  BIRTHDAY_META_BODY,
  BIRTHDAY_META_TEMPLATE_NAME,
  birthdayMessage,
} from "@/supabase/functions/_shared/birthday-notification";
import {
  mapApprovedNotificationWhatsAppTemplateAction,
  submitNotificationWhatsAppTemplateAction,
  updateBirthdayNotificationAction,
} from "../actions";

type BirthdayRule = {
  enabled: boolean;
  channels: Array<{ channel_key: string }>;
};

export async function BirthdayNotificationEditor({
  supabase,
  studioId,
  studioName,
  rule,
  diagnostics,
  readiness,
  canManage,
  canManageTemplates,
  previewDate,
}: {
  supabase: SupabaseClient;
  studioId: string;
  studioName: string;
  rule?: BirthdayRule;
  diagnostics: MetaWhatsAppAdminDiagnostics;
  readiness: ChannelReadiness;
  canManage: boolean;
  canManageTemplates: boolean;
  previewDate?: string;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(
    new Date(),
  );
  const validDate =
    previewDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(previewDate) &&
    Number.isFinite(Date.parse(`${previewDate}T12:00:00Z`)) &&
    new Date(`${previewDate}T12:00:00Z`).toISOString().slice(0, 10) === previewDate;
  const day = validDate ? previewDate : today;
  const { data: preview, error: previewError } = await supabase.rpc(
    "admin_birthday_notification_preview",
    {
      p_studio_id: studioId,
      p_day: day,
    },
  );
  const students =
    !previewError && preview && Array.isArray(preview.students)
      ? (preview.students as Array<{ id: string; name: string }>)
      : [];
  const selected = rule?.channels.some((channel) => channel.channel_key === "whatsapp") === true;
  const approved = diagnostics.templates.filter(
    (template) =>
      template.status === "APPROVED" &&
      template.language === diagnostics.templateLanguage &&
      template.variableCount === 2 &&
      template.category === "MARKETING",
  );
  const mappedName = diagnostics.templateMappings.birthday;
  const mapped = diagnostics.templates.find(
    (template) =>
      template.name === mappedName && template.language === diagnostics.templateLanguage,
  );
  const proposed = diagnostics.templates.find(
    (template) =>
      template.name === BIRTHDAY_META_TEMPLATE_NAME &&
      template.language === diagnostics.templateLanguage,
  );

  return (
    <>
      <section className="notification-detail-card">
        <div className="notification-detail-card-heading">
          <div>
            <h2>
              <GiftIcon size={20} /> Felicitación de cumpleaños
            </h2>
            <p>Todos los días · America/Mexico_City · revisión cada 15 minutos</p>
          </div>
          <span>{rule?.enabled ? "Activa" : "Desactivada"}</span>
        </div>
        <div className="notification-info-box">
          <p>
            Una felicitación por alumna y año, el día de su cumpleaños. Solo alumnas activas con
            fecha registrada; el 29 de febrero se celebra el 28 en años no bisiestos.
          </p>
          <p>
            Respeta el consentimiento, el teléfono, los límites de contacto y el horario de
            Preferencias. Si termina el día, el saludo pendiente se descarta.
          </p>
        </div>
        <div className="notification-info-box">
          <strong>
            WhatsApp · {selected ? "Seleccionado" : "Desactivado"} · {readiness.label}
          </strong>
          <p>{readiness.detail}</p>
          <p>
            Plantilla asignada: {mappedName ?? "Sin asignar"}
            {mapped ? ` · ${metaWhatsAppStatusLabel(mapped.status)}` : ""}
          </p>
          {canManage && rule ? (
            <form action={updateBirthdayNotificationAction}>
              <input type="hidden" name="rule_key" value="marketing.birthday" />
              <input type="hidden" name="operation" value="channel" />
              <input type="hidden" name="channel" value="whatsapp" />
              <input type="hidden" name="next_enabled" value={String(!selected)} />
              <button type="submit" disabled={!selected && !readiness.ready}>
                {selected ? "Desactivar WhatsApp" : "Seleccionar WhatsApp"}
              </button>
            </form>
          ) : null}
        </div>
        {canManage && rule ? (
          <form action={updateBirthdayNotificationAction} className="marketing-runtime-actions">
            <input type="hidden" name="rule_key" value="marketing.birthday" />
            <input type="hidden" name="operation" value="enabled" />
            <input type="hidden" name="next_enabled" value={String(!rule.enabled)} />
            <button type="submit" disabled={!rule.enabled && (!selected || !readiness.ready)}>
              {rule.enabled ? "Desactivar disparador" : "Activar disparador"}
            </button>
          </form>
        ) : !rule ? (
          <p>El disparador aún no está instalado en este estudio.</p>
        ) : null}
      </section>

      <section className="notification-detail-card">
        <h2>Plantilla de WhatsApp</h2>
        <p>Marketing · {diagnostics.templateLanguage} · variables: nombre y estudio</p>
        <div className="notification-info-box">
          <p>{BIRTHDAY_META_BODY}</p>
        </div>
        {proposed ? (
          <p>
            {proposed.name} · {metaWhatsAppStatusLabel(proposed.status)}
          </p>
        ) : null}
        {canManageTemplates ? (
          <>
            <form
              action={submitNotificationWhatsAppTemplateAction}
              className="notification-message-form"
            >
              <input type="hidden" name="marketing_key" value="birthday" />
              <input type="hidden" name="template_key" value="birthday" />
              <input type="hidden" name="language_code" value={diagnostics.templateLanguage} />
              <input type="hidden" name="meta_category" value="MARKETING" />
              <input type="hidden" name="meta_body" value={BIRTHDAY_META_BODY} />
              <label>
                <span>Nombre en Meta</span>
                <input
                  name="meta_template_name"
                  defaultValue={BIRTHDAY_META_TEMPLATE_NAME}
                  pattern="[a-z0-9_]+"
                  required
                />
              </label>
              <button type="submit" disabled={!diagnostics.connected}>
                Enviar plantilla a aprobación de Meta
              </button>
              <small>
                Esta acción registra la plantilla; no envía felicitaciones. Meta determina su
                aprobación.
              </small>
            </form>
            <form
              action={mapApprovedNotificationWhatsAppTemplateAction}
              className="notification-message-form"
            >
              <input type="hidden" name="marketing_key" value="birthday" />
              <input type="hidden" name="template_key" value="birthday" />
              <input type="hidden" name="language_code" value={diagnostics.templateLanguage} />
              <label>
                <span>Asignar plantilla aprobada</span>
                <select
                  name="meta_template_name"
                  defaultValue={mappedName ?? ""}
                  required
                  disabled={!approved.length}
                >
                  <option value="" disabled>
                    Selecciona una plantilla
                  </option>
                  {approved.map((template) => (
                    <option key={template.name} value={template.name}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={!approved.length}>
                Asignar a cumpleaños
              </button>
            </form>
          </>
        ) : (
          <p>La configuración de plantillas requiere permiso de ajustes.</p>
        )}
      </section>

      <section className="notification-detail-card">
        <h2>Vista previa del disparador</h2>
        <p>Consulta alumnas y mensaje para una fecha. No programa ni envía mensajes.</p>
        <form method="get" className="notification-message-form">
          <label>
            <span>Fecha a revisar</span>
            <input type="date" name="preview_date" defaultValue={day} required />
          </label>
          <button type="submit">Ver cumpleaños</button>
        </form>
        {previewError ? (
          <p>No se pudo consultar la vista previa. Revisa que el disparador esté instalado.</p>
        ) : students.length ? (
          <ul>
            {students.map((student) => (
              <li key={student.id}>
                <strong>{student.name}</strong>
                <p>{birthdayMessage(student.name, studioName)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay cumpleaños de alumnas activas en esta fecha.</p>
        )}
      </section>
    </>
  );
}
