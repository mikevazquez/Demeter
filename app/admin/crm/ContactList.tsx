"use client";
import Link from "next/link";
import { useState } from "react";
import type { CrmContact } from "@/lib/crm/data";
import { personTypes, typeLabels, stageLabels, nextAction } from "@/lib/crm/demi-state";
function ChannelIcon({ channel }: { channel: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    "aria-hidden": true as const,
  };
  if (channel === "Instagram")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r=".8" fill="currentColor" />
      </svg>
    );
  if (channel === "WhatsApp")
    return (
      <svg {...common}>
        <path d="M4 20l1-4a9 9 0 1 1 4 4z" />
        <path d="M8 7c0 5 4 9 9 9l1-3-3-1-1 1-3-3 1-1-1-3z" />
      </svg>
    );
  if (channel === "Facebook")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="M13 21V11h4M13 11V8c0-2 1-3 4-3" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M4 5h16v12H9l-5 4z" />
    </svg>
  );
}
const qualifications = { pending: "Pendiente", qualified: "Apta", not_qualified: "No apta" };
export default function ContactList({ contacts }: { contacts: CrmContact[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [channel, setChannel] = useState("all");
  const [qualification, setQualification] = useState("all");
  const [order, setOrder] = useState("recent");
  const filtered = contacts
    .filter(
      (c) =>
        (type === "all" ||
          (type === "review"
            ? !!c.reviewReason
            : !c.reviewReason && c.state.personType === type)) &&
        (channel === "all" || c.channel === channel) &&
        (qualification === "all" || c.state.qualification === qualification) &&
        [c.name, c.phone, c.email, c.channel]
          .join(" ")
          .toLocaleLowerCase("es")
          .includes(query.trim().toLocaleLowerCase("es")),
    )
    .sort((a, b) =>
      order === "recent"
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt),
    );
  return (
    <>
      <header className="crm-heading">
        <div>
          <span className="crm-eyebrow">STUDIO FLOW · DEMI</span>
          <h1>CRM de alumnas</h1>
          <p>Identifica a cada contacto y acompaña su siguiente paso.</p>
        </div>
      </header>
      <div className="crm-summary">
        {personTypes.map((t) => (
          <button
            key={t}
            aria-pressed={type === t}
            className={`crm-stat ${t}`}
            onClick={() => setType(type === t ? "all" : t)}
          >
            <span>{typeLabels[t]}</span>
            <strong>
              {contacts.filter((c) => !c.reviewReason && c.state.personType === t).length}
            </strong>
          </button>
        ))}
      </div>
      {contacts.some((c) => c.reviewReason) && (
        <p className="crm-help">
          {contacts.filter((c) => c.reviewReason).length} registros requieren verificar su
          inscripción antes de asignar un tipo.{" "}
          <button type="button" className="crm-text-button" onClick={() => setType("review")}>
            Revisar registros
          </button>
        </p>
      )}
      <section className="crm-panel">
        <div className="crm-filters">
          <label className="crm-search">
            Buscar contacto
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre, teléfono, correo o canal"
              type="search"
            />
          </label>
          <label>
            Tipo
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">Todas</option>
              <option value="review">Por verificar</option>
              {personTypes.map((t) => (
                <option key={t} value={t}>
                  {typeLabels[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Calificación
            <select value={qualification} onChange={(e) => setQualification(e.target.value)}>
              <option value="all">Todas</option>
              {Object.entries(qualifications).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Canal
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="all">Todos</option>
              {["WhatsApp", "Instagram", "Facebook", "Sin identificar"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Orden
            <select value={order} onChange={(e) => setOrder(e.target.value)}>
              <option value="recent">Más recientes</option>
              <option value="old">Más antiguos</option>
            </select>
          </label>
        </div>
        <div className="crm-result-count" aria-live="polite">
          {filtered.length} contactos
        </div>
        <div className="crm-table-head">
          <span>Nombre</span>
          <span>Canal y fecha</span>
          <span>Tipo y etapa</span>
          <span>Calificación</span>
          <span>Próxima acción</span>
        </div>
        <div className="crm-rows">
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/admin/crm/${c.id}`}
              className="crm-row"
              aria-label={`Abrir ficha de ${c.name}`}
            >
              <div className="crm-person">
                <span className="crm-avatar">
                  {c.name
                    .split(" ")
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </span>
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.phone || c.email || "Sin teléfono"}</small>
                </div>
              </div>
              <div>
                <span className={`crm-channel ${c.channel.toLowerCase()}`}>
                  <ChannelIcon channel={c.channel} />
                  {c.channel}
                </span>
                <small>
                  {new Date(c.createdAt).toLocaleDateString("es-MX", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "America/Mexico_City",
                  })}
                </small>
              </div>
              <div>
                <span className={`crm-badge ${c.state.personType}`}>
                  {c.reviewReason ? "Por verificar" : typeLabels[c.state.personType]}
                </span>
                <small>{c.reviewReason || stageLabels[c.state.stage]}</small>
              </div>
              <div>
                <span className={`crm-badge ${c.state.qualification}`}>
                  {qualifications[c.state.qualification]}
                </span>
                {c.state.qualificationReason && <small>{c.state.qualificationReason}</small>}
              </div>
              <div>
                <span>
                  {c.reviewReason
                    ? "Verificar inscripción"
                    : c.state.human ||
                        c.state.qualification === "not_qualified" ||
                        c.state.stage === "not_booked"
                      ? nextAction(c.state)
                      : c.followup.next_action || nextAction(c.state)}
                </span>
                {c.followup.next_action_on && <small>{c.followup.next_action_on}</small>}
              </div>
            </Link>
          ))}
        </div>
        {!filtered.length && <p className="crm-empty">No hay contactos con estos filtros.</p>}
      </section>
    </>
  );
}
