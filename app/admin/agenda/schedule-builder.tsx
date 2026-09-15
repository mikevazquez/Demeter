"use client";

import { useState } from "react";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
type Option = { id: string; label: string; capacity?: number | null };
type Row = { weekday: number; time: string; instructorId: string; spaceId: string; capacity: number };

export function ScheduleBuilder({ instructors, spaces, defaultCapacity }: { instructors: Option[]; spaces: Option[]; defaultCapacity: number }) {
  const [rows, setRows] = useState<Row[]>([{ weekday: 1, time: "18:00", instructorId: "", spaceId: spaces[0]?.id ?? "", capacity: defaultCapacity }]);
  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <div className="compact-form">
    <input type="hidden" name="schedule_rows" value={JSON.stringify(rows)} />
    {rows.map((row, index) => <div key={index} className="rounded-xl border border-white/10 p-3 space-y-2">
      <div className="form-split">
        <select value={row.weekday} onChange={(e) => update(index, { weekday: Number(e.target.value) })}>{DAYS.map((day, value) => <option key={day} value={value}>{day}</option>)}</select>
        <input type="time" value={row.time} onChange={(e) => update(index, { time: e.target.value })} required />
      </div>
      <select value={row.instructorId} onChange={(e) => update(index, { instructorId: e.target.value })}><option value="">Sin instructor</option>{instructors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <select value={row.spaceId} onChange={(e) => update(index, { spaceId: e.target.value })}><option value="">Sin espacio</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.label}{item.capacity ? ` · máx. ${item.capacity}` : ""}</option>)}</select>
      <div className="flex gap-2 items-center"><input className="min-w-0 flex-1" type="number" min="1" value={row.capacity} onChange={(e) => update(index, { capacity: Number(e.target.value) })} aria-label="Cupo" />{rows.length > 1 ? <button type="button" className="ghost-button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>Quitar</button> : null}</div>
    </div>)}
    <button type="button" className="ghost-button" onClick={() => setRows((current) => [...current, { weekday: 1, time: "18:00", instructorId: "", spaceId: spaces[0]?.id ?? "", capacity: defaultCapacity }])}>+ Agregar otro día u horario</button>
  </div>;
}
