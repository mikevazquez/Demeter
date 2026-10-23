import Image from "next/image";
import Link from "next/link";
import { contactStageLabels, type ContactStage } from "@/lib/student-crm";

export type DirectoryTone = "bad" | "warn" | "info" | "ok";

/** P360-V2-07 · Fila del directorio: quién es, su estado y su siguiente paso en una línea. */
export default function ContactRow({
  id,
  name,
  phone,
  userId,
  stage,
  href,
  next,
  tone,
  extra,
}: {
  id: string;
  name: string;
  phone: string | null;
  userId?: string | null;
  stage: ContactStage;
  href: string;
  next: string;
  tone: DirectoryTone;
  extra?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
  return (
    <Link className="student-directory-card p360v2-person" href={href}>
      <span className="student-avatar crm-avatar" aria-hidden="true">
        {initials}
        {userId ? (
          <Image src={`/admin/alumnas/${id}/avatar`} alt="" width={39} height={39} unoptimized />
        ) : null}
      </span>
      <span className="p360v2-person-body">
        <span className="p360v2-person-top">
          <strong>{name}</strong>
          <span className={`student-state-pill crm-pill is-${stage}`}>
            {contactStageLabels[stage]}
          </span>
        </span>
        <span className="p360v2-next">
          <span className={`p360v2-dot is-${tone}`} aria-hidden="true" />
          <span className="p360v2-next-text">{next}</span>
          {extra ? <span className="p360v2-extra">+{extra}</span> : null}
        </span>
        <small className="crm-small">{phone || "Sin teléfono registrado"}</small>
      </span>
    </Link>
  );
}
