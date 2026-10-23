import Link from "next/link";

import ContactConversation from "../../ContactConversation";
import { channelLabel } from "@/lib/student-crm";
import type { Profile360Model } from "../load-profile-360";
import { formatDateTime } from "../profile-format";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_FILTER_LABELS,
  profileTabHref,
  type ActivityFilter,
} from "../profile-tabs";

type TimelineEntry = {
  id: string;
  at: string;
  kind: "message" | "class" | "package" | "sale" | "reward" | "status";
  title: string;
  detail: string;
  mine?: boolean;
  href?: string;
};

const kindLabels: Record<TimelineEntry["kind"], string> = {
  message: "Mensaje",
  class: "Clase",
  package: "Paquete",
  sale: "Pago",
  reward: "Logro",
  status: "Estado",
};

const filterKinds: Record<Exclude<ActivityFilter, "messages">, TimelineEntry["kind"][] | null> = {
  all: null,
  classes: ["class"],
  payments: ["package", "sale"],
  status: ["status", "reward"],
};

/**
 * P360-V2-05 · Una línea de tiempo única de lo que ha pasado con la persona.
 * Es una vista derivada: mezcla mensajes, clases, compras, logros y cambios de estado
 * que ya se registran en sus propias tablas.
 */
export default function ActivityTab({ model }: { model: Profile360Model }) {
  const {
    student,
    activityFilter,
    profileHistoryEvents,
    contactMessages,
    communications,
    timeZone,
    locale,
  } = model;

  const entries: TimelineEntry[] = [
    ...profileHistoryEvents,
    ...(communications.canReadMessages ? contactMessages.slice(0, 40) : []).map((message) => ({
      id: "message:" + message.id,
      at: message.createdAt,
      kind: "message" as const,
      title: `${message.direction === "outbound" ? "Demi" : "Ella"} · ${channelLabel(message.channel)}`,
      detail: message.content,
      mine: message.direction === "outbound",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const kinds = activityFilter === "messages" ? null : filterKinds[activityFilter];
  const visible = kinds ? entries.filter((entry) => kinds.includes(entry.kind)) : entries;

  return (
    <div className="p360v2-stack">
      <nav className="p360v2-chips" aria-label="Filtrar actividad">
        {ACTIVITY_FILTERS.map((filter) => (
          <Link
            key={filter}
            href={profileTabHref(student.id, "activity", filter === "all" ? "" : `&f=${filter}`)}
            aria-current={activityFilter === filter ? "page" : undefined}
            className={activityFilter === filter ? "is-active" : ""}
          >
            {ACTIVITY_FILTER_LABELS[filter]}
          </Link>
        ))}
      </nav>

      {activityFilter === "messages" ? (
        <div id="mensajes" className="scroll-mt-6">
          <ContactConversation
            messages={contactMessages}
            canReadMessages={communications.canReadMessages}
            unavailable={communications.unavailable}
            locale={locale}
            timeZone={timeZone}
          />
        </div>
      ) : visible.length ? (
        <ol className="crm-card p360v2-timeline">
          {visible.slice(0, 80).map((entry) => (
            <li key={entry.id} className={`is-${entry.kind}`}>
              <time dateTime={entry.at}>{formatDateTime(entry.at, timeZone, locale)}</time>
              <div>
                <span className="p360v2-kind">{kindLabels[entry.kind]}</span>
                <strong>{entry.title}</strong>
                {entry.kind === "message" ? (
                  <p className={`p360v2-bubble${entry.mine ? " is-mine" : ""}`}>{entry.detail}</p>
                ) : (
                  <span>{entry.detail}</span>
                )}
                {entry.href ? (
                  <Link className="p360v2-link" href={entry.href}>
                    Ver detalle
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="crm-card crm-meta">Todavía no hay actividad para mostrar con este filtro.</p>
      )}
    </div>
  );
}
