"use client";

import { useSyncExternalStore, useState } from "react";
import Link from "next/link";

export type CrmPerson = {
  id: string;
  name: string;
  phone: string;
  href: string;
  column: string;
  context: string;
};
const states = [
  {
    id: "prospecto",
    label: "Prospecto",
    bot: "Demi",
    columns: ["contacto", "viabilidad", "pagop"],
  },
  { id: "prueba", label: "Prueba", bot: "Demi", columns: ["agendada", "pagoins", "noshow"] },
  {
    id: "alumna",
    label: "Alumna",
    bot: "Polina",
    columns: ["porvencer", "pagoa", "activa", "vencida"],
  },
  { id: "exalumna", label: "Exalumna", bot: "Polina", columns: ["ex"] },
];
const columns: Record<
  string,
  { label: string; description: string; color: string; flag?: boolean }
> = {
  contacto: { label: "Primer contacto", description: "Pidió información", color: "violet" },
  viabilidad: { label: "Viabilidad", description: "Validando horario y zona", color: "violet" },
  pagop: {
    label: "Pago pendiente",
    description: "Apartó su prueba sin pagar",
    color: "red",
    flag: true,
  },
  agendada: { label: "Clase agendada", description: "Prueba pagada, por asistir", color: "green" },
  pagoins: {
    label: "Pago pendiente",
    description: "Tomó su prueba; falta la inscripción",
    color: "red",
    flag: true,
  },
  noshow: {
    label: "No show",
    description: "Faltó a su clase de prueba",
    color: "amber",
    flag: true,
  },
  porvencer: {
    label: "Por vencer",
    description: "7 días o menos, o 1 clase",
    color: "amber",
    flag: true,
  },
  pagoa: {
    label: "Pago pendiente",
    description: "Saldo, cobro o comprobante",
    color: "red",
    flag: true,
  },
  activa: { label: "Activa", description: "Paquete vigente", color: "green" },
  vencida: {
    label: "Sin paquete",
    description: "Inscripción vigente, sin paquete activo",
    color: "blue",
  },
  ex: { label: "Inscripción vencida", description: "Su inscripción anual venció", color: "faint" },
};
const normalized = (value: string) =>
  value
    .toLocaleLowerCase("es-MX")
    .normalize("NFD")
    .replace(/[\u0300-\u036f\s]/g, "");
function readFunnel() {
  try {
    const saved = localStorage.getItem("sf-funnel");
    return states.some((s) => s.id === saved) ? saved! : "alumna";
  } catch {
    return "alumna";
  }
}
function subscribeFunnel(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("sf-funnel-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("sf-funnel-change", callback);
  };
}
export default function CrmBoard({
  people,
  initialQuery,
}: {
  people: CrmPerson[];
  initialQuery: string;
}) {
  const stateId = useSyncExternalStore(subscribeFunnel, readFunnel, () => "alumna");
  const [query, setQuery] = useState(initialQuery);
  const visible = people
    .filter((p) => normalized(p.name + p.phone).includes(normalized(query)))
    .sort((a, b) => a.name.localeCompare(b.name, "es-MX"));
  const state = states.find((s) => s.id === stateId)!;
  const selected = visible.filter((p) => state.columns.includes(p.column));
  const pending = selected.filter((p) => columns[p.column].flag).length;
  return (
    <section className="portal-crm">
      <p className="portal-muted">
        {selected.length} en {state.label.toLowerCase()} · {pending} con acción pendiente · atiende{" "}
        {state.bot}
      </p>
      <nav className="portal-segmented portal-crm-states" aria-label="Estado de la persona">
        {states.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === stateId}
            onClick={() => {
              try {
                localStorage.setItem("sf-funnel", s.id);
                window.dispatchEvent(new Event("sf-funnel-change"));
              } catch {}
            }}
          >
            {s.label} <i>{visible.filter((p) => s.columns.includes(p.column)).length}</i>
          </button>
        ))}
      </nav>
      <input
        type="search"
        aria-label="Buscar por nombre o teléfono"
        placeholder="Buscar por nombre o teléfono"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="portal-crm-board" aria-label={`Etapas de ${state.label}`}>
        {state.columns.map((id) => {
          const column = columns[id];
          const items = selected.filter((p) => p.column === id);
          return (
            <section
              key={id}
              className="portal-crm-column"
              style={{ "--stage": `var(--${column.color})` } as React.CSSProperties}
            >
              <header>
                <h2>
                  <span aria-hidden="true" />
                  {column.label}
                </h2>
                <b>{items.length}</b>
              </header>
              <p>{column.description}</p>
              <div className="portal-crm-cards">
                {items.map((p) => (
                  <Link key={p.id} href={p.href} className="portal-person-card">
                    <span
                      className="portal-person-avatar"
                      style={
                        {
                          "--avatar-hue": String(
                            [...p.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 360,
                          ),
                        } as React.CSSProperties
                      }
                      aria-hidden="true"
                    >
                      {p.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((n) => n[0])
                        .join("")}
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.context}</small>
                    </span>
                    {column.flag ? (
                      <i
                        className="portal-person-flag"
                        aria-label="Acción pendiente"
                        title="Acción pendiente"
                      />
                    ) : null}
                  </Link>
                ))}
                {!items.length ? <p className="portal-empty">Nadie en esta etapa</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
