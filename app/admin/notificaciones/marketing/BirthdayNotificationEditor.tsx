import type { SupabaseClient } from "@supabase/supabase-js";

import { GiftIcon } from "@/app/admin/hoy/GiftIcon";
import type { MetaWhatsAppAdminDiagnostics } from "@/lib/assistant/meta-whatsapp-admin";
import type { ChannelReadiness } from "@/lib/notifications/channel-readiness";
import { metaWhatsAppStatusLabel } from "@/lib/notifications/meta-template-catalog";
import {
  BIRTHDAY_META_BODY,
  BIRTHDAY_META_TEMPLATE_NAME,
  BIRTHDAY_MONTH_META_BODY,
  BIRTHDAY_MONTH_META_TEMPLATE_NAME,
  birthdayMessage,
  birthdayMonthMessage,
} from "@/supabase/functions/_shared/birthday-notification";
import {
  mapApprovedNotificationWhatsAppTemplateAction,
  saveBirthdayGiftSettingsAction,
  submitNotificationWhatsAppTemplateAction,
  updateBirthdayNotificationAction,
} from "../actions";

type BirthdayRule = {
  enabled: boolean;
  channels: Array<{ channel_key: string }>;
};

type MessageConfig = {
  ruleKey: "marketing.birthday" | "marketing.birthday_month";
  templateKey: "birthday" | "birthday_month";
  title: string;
  schedule: string;
  explanation: string[];
  body: string;
  proposedName: string;
  render: (name: string, studio: string) => string;
};

const MESSAGES: MessageConfig[] = [
  {
    ruleKey: "marketing.birthday",
    templateKey: "birthday",
    title: "Felicitación de cumpleaños",
    schedule: "El día de su cumpleaños · hora del estudio · revisión cada 15 minutos",
    explanation: [
      "Una felicitación por alumna y año, el día de su cumpleaños. Solo alumnas activas con fecha registrada; el 29 de febrero se celebra el 28 en años no bisiestos.",
      "Respeta el consentimiento, el teléfono, los límites de contacto y el horario de Preferencias. Si termina el día, el saludo pendiente se descarta.",
    ],
    body: BIRTHDAY_META_BODY,
    proposedName: BIRTHDAY_META_TEMPLATE_NAME,
    render: birthdayMessage,
  },
  {
    ruleKey: "marketing.birthday_month",
    templateKey: "birthday_month",
    title: "Aviso del regalo · día 1 de su mes",
    schedule: "El día 1 de su mes de cumpleaños · hora del estudio",
    explanation: [
      "Avisa que su pase de regalo ya está en su portal. Un aviso por alumna y año; solo se envía si el regalo de cumpleaños está activo.",
      "Si no sale en los primeros 3 días del mes, se descarta. Respeta consentimiento y horario de Preferencias.",
    ],
    body: BIRTHDAY_MONTH_META_BODY,
    proposedName: BIRTHDAY_MONTH_META_TEMPLATE_NAME,
    render: birthdayMonthMessage,
  },
];

