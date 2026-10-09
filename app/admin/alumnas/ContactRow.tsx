import Image from "next/image";
import Link from "next/link";
import { channelLabel, contactStageLabels, type ContactStage } from "@/lib/student-crm";
import type { ContactMessage } from "@/lib/student-crm-conversations";

export default function ContactRow({
  id,
  name,
  phone,
  userId,
  stage,
  href,
  channel,
  message,
  state,
  next,
  nextDetail,
  timeZone,
  locale,
}: {
  id: string;
  name: string;
  phone: string | null;
  userId?: string | null;
  stage: ContactStage;
  href: string;
  channel?: string;
  message?: ContactMessage;
  state: string;
  next: string;
  nextDetail?: string;
  timeZone: string;
  locale: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
  return (
    <Link className="student-directory-card crm-row" href={href}>
      <span className="crm-person">
        <span className="student-avatar crm-avatar" aria-hidden="true">
          {initials}
          {userId ? (
            <Image src={`/admin/alumnas/${id}/avatar`} alt="" width={39} height={39} unoptimized />
          ) : null}
        </span>
        <span className="student-directory-identity">
          <strong>{name}</strong>
          <small className="crm-small">{phone || "Sin teléfono registrado"}</small>
        </span>
      </span>
      <span className="crm-message-cell">
        <span className="crm-channel">{channelLabel(channel)}</span>
        <span className="crm-message">
          {message ? message.content : "Sin mensajes disponibles"}
        </span>
        {message ? (
          <small className="crm-small">
            {new Intl.DateTimeFormat(locale, {
              dateStyle: "short",
              timeStyle: "short",
              timeZone,
            }).format(new Date(message.createdAt))}
          </small>
        ) : null}
      </span>
      <span className="crm-state-cell">
        <span className={`student-state-pill crm-pill is-${stage}`}>
          {contactStageLabels[stage]}
        </span>
        <span className="crm-small">{state}</span>
      </span>
      <span className="crm-next-cell">
        <strong>{next}</strong>
        {nextDetail ? <small className="crm-small">{nextDetail}</small> : null}
      </span>
    </Link>
  );
}
