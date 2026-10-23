import Image from "next/image";
import Link from "next/link";

import { channelLabel, contactStageLabels } from "@/lib/student-crm";
import type { Profile360Model } from "./load-profile-360";
import { formatDate } from "./profile-format";
import { PROFILE_TABS, PROFILE_TAB_LABELS, profileTabHref } from "./profile-tabs";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

/** P360-V2-01 · Encabezado fijo y un solo nivel de pestañas. */
export default function Profile360Header({ model }: { model: Profile360Model }) {
  const {
    student,
    stage,
    phone,
    email,
    birthDate,
    tab,
    pendingItems,
    canSell,
    canBook,
    communications,
    locale,
  } = model;
  const whatsappDigits = phone.replace(/\D/g, "");
  const since = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(
    new Date(student.created_at),
  );
  const meta = [
    channelLabel(communications.channels.get(student.id)),
    phone,
    email || null,
    birthDate ? `Cumple ${formatDate(birthDate, locale).replace(/\s\d{4}$/, "")}` : null,
    `${contactStageLabels[stage]} desde ${since}`,
  ].filter((value): value is string => Boolean(value) && value !== "Sin conversación");

  return (
    <>
      <section className="profile360-approved-header crm-contact-header p360v2-header">
        <Link className="profile360-back crm-back" href="/admin/alumnas">
          ← Alumnas
        </Link>
        <div className="profile360-approved-person crm-contact-person">
          <span className="profile360-avatar crm-avatar" aria-hidden="true">
            {initials(student.full_name)}
            {student.user_id ? (
              <Image
                src={`/admin/alumnas/${student.id}/avatar`}
                alt=""
                width={50}
                height={50}
                unoptimized
              />
            ) : null}
          </span>
          <div className="profile360-approved-copy">
            <div className="profile360-approved-title">
              <h1>{student.full_name}</h1>
              <span className={`crm-pill is-${stage}`}>{contactStageLabels[stage]}</span>
            </div>
            <div className="profile360-approved-contact">
              {meta.map((value) => (
                <span key={value}>{value}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="p360v2-quick">
          {whatsappDigits ? (
            <a
              className="crm-btn"
              href={`https://wa.me/${whatsappDigits}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          ) : null}
          {canBook && student.lifecycle_status !== "inactive" ? (
            <Link className="crm-btn" href={`/admin/alumnas/${student.id}/reservar`}>
              Reservar
            </Link>
          ) : null}
          {canSell && student.lifecycle_status !== "inactive" ? (
            <Link
              className="crm-btn is-primary"
              href={`/admin/ventas/nueva?student_id=${student.id}`}
            >
              Vender
            </Link>
          ) : null}
        </div>
      </section>
      <nav className="profile360-approved-tabs crm-tabs p360v2-tabs" aria-label="Perfil 360">
        {PROFILE_TABS.map((item) => (
          <Link
            key={item}
            className={tab === item ? "is-active" : ""}
            aria-current={tab === item ? "page" : undefined}
            href={profileTabHref(student.id, item)}
          >
            {PROFILE_TAB_LABELS[item]}
            {item === "summary" && pendingItems.length ? (
              <span className="p360v2-count">{pendingItems.length}</span>
            ) : null}
          </Link>
        ))}
      </nav>
    </>
  );
}