function BirthdayMessageCard({
  config,
  rule,
  readiness,
  diagnostics,
  canManage,
  canManageTemplates,
  blockedReason,
}: {
  config: MessageConfig;
  rule?: BirthdayRule;
  readiness: ChannelReadiness;
  diagnostics: MetaWhatsAppAdminDiagnostics;
  canManage: boolean;
  canManageTemplates: boolean;
  blockedReason?: string | null;
}) {
  const selected = rule?.channels.some((channel) => channel.channel_key === "whatsapp") === true;
  const approved = diagnostics.templates.filter(
    (template) =>
      template.status === "APPROVED" &&
      template.language === diagnostics.templateLanguage &&
      template.variableCount === 2 &&
      template.category === "MARKETING",
  );
  const mappedName = diagnostics.templateMappings[config.templateKey];
  const mapped = diagnostics.templates.find(
    (template) =>
      template.name === mappedName && template.language === diagnostics.templateLanguage,
  );
  const proposed = diagnostics.templates.find(
    (template) =>
      template.name === config.proposedName && template.language === diagnostics.templateLanguage,
  );

  return (
    <section className="notification-detail-card">
      <div className="notification-detail-card-heading">
        <div>
          <h2>
            <GiftIcon size={20} /> {config.title}
          </h2>
          <p>{config.schedule}</p>
        </div>
        <span>{rule?.enabled ? "Activa" : "Desactivada"}</span>
      </div>
      <div className="notification-info-box">
        {config.explanation.map((line) => (
          <p key={line}>{line}</p>
        ))}
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
            <input type="hidden" name="rule_key" value={config.ruleKey} />
            <input type="hidden" name="operation" value="channel" />
            <input type="hidden" name="channel" value="whatsapp" />
            <input type="hidden" name="next_enabled" value={String(!selected)} />
            <button type="submit" disabled={!selected && !readiness.ready}>
              {selected ? "Desactivar WhatsApp" : "Seleccionar WhatsApp"}
            </button>
          </form>
        ) : null}
      </div>
      {blockedReason ? <p>{blockedReason}</p> : null}
      {canManage && rule ? (
        <form action={updateBirthdayNotificationAction} className="marketing-runtime-actions">
          <input type="hidden" name="rule_key" value={config.ruleKey} />
          <input type="hidden" name="operation" value="enabled" />
          <input type="hidden" name="next_enabled" value={String(!rule.enabled)} />
          <button
            type="submit"
            disabled={!rule.enabled && (!selected || !readiness.ready || Boolean(blockedReason))}
          >
            {rule.enabled ? "Desactivar disparador" : "Activar disparador"}
          </button>
        </form>
      ) : !rule ? (
        <p>El disparador aún no está instalado en este estudio.</p>
      ) : null}

      <h3>Plantilla de WhatsApp</h3>
      <p>Marketing · {diagnostics.templateLanguage} · variables: nombre y estudio</p>
      <div className="notification-info-box">
        <p>{config.body}</p>
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
            <input type="hidden" name="template_key" value={config.templateKey} />
            <input type="hidden" name="language_code" value={diagnostics.templateLanguage} />
            <input type="hidden" name="meta_category" value="MARKETING" />
            <input type="hidden" name="meta_body" value={config.body} />
            <label>
              <span>Nombre en Meta</span>
              <input
                name="meta_template_name"
                defaultValue={config.proposedName}
                pattern="[a-z0-9_]+"
                required
              />
            </label>
            <button type="submit" disabled={!diagnostics.connected}>
              Enviar plantilla a aprobación de Meta
            </button>
            <small>
              Esta acción registra la plantilla; no envía mensajes. Meta determina su aprobación.
            </small>
          </form>
          <form
            action={mapApprovedNotificationWhatsAppTemplateAction}
            className="notification-message-form"
          >
            <input type="hidden" name="marketing_key" value="birthday" />
            <input type="hidden" name="template_key" value={config.templateKey} />
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
              Asignar a este mensaje
            </button>
          </form>
        </>
      ) : (
        <p>La configuración de plantillas requiere permiso de ajustes.</p>
      )}
    </section>
  );
}

