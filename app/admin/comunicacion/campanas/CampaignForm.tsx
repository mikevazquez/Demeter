"use client";
import { useState } from "react";
import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { saveCampaign } from "./actions";

import { CAMPAIGN_SEGMENTS as segments } from "@/lib/notifications/campaigns";
export default function CampaignForm({
  campaign,
  audiences,
  readOnly = false,
  whatsappReady = false,
  templateName = null,
}: {
  campaign: {
    id?: string;
    name: string;
    audience_key: string;
    channel_key: string;
    message: string;
  };
  audiences: Record<string, { total: number; eligible: number; sample: string | null }>;
  readOnly?: boolean;
  whatsappReady?: boolean;
  templateName?: string | null;
}) {
  const [audience, setAudience] = useState(campaign.audience_key);
  const [channel, setChannel] = useState(campaign.channel_key);
  const [message, setMessage] = useState(campaign.message);
  const cohort = audiences[audience] ?? { total: 0, eligible: 0, sample: null };
  return (
    <form action={saveCampaign} className="portal-form card">
      <input type="hidden" name="campaign_id" value={campaign.id ?? ""} />
      <label>
        Nombre interno
        <input
          name="name"
          defaultValue={campaign.name}
          required
          minLength={2}
          maxLength={120}
          placeholder="Ej. Promo Día de las Madres"
          disabled={readOnly}
        />
      </label>
      <label>
        Audiencia
        <select
          name="audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          disabled={readOnly}
        >
          {segments.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="portal-callout">
        <strong>
          {cohort.eligible} de {cohort.total}
        </strong>{" "}
        personas son elegibles ahora. {cohort.total - cohort.eligible} no aceptan promociones o
        bloquearon mensajes. Se revisa de nuevo al enviar.
      </div>
      <label>
        Canal
        <select
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          disabled={readOnly}
        >
          <option value="inbox">Inbox</option>
          <option value="push">Push</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
      </label>
      {channel === "whatsapp" ? (
        <p className="portal-muted">
          {whatsappReady
            ? `Plantilla de Marketing aprobada: ${templateName}. La vista previa muestra el mensaje que se inserta en la plantilla.`
            : "WhatsApp requiere conectar Meta y asignar una plantilla de Marketing aprobada con las variables nombre y mensaje en Integraciones. Puedes conservar este borrador mientras la configuras."}
        </p>
      ) : null}
      <label>
        Mensaje
        <textarea
          name="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={10}
          maxLength={1024}
          rows={6}
          placeholder="Escribe el mensaje. Puedes usar {nombre}."
          disabled={readOnly}
        />
      </label>
      <div>
        <span className="portal-eyebrow">VISTA PREVIA</span>
        <div className="portal-message-preview">
          {message.replaceAll("{nombre}", cohort.sample?.split(" ")[0] ?? "Nombre") ||
            "Tu mensaje aparecerá aquí."}
        </div>
        <small className="portal-muted">{message.length}/1024 caracteres</small>
      </div>
      {!readOnly ? (
        <div className="portal-calendar-tags">
          <PendingActionButton name="intent" value="save" className="portal-button">
            Guardar borrador
          </PendingActionButton>
          <PendingActionButton
            name="intent"
            value="send"
            className="portal-button is-primary"
            disabled={(channel === "whatsapp" && !whatsappReady) || cohort.eligible === 0}
          >
            Enviar ahora
          </PendingActionButton>
          <PendingActionButton
            name="intent"
            value="tomorrow"
            className="portal-button"
            disabled={(channel === "whatsapp" && !whatsappReady) || cohort.eligible === 0}
          >
            Programar mañana · 11:00 a. m.
          </PendingActionButton>
        </div>
      ) : null}
    </form>
  );
}
