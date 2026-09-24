"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  bulkCalendarDayOperationAction,
  createManualCalendarDayAction,
  deleteManualCalendarDayAction,
  saveCalendarDayAction,
} from "./actions";

export type CalendarDayRow = {
  date: string;
  name: string;
  sourceKind: "official" | "manual";
  operationMode: "normal" | "closed" | "special";
  message: string;
  themeKey: string;
  heroUrl: string | null;
  messageUrl: string | null;
  configured: boolean;
  sourceLabel: string;
};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="primary-button">
      {pending ? "Guardando…" : children}
    </button>
  );
}

function operationLabel(mode: CalendarDayRow["operationMode"]) {
  if (mode === "closed") return "Estudio cerrado";
  if (mode === "special") return "Horario especial";
  return "Horario normal";
}

export function HolidayConfigurationClient({
  year,
  rows,
}: {
  year: number;
  rows: CalendarDayRow[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualOpen, setManualOpen] = useState(false);
  const selectedDates = useMemo(() => [...selected].sort(), [selected]);

  function toggle(date: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function selectAll() {
    setSelected((current) =>
      current.size === rows.length ? new Set() : new Set(rows.map((row) => row.date)),
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">OPERACIÓN ANUAL</p>
            <h2>{year} · Días festivos y especiales</h2>
            <p>
              Selecciona varias fechas y define su operación de una sola vez. Después puedes
              personalizar mensaje e imágenes por día.
            </p>
          </div>
          <button className="ghost-button" type="button" onClick={() => setManualOpen((value) => !value)}>
            + Agregar día especial
          </button>
        </div>

        {manualOpen ? (
          <form action={createManualCalendarDayAction} className="mt-4 grid gap-3 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-4 md:grid-cols-2">
            <input type="hidden" name="year" value={year} />
            <label className="branding-field">
              <span>Fecha</span>
              <input name="holiday_date" type="date" required min={`${year}-01-01`} max={`${year}-12-31`} />
            </label>
            <label className="branding-field">
              <span>Nombre</span>
              <input name="name" required minLength={2} maxLength={100} placeholder="Ej. Mantenimiento general" />
            </label>
            <label className="branding-field">
              <span>Operación</span>
              <select name="operation_mode" defaultValue="closed">
                <option value="normal">Horario normal</option>
                <option value="closed">Estudio cerrado</option>
                <option value="special">Horario especial</option>
              </select>
            </label>
            <label className="branding-field">
              <span>Mensaje para alumnas</span>
              <input name="student_message" maxLength={500} placeholder="Opcional" />
            </label>
            <div className="md:col-span-2">
              <SubmitButton>Agregar día especial</SubmitButton>
            </div>
          </form>
        ) : null}
      </section>

      <form action={bulkCalendarDayOperationAction} className="panel">
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="selected_dates" value={JSON.stringify(selectedDates)} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="ghost-button" onClick={selectAll}>
            {selected.size === rows.length && rows.length ? "Quitar selección" : "Seleccionar todos"}
          </button>
          <span className="text-xs text-zinc-400">
            {selected.size} seleccionado{selected.size === 1 ? "" : "s"}
          </span>
          <select name="operation_mode" defaultValue="closed" className="min-h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white">
            <option value="closed">Cerrar seleccionados</option>
            <option value="normal">Horario normal</option>
            <option value="special">Horario especial</option>
          </select>
          <SubmitButton>Aplicar</SubmitButton>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-zinc-500">
          Al aplicar Horario especial en bloque se conservan inicialmente las sesiones existentes.
          Puedes afinar cada fecha después.
        </p>
      </form>

      <div className="space-y-3">
        {rows.map((row) => (
          <article
            key={row.date}
            className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]"
          >
            <div className="grid gap-3 p-4 md:grid-cols-[auto_110px_minmax(0,1fr)_auto] md:items-center">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={selected.has(row.date)}
                  onChange={() => toggle(row.date)}
                  className="h-4 w-4 accent-fuchsia-500"
                  aria-label={`Seleccionar ${row.name}`}
                />
              </label>

              <div>
                <strong className="block text-sm text-white">
                  {new Intl.DateTimeFormat("es-MX", {
                    day: "2-digit",
                    month: "short",
                    timeZone: "UTC",
                  }).format(new Date(`${row.date}T12:00:00Z`))}
                </strong>
                <small className="text-[10px] text-zinc-500">{row.date}</small>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-white">{row.name}</h3>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                      row.sourceKind === "official"
                        ? "border-fuchsia-500/25 bg-fuchsia-500/[0.08] text-fuchsia-300"
                        : "border-sky-500/25 bg-sky-500/[0.08] text-sky-300"
                    }`}
                  >
                    {row.sourceKind === "official" ? "Oficial" : "Manual"}
                  </span>
                  {row.heroUrl ? (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-2 py-0.5 text-[9px] text-emerald-300">
                      Imagen ✓
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-zinc-500">{row.sourceLabel}</p>
              </div>

              <span
                className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                  row.operationMode === "closed"
                    ? "border-rose-500/25 bg-rose-500/[0.07] text-rose-300"
                    : row.operationMode === "special"
                      ? "border-sky-500/25 bg-sky-500/[0.07] text-sky-300"
                      : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                }`}
              >
                {operationLabel(row.operationMode)}
              </span>
            </div>

            <details className="border-t border-white/10">
              <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-fuchsia-300">
                Personalizar operación, mensaje e imágenes
              </summary>

              <form
                action={saveCalendarDayAction}
                className="grid gap-4 border-t border-white/10 bg-black/15 p-4 lg:grid-cols-2"
              >
                <input type="hidden" name="year" value={year} />
                <input type="hidden" name="holiday_date" value={row.date} />
                <input type="hidden" name="source_kind" value={row.sourceKind} />
                <input type="hidden" name="name" value={row.name} />
                <input type="hidden" name="theme_key" value={row.themeKey} />

                <label className="branding-field">
                  <span>Operación</span>
                  <select name="operation_mode" defaultValue={row.operationMode}>
                    <option value="normal">Horario normal</option>
                    <option value="closed">Estudio cerrado</option>
                    <option value="special">Horario especial</option>
                  </select>
                  <small>
                    El horario especial conserva por defecto las sesiones actualmente publicadas.
                  </small>
                </label>

                <label className="branding-field">
                  <span>Mensaje temático</span>
                  <textarea
                    name="student_message"
                    defaultValue={row.message}
                    maxLength={500}
                    rows={4}
                  />
                  <small>Este texto aparecerá debajo de la tarjeta principal.</small>
                </label>

                <div className="branding-field">
                  <span>Imagen principal</span>
                  {row.heroUrl ? (
                    <div
                      className="mb-2 aspect-[16/9] rounded-2xl border border-white/10 bg-cover bg-center"
                      style={{ backgroundImage: `url("${row.heroUrl}")` }}
                    />
                  ) : null}
                  <input name="hero_image" type="file" accept="image/png,image/jpeg,image/webp" />
                  {row.heroUrl ? (
                    <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                      <input type="checkbox" name="remove_hero" value="1" />
                      Quitar imagen actual
                    </label>
                  ) : null}
                  <small>Arte editorial de la tarjeta principal · máximo 6 MB.</small>
                </div>

                <div className="branding-field">
                  <span>Imagen de tarjeta temática</span>
                  {row.messageUrl ? (
                    <div
                      className="mb-2 aspect-[3/1] rounded-2xl border border-white/10 bg-cover bg-center"
                      style={{ backgroundImage: `url("${row.messageUrl}")` }}
                    />
                  ) : null}
                  <input name="message_image" type="file" accept="image/png,image/jpeg,image/webp" />
                  {row.messageUrl ? (
                    <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                      <input type="checkbox" name="remove_message" value="1" />
                      Quitar imagen actual
                    </label>
                  ) : null}
                  <small>Opcional. Si no subes una, Studio Flow usa el estilo base.</small>
                </div>

                <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3">
                  <SubmitButton>Guardar este día</SubmitButton>

                  {row.sourceKind === "manual" ? (
                    <button
                      type="submit"
                      formAction={deleteManualCalendarDayAction}
                      className="ghost-button text-rose-300"
                    >
                      Eliminar día especial
                    </button>
                  ) : null}
                </div>
              </form>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