export async function BirthdayNotificationEditor({
  supabase,
  studioId,
  studioName,
  studioTimeZone,
  rule,
  monthRule,
  diagnostics,
  readiness,
  monthReadiness,
  canManage,
  canManageTemplates,
  previewDate,
}: {
  supabase: SupabaseClient;
  studioId: string;
  studioName: string;
  studioTimeZone?: string | null;
  rule?: BirthdayRule;
  monthRule?: BirthdayRule;
  diagnostics: MetaWhatsAppAdminDiagnostics;
  readiness: ChannelReadiness;
  monthReadiness: ChannelReadiness;
  canManage: boolean;
  canManageTemplates: boolean;
  previewDate?: string;
}) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: studioTimeZone || "America/Mexico_City",
  }).format(new Date());
  const validDate =
    previewDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(previewDate) &&
    Number.isFinite(Date.parse(`${previewDate}T12:00:00Z`)) &&
    new Date(`${previewDate}T12:00:00Z`).toISOString().slice(0, 10) === previewDate;
  const day = validDate ? previewDate : today;
  const monthStart = `${day.slice(0, 7)}-01`;
  const [
    { data: preview, error: previewError },
    { data: monthPreview, error: monthPreviewError },
    { data: settingsData },
  ] = await Promise.all([
    supabase.rpc("admin_birthday_notification_preview", { p_studio_id: studioId, p_day: day }),
    supabase.rpc("admin_birthday_month_notification_preview", {
      p_studio_id: studioId,
      p_month_start: monthStart,
    }),
    supabase.rpc("admin_birthday_settings", { p_studio_id: studioId }),
  ]);
  const students =
    !previewError && preview && Array.isArray(preview.students)
      ? (preview.students as Array<{ id: string; name: string }>)
      : [];
  const monthStudents =
    !monthPreviewError && monthPreview && Array.isArray(monthPreview.students)
      ? (monthPreview.students as Array<{ id: string; name: string }>)
      : [];
  const settings = (settingsData ?? null) as {
    gift_enabled?: boolean;
    gift_friend_enabled?: boolean;
  } | null;
  const giftEnabled = settings?.gift_enabled !== false;
  const friendEnabled = settings?.gift_friend_enabled !== false;
  const monthLabel = new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthStart}T12:00:00Z`));

  return (
    <>
      <section className="notification-detail-card">
        <div className="notification-detail-card-heading">
          <div>
            <h2>
              <GiftIcon size={20} /> Regalo de cumpleaños
            </h2>
            <p>1 pase de clase durante todo su mes · aparte de su paquete</p>
          </div>
          <span>{giftEnabled ? "Activo" : "Apagado"}</span>
        </div>
        <div className="notification-info-box">
          <p>
            Cada alumna activa con fecha de nacimiento recibe 1 pase de clase en su mes de
            cumpleaños. No suma ni descuenta clases de su paquete (también aplica con ilimitado) y
            se usa una sola vez. Si cancela a tiempo, el pase regresa mientras siga su mes.
          </p>
          <p>
            Su saludo de cumpleaños en el portal aparece aunque el regalo esté apagado. Talleres y
            clases con lugar a elegir no aplican.
          </p>
        </div>
        {canManageTemplates ? (
          <form action={saveBirthdayGiftSettingsAction} className="notification-message-form">
            <label className="checkbox-row">
              <input type="checkbox" name="gift_enabled" defaultChecked={giftEnabled} />
              <span>Dar 1 pase de clase de regalo en su mes de cumpleaños</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" name="gift_friend_enabled" defaultChecked={friendEnabled} />
              <span>Permitir que lo regale a una amiga (nombre y WhatsApp de la invitada)</span>
            </label>
            <button type="submit">Guardar regalo</button>
          </form>
        ) : (
          <p>
            {giftEnabled
              ? friendEnabled
                ? "Activo: ella lo usa o lo regala a una amiga."
                : "Activo: solo para ella."
              : "Apagado."}{" "}
            Cambiarlo requiere permiso de ajustes.
          </p>
        )}
      </section>

      <BirthdayMessageCard
        config={MESSAGES[1]}
        rule={monthRule}
        readiness={monthReadiness}
        diagnostics={diagnostics}
        canManage={canManage}
        canManageTemplates={canManageTemplates}
        blockedReason={
          giftEnabled ? null : "El regalo está apagado: este aviso no se puede activar."
        }
      />

      <BirthdayMessageCard
        config={MESSAGES[0]}
        rule={rule}
        readiness={readiness}
        diagnostics={diagnostics}
        canManage={canManage}
        canManageTemplates={canManageTemplates}
      />

      <section className="notification-detail-card">
        <h2>Vista previa de los disparadores</h2>
        <p>Consulta alumnas y mensajes para una fecha. No programa ni envía mensajes.</p>
        <form method="get" className="notification-message-form">
          <label>
            <span>Fecha a revisar</span>
            <input type="date" name="preview_date" defaultValue={day} required />
          </label>
          <button type="submit">Ver cumpleaños</button>
        </form>

        <h3>Felicitación del {day}</h3>
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

        <h3>Aviso del día 1 · {monthLabel}</h3>
        {monthPreviewError ? (
          <p>No se pudo consultar el aviso del día 1. Revisa que el disparador esté instalado.</p>
        ) : !giftEnabled ? (
          <p>El regalo está apagado: no se envía el aviso del día 1.</p>
        ) : monthStudents.length ? (
          <ul>
            {monthStudents.map((student) => (
              <li key={student.id}>
                <strong>{student.name}</strong>
                <p>{birthdayMonthMessage(student.name, studioName)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay alumnas activas que cumplan años en este mes.</p>
        )}
      </section>
    </>
  );
}
